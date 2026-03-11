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

// ─── 6. Unsplash image ───────────────────────────────────────────────────────
async function fetchUnsplashImage(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    return {
      url: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1200&q=80',
      alt: 'Skincare products on a clean surface',
    };
  }
  try {
    const res = await fetch(
      `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: `Client-ID ${key}` } }
    );
    const data = await res.json();
    const photo = data.results?.[0];
    if (!photo) throw new Error('No photo found');
    return {
      url: `${photo.urls.raw}&w=1200&q=80&fm=jpg`,
      alt: photo.alt_description || query,
    };
  } catch {
    return {
      url: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1200&q=80',
      alt: query,
    };
  }
}

// ─── 7. Generate post with Claude ────────────────────────────────────────────
async function generatePost({ keyword, serpResults, paaQuestions, newsAngle, autocomplete, existingSlugs, notes }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const voicePath = path.join(ROOT, 'voice-bank.md');
  const voiceContext = fs.existsSync(voicePath)
    ? fs.readFileSync(voicePath, 'utf-8').slice(0, 3000)
    : '';

  const internalLinks = existingSlugs.slice(0, 6).map(s => `/blog/${s}`).join('\n');

  const serpContext = serpResults.length > 0
    ? `TOP 5 GOOGLE RESULTS (what's already ranking — cover and SURPASS these):
${serpResults.map(r => `- [${r.position}] ${r.title}\n  URL: ${r.url}\n  Snippet: ${r.snippet}`).join('\n\n')}`
    : '';

  const paaContext = paaQuestions.length > 0
    ? `PEOPLE ALSO ASK (use these as H2s where relevant):
${paaQuestions.map(q => `- ${q}`).join('\n')}`
    : '';

  const newsContext = newsAngle
    ? `TRENDING NEWS ANGLE (incorporate if relevant, don't force it):\n${newsAngle}`
    : '';

  const autocompleteContext = autocomplete.length > 0
    ? `LONG-TAIL VARIANTS (work these in naturally where relevant):
${autocomplete.slice(0, 5).join(', ')}`
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

OUTPUT: Return ONLY the markdown body content starting from the first paragraph (no frontmatter, no H1 title — that goes in frontmatter). Start directly with the opening paragraph.`;

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
    model: 'claude-opus-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  return message.content[0].text;
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
    .replace(/As (an AI|a language model)[^.]*\./gi, '');
}

// ─── Build frontmatter ───────────────────────────────────────────────────────
function buildFrontmatter(target, image, description) {
  const today = new Date().toISOString().split('T')[0];
  const titleCased = target.keyword.charAt(0).toUpperCase() + target.keyword.slice(1);
  return `---
title: "${titleCased}"
description: "${description.replace(/"/g, "'")}"
pubDate: ${today}
category: "${target.category}"
tags: [${(target.notes || '').split(',').slice(0, 4).map(t => `"${t.trim().split(' ').slice(0, 2).join(' ')}"`).join(', ')}]
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
  const image = await fetchUnsplashImage(target.keyword + ' skincare');
  console.log(`  ✓ Image: ${image.url.slice(0, 60)}...`);

  console.log('\nStep 3: Writing\n');
  const existingSlugs = fs.readdirSync(path.join(ROOT, 'src', 'content', 'blog'))
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));

  const rawContent = await generatePost({
    keyword: target.keyword,
    serpResults,
    paaQuestions,
    newsAngle,
    autocomplete,
    existingSlugs,
    notes: target.notes,
  });

  const cleanContent = scrub(rawContent);
  const description  = extractDescription(cleanContent);
  const frontmatter  = buildFrontmatter(target, image, description);
  const fullPost     = `${frontmatter}\n\n${cleanContent}`;

  if (dryRun) {
    console.log('\n─── DRY RUN (first 800 chars) ───────────────\n');
    console.log(fullPost.slice(0, 800));
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
