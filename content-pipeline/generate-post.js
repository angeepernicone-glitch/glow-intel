#!/usr/bin/env node
/**
 * Glow Intel — Autonomous Post Generator
 *
 * Pipeline per post:
 *   1. Serper autocomplete  → find long-tail variants, add best to queue
 *   2. Serper search        → top 5 results structure (H2s, angle, word count)
 *   3. Serper people_also_ask → real user questions → H2 ideas
 *   4. Serper news          → trending angle if relevant
 *   5. Unsplash             → hero image
 *   6. Claude API           → write post using all context + voice bank
 *   7. AI slop scrub        → clean robotic patterns
 *   8. Save .md + update queue
 *
 * Usage:
 *   node content-pipeline/generate-post.js              # next in queue
 *   node content-pipeline/generate-post.js --slug foo   # specific slug
 *   node content-pipeline/generate-post.js --dry-run    # no file write
 *   node content-pipeline/generate-post.js --research-only  # just print research
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Load .env ───────────────────────────────────────────────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key?.trim() && rest.length) {
      process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
    }
  }
}
loadEnv();

// ─── Args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun       = args.includes('--dry-run');
const researchOnly = args.includes('--research-only');
const slugArg      = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

// ─── Queue ───────────────────────────────────────────────────────────────────
const queuePath = path.join(__dirname, 'keyword-queue.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));

let target;
if (slugArg) {
  target = queue.queue.find(k => k.slug === slugArg);
  if (!target) { console.error(`Slug "${slugArg}" not found in queue`); process.exit(1); }
} else {
  const high = queue.queue.filter(k => k.priority === 'high' && !queue.published.includes(k.slug));
  target = high[0] || queue.queue.find(k => !queue.published.includes(k.slug));
  if (!target) { console.log('Queue empty — all keywords published!'); process.exit(0); }
}

console.log(`\n🔍 Keyword: "${target.keyword}"\n`);

// ─── Serper helper ───────────────────────────────────────────────────────────
async function serper(endpoint, payload) {
  const key = process.env.SERPER_API_KEY;
  if (!key) throw new Error('SERPER_API_KEY not set in .env');

  const res = await fetch(`https://google.serper.dev/${endpoint}`, {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: payload, gl: 'us', hl: 'en', num: 10 }),
  });

  if (!res.ok) throw new Error(`Serper ${endpoint} failed: ${res.status}`);
  return res.json();
}

// ─── 1. Autocomplete → discover long-tail variants ──────────────────────────
async function getAutocomplete(keyword) {
  console.log('  → Serper autocomplete...');
  try {
    const data = await serper('autocomplete', keyword);
    return (data.suggestions || []).map(s => s.value || s).filter(Boolean).slice(0, 10);
  } catch (e) {
    console.warn('    Autocomplete failed:', e.message);
    return [];
  }
}

// ─── 2. SERP top results → structure analysis ────────────────────────────────
async function getSerpStructure(keyword) {
  console.log('  → Serper search (top results)...');
  try {
    const data = await serper('search', keyword);
    const organic = (data.organic || []).slice(0, 5);
    return organic.map(r => ({
      title: r.title,
      url: r.link,
      snippet: r.snippet,
      position: r.position,
    }));
  } catch (e) {
    console.warn('    SERP search failed:', e.message);
    return [];
  }
}

// ─── 3. People Also Ask → real user questions ────────────────────────────────
async function getPeopleAlsoAsk(keyword) {
  console.log('  → Serper people also ask...');
  try {
    const data = await serper('search', keyword);
    return (data.peopleAlsoAsk || []).map(q => q.question).slice(0, 6);
  } catch (e) {
    console.warn('    PAA failed:', e.message);
    return [];
  }
}

// ─── 4. Related searches → more keywords for queue ──────────────────────────
async function getRelatedSearches(keyword) {
  try {
    const data = await serper('search', keyword);
    return (data.relatedSearches || []).map(r => r.query).slice(0, 6);
  } catch (e) {
    return [];
  }
}

// ─── 5. News → trending angle ────────────────────────────────────────────────
async function getNewsAngle(keyword) {
  console.log('  → Serper news...');
  try {
    const data = await serper('news', `${keyword} skincare 2026`);
    const items = (data.news || []).slice(0, 3);
    return items.map(n => `${n.title} (${n.source})`).join('\n');
  } catch (e) {
    return '';
  }
}

// ─── 6a. Google Images via Serper (for specific products/brands) ─────────────
async function fetchGoogleImage(keyword, category) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;

  // Build a specific query based on category
  const queries = {
    'reviews': `${keyword} product`,
    'versus': `${keyword} skincare product`,
    'beauty-business': `${keyword} brand logo skincare`,
    'ingredients': `${keyword} skincare serum`,
    'routines': `skincare routine products`,
    'beginner-guides': `beginner skincare products`,
  };
  const query = queries[category] || `${keyword} skincare`;

  try {
    console.log('  → Serper images (Google)...');
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 10 }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Filter: skip tiny images, icons, and irrelevant results
    const good = (data.images || []).find(img =>
      img.imageUrl &&
      img.imageWidth >= 600 &&
      img.imageHeight >= 400 &&
      !/logo|icon|favicon|avatar|thumbnail/i.test(img.imageUrl)
    );

    if (good) {
      return {
        url: good.imageUrl,
        alt: good.title || keyword,
      };
    }
  } catch (e) {
    console.warn('    Google Images failed:', e.message);
  }
  return null;
}

// ─── 6b. Unsplash fallback (for generic/lifestyle imagery) ──────────────────
async function fetchUnsplashImage(keyword, category) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    return {
      url: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1200&q=80',
      alt: 'Skincare products on a clean surface',
    };
  }

  const categoryQueries = {
    'ingredients': `${keyword} skincare ingredient serum`,
    'routines': `skincare routine products bathroom`,
    'reviews': `${keyword} product beauty`,
    'versus': `skincare products comparison`,
    'beauty-business': `beauty brand ecommerce store`,
    'beginner-guides': `simple skincare routine clean`,
  };
  const primaryQuery = categoryQueries[category] || `${keyword} skincare beauty`;
  const queries = [primaryQuery, `${keyword} skincare`, 'skincare products flat lay'];

  for (const q of queries) {
    try {
      const res = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(q)}&per_page=8&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${key}` } }
      );
      const data = await res.json();
      const photo = data.results?.find(p =>
        p.alt_description && /skin|cream|serum|beauty|face|product|bottle|routine|glow/i.test(p.alt_description)
      ) || data.results?.[0];

      if (photo) {
        return {
          url: `${photo.urls.raw}&w=1200&q=80&fm=jpg`,
          alt: photo.alt_description || keyword,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    url: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1200&q=80',
    alt: keyword,
  };
}

// ─── 6c. Download image to local public/images/blog/ ────────────────────────
async function downloadImage(url, slug) {
  const imgDir = path.join(ROOT, 'public', 'images', 'blog');
  if (!fs.existsSync(imgDir)) fs.mkdirSync(imgDir, { recursive: true });

  const ext = url.match(/\.(jpg|jpeg|png|webp)/i)?.[1] || 'jpg';
  const filename = `${slug}.${ext}`;
  const filepath = path.join(imgDir, filename);

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GlowIntel/1.0)' },
      redirect: 'follow',
    });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    // Skip if too small (likely a broken/blocked image)
    if (buffer.length < 5000) return null;

    fs.writeFileSync(filepath, buffer);
    console.log(`  ✓ Downloaded: public/images/blog/${filename} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return `/images/blog/${filename}`;
  } catch (e) {
    console.warn(`    Download failed: ${e.message}`);
    return null;
  }
}

// ─── 6. Hero image: Google → download local, Unsplash fallback ──────────────
async function fetchHeroImage(keyword, category, slug) {
  // Try Google Images first (best for specific products/brands)
  const googleImg = await fetchGoogleImage(keyword, category);
  if (googleImg) {
    // Download to local to avoid hotlink blocking
    const localPath = await downloadImage(googleImg.url, slug);
    if (localPath) {
      return { url: localPath, alt: googleImg.alt };
    }
    console.log('    Google image download failed, trying Unsplash...');
  }

  // Fallback to Unsplash (reliable direct URLs, no download needed)
  console.log('  → Falling back to Unsplash...');
  const unsplashImg = await fetchUnsplashImage(keyword, category);
  // Also download Unsplash to local for consistency
  const localPath = await downloadImage(unsplashImg.url, slug);
  if (localPath) {
    return { url: localPath, alt: unsplashImg.alt };
  }
  // Last resort: use Unsplash URL directly (always works)
  return unsplashImg;
}

// ─── 7. Generate post with Claude ────────────────────────────────────────────
async function generatePost({ keyword, serpResults, paaQuestions, newsAngle, autocomplete, existingSlugs, notes }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const voicePath = path.join(ROOT, 'voice-bank.md');
  const voiceContext = fs.existsSync(voicePath)
    ? fs.readFileSync(voicePath, 'utf-8').slice(0, 1500)
    : '';

  const internalLinks = existingSlugs.slice(0, 4).map(s => `/blog/${s}`).join('\n');

  const serpContext = serpResults.length > 0
    ? `TOP GOOGLE RESULTS (cover and surpass these):\n${serpResults.slice(0, 3).map(r => `- ${r.title}`).join('\n')}`
    : '';

  const paaContext = paaQuestions.length > 0
    ? `PEOPLE ALSO ASK:\n${paaQuestions.slice(0, 4).map(q => `- ${q}`).join('\n')}`
    : '';

  const newsContext = newsAngle
    ? `NEWS: ${newsAngle.split('\n')[0]}`
    : '';

  const autocompleteContext = autocomplete.length > 0
    ? `VARIANTS: ${autocomplete.slice(0, 3).join(', ')}`
    : '';

  const systemPrompt = `You are a skincare content writer for Glow Intel — a science-first, opinionated skincare and beauty ecommerce blog.

WRITER VOICE (this is critical — sound like this person, not a generic AI):
${voiceContext}

STYLE RULES (follow strictly):
- Intro: 2-3 sentences MAX. State the point immediately. No "In today's world", no "Let's dive in", no "Are you wondering..."
- Paragraphs: 3-4 sentences max
- H2s: clear questions or direct statements the reader has in mind
- H3s: use sparingly, only when genuinely needed
- Length: 1500-2500 words. Don't pad to hit word count.
- Specific product names + real prices when mentioning products
- "I think" / "In my experience" / "Honestly" — be opinionated, not neutral
- Include "the catch" — honest about limitations, tradeoffs, what doesn't work
- NEVER: "game-changer", "revolutionary", "dive deep", "let's explore", "it's worth noting"
- NEVER start sentences with: "Furthermore", "Moreover", "Additionally", "In conclusion"
- NO excessive em-dashes
- Internal links: include 2-3 naturally in the text using markdown [anchor text](/blog/slug)
- External links: 1-2 links to PubMed, AAD, or authoritative dermatology sources

OUTPUT FORMAT — return exactly this structure (no extra text before or after):
TITLE: <compelling editorial title for this post, 50-70 chars, includes keyword naturally>
TAGS: <4-6 comma-separated lowercase tags like: niacinamide, retinol, skincare routine, oily skin>
---
<post body starting with the opening paragraph, no H1>`;


  const userPrompt = `Write a complete blog post for Glow Intel.

TARGET KEYWORD: "${keyword}"
CATEGORY: ${target.category}
EDITORIAL NOTES: ${notes}

${serpContext}

${paaContext}

${newsContext}

${autocompleteContext}

AVAILABLE INTERNAL LINKS (use 2-3 naturally):
${internalLinks}

Instructions:
1. Study the SERP results — understand the angle they take and find what's MISSING or could be said better
2. Use the PAA questions as inspiration for H2s (don't copy them verbatim, make them better)
3. Write 1500-2500 words. Be specific, opinionated, and genuinely useful.
4. Sound like a knowledgeable friend who knows this space deeply — not a content farm.`;

  console.log('  → Claude API writing post...');
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = message.content[0].text;

  // Parse TITLE, TAGS, and body from structured output
  const titleMatch = raw.match(/^TITLE:\s*(.+)/m);
  const tagsMatch = raw.match(/^TAGS:\s*(.+)/m);
  const bodyMatch = raw.match(/^---\s*\n([\s\S]+)/m);

  const title = titleMatch ? titleMatch[1].trim() : keyword.charAt(0).toUpperCase() + keyword.slice(1);
  const tags = tagsMatch ? tagsMatch[1].split(',').map(t => t.trim()).filter(Boolean) : [target.category];
  const body = bodyMatch ? bodyMatch[1].trim() : raw;

  return { title, tags, body };
}

// ─── 8. AI slop scrubber ─────────────────────────────────────────────────────
function scrub(text) {
  return text
    .replace(/In today's (world|age|landscape|digital age|fast-paced world)/gi, 'Right now')
    .replace(/It('s| is) worth noting that ?/gi, '')
    .replace(/Let's dive (in|deep)/gi, "Here's the breakdown")
    .replace(/deep dive/gi, 'closer look')
    .replace(/game.changer/gi, 'real upgrade')
    .replace(/revolutionary/gi, 'significant')
    .replace(/groundbreaking/gi, 'solid')
    .replace(/Without further ado,? ?/gi, '')
    .replace(/^Furthermore,/gm, 'And')
    .replace(/^Moreover,/gm, 'Also')
    .replace(/^Additionally,/gm, 'Also')
    .replace(/^In conclusion,/gm, 'The bottom line:')
    .replace(/Firstly,/gi, 'First:')
    .replace(/Secondly,/gi, 'Second:')
    .replace(/Thirdly,/gi, 'Third:')
    .replace(/At the end of the day,? ?/gi, 'Ultimately, ')
    .replace(/It goes without saying/gi, '')
    .replace(/needless to say/gi, '')
    .replace(/As (an AI|a language model)[^.]*\./gi, '')
    // Phase 2: subtle hedging patterns
    .replace(/is one of the most /gi, 'is a ')
    .replace(/are one of the most /gi, 'are ')
    .replace(/is designed to /gi, '')
    .replace(/helps significantly/gi, 'makes a real difference')
    .replace(/,? typically/gi, '')
    .replace(/typically,? /gi, '')
    .replace(/for the most part,? ?/gi, '')
    .replace(/with solid (research|evidence)[^.]*\./gi, '.')
    .replace(/has solid (research|evidence)[^.]*\./gi, '.')
    .replace(/are generally /gi, 'are ')
    .replace(/is generally /gi, 'is ')
    .replace(/Some people find that /gi, '')
    .replace(/can help /gi, 'helps ')
    .replace(/can improve /gi, 'improves ')
    .replace(/may want to /gi, 'should ')
    .replace(/might want to /gi, 'should ')
    .replace(/tends to be /gi, 'is ')
    .replace(/It's clear that /gi, '')
    .replace(/It appears that /gi, '')
    .replace(/It seems that /gi, '')
    // Fix tilde-dollar causing markdown strikethrough
    .replace(/\(~\$/g, '(around $')
    .replace(/~\$/g, '$');
}

// ─── 9. Quality gate — auto-validate & fix before saving ─────────────────────
function qualityGate(content, { keyword, category, title, tags, existingSlugs }) {
  const issues = [];
  const fixes = [];
  let fixed = content;

  // --- SEO checks ---
  const kwLower = keyword.toLowerCase();
  const firstPara = content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---')) || '';

  if (!title.toLowerCase().includes(kwLower) && !title.toLowerCase().includes(kwLower.split(' ')[0])) {
    issues.push(`SEO: keyword "${keyword}" not found in title`);
  }

  if (!firstPara.toLowerCase().includes(kwLower) && !firstPara.toLowerCase().includes(kwLower.replace(/ /g, '-'))) {
    issues.push(`SEO: keyword not found in first paragraph`);
  }

  // --- Internal links check (need 2-3) ---
  const internalLinkMatches = content.match(/\]\(\/blog\/[^)]+\)/g) || [];
  if (internalLinkMatches.length < 2) {
    issues.push(`SEO: only ${internalLinkMatches.length} internal links (need 2-3)`);
    // Auto-inject internal links at end of relevant paragraphs
    const available = existingSlugs
      .filter(s => !content.includes(`/blog/${s}`))
      .slice(0, 3 - internalLinkMatches.length);

    for (const slug of available) {
      const label = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const paragraphs = fixed.split('\n\n');
      // Find a middle paragraph that's actual text (not a heading)
      const midIdx = Math.floor(paragraphs.length / 2);
      for (let i = midIdx; i < paragraphs.length; i++) {
        if (paragraphs[i].trim() && !paragraphs[i].startsWith('#') && !paragraphs[i].includes(`/blog/`)) {
          paragraphs[i] += ` If you're interested, check out [${label}](/blog/${slug}).`;
          fixes.push(`Auto-injected internal link to /blog/${slug}`);
          break;
        }
      }
      fixed = paragraphs.join('\n\n');
    }
  }

  // --- External links check (need 1-2) ---
  const externalLinkMatches = content.match(/\]\(https?:\/\/[^)]+\)/g) || [];
  if (externalLinkMatches.length < 1) {
    issues.push(`SEO: no external links (need 1-2 authoritative sources)`);
  }

  // --- Word count check ---
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 1200) {
    issues.push(`Content: only ${wordCount} words (target 1500-2500)`);
  } else if (wordCount > 2800) {
    issues.push(`Content: ${wordCount} words (target 1500-2500, may be padded)`);
  }

  // --- Residual slop check ---
  const slopPatterns = [
    /game.changer/i, /revolutionary/i, /groundbreaking/i, /dive deep/i,
    /let's explore/i, /it's worth noting/i, /in today's world/i,
    /without further ado/i, /^furthermore,/im, /^moreover,/im,
    /^additionally,/im, /^in conclusion,/im, /as an ai/i,
  ];
  const slopFound = slopPatterns.filter(p => p.test(content));
  if (slopFound.length > 0) {
    issues.push(`Slop: ${slopFound.length} residual AI patterns found after scrub`);
  }

  // --- H2 check ---
  const h2Count = (content.match(/^## /gm) || []).length;
  if (h2Count < 3) {
    issues.push(`Structure: only ${h2Count} H2 headings (recommend 4-6)`);
  }

  // --- Meta description length ---
  const desc = extractDescription(content);
  if (desc.length < 120) {
    issues.push(`Meta: description too short (${desc.length} chars, need 150-160)`);
  }

  // Log results
  if (issues.length === 0) {
    console.log('  ✓ All quality checks passed');
  } else {
    console.log(`  ⚠ ${issues.length} issue(s) found:`);
    issues.forEach(i => console.log(`    - ${i}`));
  }
  if (fixes.length > 0) {
    console.log(`  🔧 ${fixes.length} auto-fix(es) applied:`);
    fixes.forEach(f => console.log(`    - ${f}`));
  }

  return { content: fixed, issues, fixes };
}

// ─── Build frontmatter ───────────────────────────────────────────────────────
function buildFrontmatter(target, image, description, title, tags) {
  const today = new Date().toISOString().split('T')[0];
  const tagsFormatted = (tags || [target.category]).map(t => `"${t}"`).join(', ');
  return `---
title: "${(title || target.keyword).replace(/"/g, "'")}"
description: "${description.replace(/"/g, "'")}"
pubDate: ${today}
category: "${target.category}"
tags: [${tagsFormatted}]
heroImage: "${image.url}"
heroImageAlt: "${image.alt}"
draft: false
---`;
}

function extractDescription(content) {
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#') && !l.startsWith('---'));
  const first = lines[0] || '';
  const clean = first.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1'); // strip markdown links
  return (clean.length > 155 ? clean.slice(0, 152) + '...' : clean);
}

// ─── Update queue with new keywords found ────────────────────────────────────
function addNewKeywordsToQueue(relatedSearches) {
  const existingSlugs = new Set([
    ...queue.published,
    ...queue.queue.map(k => k.slug),
  ]);

  let added = 0;
  for (const q_term of relatedSearches) {
    const slug = q_term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!existingSlugs.has(slug) && q_term.split(' ').length >= 3) {
      queue.queue.push({
        keyword: q_term,
        slug,
        category: target.category,
        intent: 'informational',
        priority: 'medium',
        notes: `Related to: ${target.keyword}`,
      });
      existingSlugs.add(slug);
      added++;
    }
  }
  if (added > 0) console.log(`  → Added ${added} new keywords to queue from related searches`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🚀 Glow Intel Post Generator\n');
  console.log('Step 1: Research\n');

  // Run all Serper calls in parallel (saves ~3 seconds)
  const [autocomplete, serpResults, paaQuestions, newsAngle, relatedSearches] = await Promise.all([
    getAutocomplete(target.keyword),
    getSerpStructure(target.keyword),
    getPeopleAlsoAsk(target.keyword),
    getNewsAngle(target.keyword),
    getRelatedSearches(target.keyword),
  ]);

  console.log(`\n  ✓ Top results: ${serpResults.length}`);
  console.log(`  ✓ PAA questions: ${paaQuestions.length}`);
  console.log(`  ✓ Autocomplete variants: ${autocomplete.length}`);
  console.log(`  ✓ Related searches: ${relatedSearches.length}`);

  if (researchOnly) {
    console.log('\n─── RESEARCH OUTPUT ─────────────────────────\n');
    console.log('TOP RESULTS:\n', serpResults.map(r => `[${r.position}] ${r.title}`).join('\n'));
    console.log('\nPEOPLE ALSO ASK:\n', paaQuestions.join('\n'));
    console.log('\nAUTOCOMPLETE:\n', autocomplete.join('\n'));
    console.log('\nRELATED SEARCHES:\n', relatedSearches.join('\n'));
    console.log('\nNEWS:\n', newsAngle || '(none)');
    return;
  }

  console.log('\nStep 2: Image\n');
  const image = await fetchHeroImage(target.keyword, target.category, target.slug);

  console.log('\nStep 3: Writing\n');
  const existingSlugs = fs.readdirSync(path.join(ROOT, 'src', 'content', 'blog'))
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));

  const { title, tags, body } = await generatePost({
    keyword: target.keyword,
    serpResults,
    paaQuestions,
    newsAngle,
    autocomplete,
    existingSlugs,
    notes: target.notes,
  });

  const cleanContent = scrub(body);

  console.log('\nStep 4: Quality gate\n');
  const existingSlugsList = fs.readdirSync(path.join(ROOT, 'src', 'content', 'blog'))
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
  const { content: validatedContent, issues } = qualityGate(cleanContent, {
    keyword: target.keyword,
    category: target.category,
    title,
    tags,
    existingSlugs: existingSlugsList,
  });

  const description  = extractDescription(validatedContent);
  const frontmatter  = buildFrontmatter(target, image, description, title, tags);
  const fullPost     = `${frontmatter}\n\n${validatedContent}`;

  if (dryRun) {
    console.log('\n─── DRY RUN (first 800 chars) ───────────────\n');
    console.log(fullPost.slice(0, 800));
    if (issues.length > 0) {
      console.log('\n─── QUALITY ISSUES ──────────────────────────');
      issues.forEach(i => console.log(`  ⚠ ${i}`));
    }
    console.log('\n─── END DRY RUN ─────────────────────────────');
    return;
  }

  // Write post
  const outputPath = path.join(ROOT, 'src', 'content', 'blog', `${target.slug}.md`);
  fs.writeFileSync(outputPath, fullPost);
  console.log(`\n  ✓ Written: src/content/blog/${target.slug}.md`);

  // Update queue
  addNewKeywordsToQueue(relatedSearches);
  queue.published.push(target.slug);
  queue.queue = queue.queue.filter(k => k.slug !== target.slug);
  queue.meta.lastUpdated = new Date().toISOString().split('T')[0];
  queue.meta.totalPublished = queue.published.length;
  queue.meta.totalQueued = queue.queue.length;
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  console.log(`  ✓ Queue updated (${queue.queue.length} remaining)`);

  console.log(`\n✅ Done!\n`);
  console.log(`Next step:`);
  console.log(`  git add src/content/blog/${target.slug}.md content-pipeline/keyword-queue.json`);
  console.log(`  git commit -m "post: ${target.keyword}"`);
  console.log(`  git push\n`);
}

main().catch(err => { console.error('\n❌ Error:', err.message); process.exit(1); });
