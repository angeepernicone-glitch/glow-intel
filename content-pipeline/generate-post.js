#!/usr/bin/env node
/**
 * Glow Intel — Autonomous Post Generator
 *
 * Pipeline per post:
 *   0. Discovery brain   → scan news/trends, find fresh topics, balance categories
 *   1. Serper autocomplete  → find long-tail variants, add best to queue
 *   2. Serper search        → top 5 results structure (H2s, angle, word count)
 *   3. Serper people_also_ask → real user questions → H2 ideas
 *   4. Serper news          → trending angle if relevant
 *   5. Google Images/Unsplash → hero image (downloaded locally)
 *   6. Claude API           → write post using all context + voice bank
 *   7. AI slop scrub        → clean robotic patterns
 *   8. Quality gate         → validate SEO, links, structure
 *   9. Save .md + update queue
 *
 * Usage:
 *   node content-pipeline/generate-post.js              # next in queue (with discovery)
 *   node content-pipeline/generate-post.js --slug foo   # specific slug
 *   node content-pipeline/generate-post.js --dry-run    # no file write
 *   node content-pipeline/generate-post.js --research-only  # just print research
 *   node content-pipeline/generate-post.js --discover-only  # just run discovery, don't write
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

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
const dryRun        = args.includes('--dry-run');
const researchOnly  = args.includes('--research-only');
const discoverOnly  = args.includes('--discover-only');
const slugArg       = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

// ─── Queue ───────────────────────────────────────────────────────────────────
const queuePath = path.join(__dirname, 'keyword-queue.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));

let target; // set in main() after discovery

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

// ─── Discovery Brain ─────────────────────────────────────────────────────────
// Scans real-time news & trends across rotating lenses, finds fresh topics
// that the queue doesn't already cover, and injects them with high priority.

async function runDiscovery() {
  console.log('Step 0: Discovery Brain\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.log('  No ANTHROPIC_API_KEY — skipping discovery');
    return 0;
  }

  // 1. Build context: what do we already have?
  const categoryCounts = {};
  for (const item of (queue.publishedItems || [])) {
    categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  }
  if (Object.keys(categoryCounts).length === 0) {
    const blogDir = path.join(ROOT, 'src', 'content', 'blog');
    for (const file of fs.readdirSync(blogDir).filter(f => f.endsWith('.md'))) {
      const content = fs.readFileSync(path.join(blogDir, file), 'utf-8');
      const catMatch = content.match(/^category:\s*"?([^"\n]+)"?/m);
      if (catMatch) categoryCounts[catMatch[1]] = (categoryCounts[catMatch[1]] || 0) + 1;
    }
  }

  const allCategories = ['ingredients', 'routines', 'reviews', 'versus', 'beauty-business', 'beginner-guides'];
  const balanceStr = allCategories.map(c => `${c}: ${categoryCounts[c] || 0}`).join(', ');
  const recentPosts = queue.published.slice(-8).join(', ');
  const today = new Date();
  const dayName = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][today.getDay()];
  const monthName = today.toLocaleString('en', { month: 'long' });

  console.log('  Category balance:', balanceStr);

  // 2. Ask Claude: "What should we investigate today?"
  console.log('  -> Claude thinking about what to research today...\n');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let searchQueries;
  try {
    const thinkMsg = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 350,
      system: `You are the editorial brain of Glow Intel, a skincare & beauty ecommerce blog. Your job: decide what to research TODAY. Be curious, creative, timely.

Think like a real editor: "Today I feel like checking if any new DTC skincare brands launched this week" or "Let me see if there's drama in the beauty industry" or "I wonder what's trending on TikTok skincare right now" or "Time to find a Shopify beauty store to review".

You have diverse interests:
- New brand/product launches, store openings
- Skincare drama, controversies, recalls
- Trending ingredients on TikTok/Reddit
- Beauty ecommerce strategies, marketing campaigns
- New dermatology research or studies
- Celebrity/influencer skincare brands (honest take)
- Viral products, bestsellers, overhyped products
- Store/website reviews (UX, conversion, design)

Categories: ingredients, routines, reviews, versus, beauty-business, beginner-guides

Respond ONLY with JSON array of 3 Google News search queries, no other text:
[{"query":"your search query","category":"category","mood":"1 sentence explaining your curiosity"}]`,
      messages: [{ role: 'user', content: `TODAY: ${dayName}, ${monthName} ${today.getDate()}, ${today.getFullYear()}

BLOG BALANCE: ${balanceStr}
RECENT POSTS: ${recentPosts}

What are you curious about today? Pick 3 different angles to research. Make the queries specific enough to find real news. JSON only.` }],
    });

    const raw = thinkMsg.content[0].text.trim();
    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    searchQueries = JSON.parse(jsonStr);

    if (!Array.isArray(searchQueries)) throw new Error('Not an array');
  } catch (e) {
    console.warn('    Claude thinking failed:', e.message);
    // Fallback: basic news queries
    searchQueries = [
      { query: 'new skincare brand launch 2026', category: 'beauty-business', mood: 'Fallback: checking new brands' },
      { query: 'skincare ingredient trending tiktok', category: 'ingredients', mood: 'Fallback: trending ingredients' },
      { query: 'beauty ecommerce store review 2026', category: 'beauty-business', mood: 'Fallback: store reviews' },
    ];
  }

  // Log Claude's thinking
  for (const sq of searchQueries) {
    console.log(`  [${sq.category}] "${sq.query}"`);
    console.log(`    Mood: ${sq.mood}\n`);
  }

  // 3. Search news for each query in parallel
  const allSlugs = new Set([...queue.published, ...queue.queue.map(k => k.slug)]);
  let discovered = 0;

  const searchResults = await Promise.all(
    searchQueries.slice(0, 3).map(async (sq) => {
      try {
        const data = await serper('news', sq.query);
        return { sq, news: (data.news || []).slice(0, 5) };
      } catch {
        return { sq, news: [] };
      }
    })
  );

  // Collect all headlines
  const allHeadlines = [];
  for (const { sq, news } of searchResults) {
    for (const item of news) {
      if ((item.title || '').length >= 20) {
        allHeadlines.push({
          headline: item.title,
          source: item.source || '',
          snippet: item.snippet || '',
          category: sq.category,
        });
      }
    }
  }

  if (allHeadlines.length > 0) {
    // Claude evaluates headlines and generates SEO keywords
    const evaluated = await evaluateHeadlines(allHeadlines, [...allSlugs]);

    for (const topic of evaluated) {
      const slug = topic.keyword.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

      if (allSlugs.has(slug)) continue;
      if (isDuplicate(topic.keyword, allSlugs)) continue;

      queue.queue.unshift({
        keyword: topic.keyword,
        slug,
        category: topic.category,
        intent: topic.intent || 'informational',
        priority: 'high',
        notes: topic.notes,
        source: 'discovery',
        discoveredAt: new Date().toISOString().split('T')[0],
      });
      allSlugs.add(slug);
      discovered++;
      console.log(`  + Discovered: "${topic.keyword}" [${topic.category}]`);
    }
  }

  if (discovered === 0) {
    console.log('  No new topics discovered today (all covered or no relevant news)');
  } else {
    console.log(`\n  Found ${discovered} fresh topic(s)`);
  }

  // Save queue with discoveries
  queue.meta.lastDiscovery = new Date().toISOString().split('T')[0];
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));

  return discovered;
}

// ─── Claude evaluates headlines → picks best topics + generates SEO keywords ─
async function evaluateHeadlines(headlines, existingSlugs) {
  if (!process.env.ANTHROPIC_API_KEY) return [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const headlineList = headlines.slice(0, 12).map((h, i) =>
    `${i + 1}. [${h.category}] "${h.headline}" (${h.source})`
  ).join('\n');

  const alreadyCovered = existingSlugs.slice(0, 20).join(', ');

  console.log('  -> Claude evaluating headlines...');

  try {
    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: `You are a skincare blog editor. Pick the 2-3 MOST interesting headlines for a blog post. Skip anything generic or already covered. Generate an SEO-friendly keyword (3-7 words) and assign a category.

Categories: ingredients, routines, reviews, versus, beauty-business, beginner-guides

Respond ONLY with JSON array, no other text:
[{"keyword":"exact seo keyword","category":"category","intent":"informational or commercial","notes":"1-line editorial angle"}]`,
      messages: [{ role: 'user', content: `HEADLINES:\n${headlineList}\n\nALREADY COVERED (skip similar): ${alreadyCovered}\n\nPick 2-3 best. JSON only.` }],
    });

    const raw = message.content[0].text.trim();
    // Extract JSON from response (handle markdown code blocks)
    const jsonStr = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const topics = JSON.parse(jsonStr);

    if (Array.isArray(topics)) {
      return topics.filter(t => t.keyword && t.category).slice(0, 3);
    }
  } catch (e) {
    console.warn('    Claude evaluation failed:', e.message);
    // Fallback: use rule-based extraction
    return fallbackExtract(headlines, existingSlugs);
  }
  return [];
}

// Fallback if Claude evaluation fails
function fallbackExtract(headlines, existingSlugs) {
  const results = [];
  const slugSet = new Set(existingSlugs);

  for (const h of headlines.slice(0, 6)) {
    const kw = extractKeywordFromHeadline(h.headline, h.category);
    if (!kw) continue;
    const slug = kw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (slugSet.has(slug) || isDuplicate(kw, slugSet)) continue;
    results.push({
      keyword: kw,
      category: h.category,
      intent: 'informational',
      notes: `Source: ${h.source}.`,
    });
    slugSet.add(slug);
    if (results.length >= 2) break;
  }
  return results;
}

// Extract a clean, searchable keyword from a news headline
function extractKeywordFromHeadline(headline, lensType) {
  // Clean up the headline
  let kw = headline
    .replace(/\|.*$/, '')        // remove "| Source" suffixes
    .replace(/\[.*?\]/g, '')     // remove [brackets]
    .replace(/[""'']/g, '')      // remove smart quotes
    .replace(/\s+/g, ' ')
    .trim();

  // For brand launches, try to extract the brand name + "skincare review"
  if (lensType === 'brand-launch' || lensType === 'celeb-brand') {
    // Look for proper nouns (capitalized words that aren't common words)
    const commonWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'new', 'best', 'top', 'how', 'why', 'what', 'this', 'that',
      'from', 'its', 'your', 'our', 'has', 'have', 'just', 'now', 'and', 'but', 'or', 'not']);
    const words = kw.split(' ');
    const brandWords = words.filter(w => w.length > 2 && /^[A-Z]/.test(w) && !commonWords.has(w.toLowerCase()));
    if (brandWords.length >= 1 && brandWords.length <= 3) {
      return `${brandWords.join(' ')} skincare brand review`;
    }
  }

  // For product launches, try "product name review"
  if (lensType === 'product-launch' || lensType === 'bestseller') {
    if (kw.length > 15 && kw.length < 80) {
      // Trim to first meaningful phrase
      const trimmed = kw.split(/[:\-–—]/).filter(p => p.trim().length > 10)[0]?.trim();
      if (trimmed && trimmed.length < 60) {
        return `${trimmed} review`;
      }
    }
  }

  // For trends, use the headline more directly
  if (lensType === 'trending-ingredient' || lensType === 'routine-trend') {
    if (kw.length > 15 && kw.length < 70) {
      return kw;
    }
  }

  // For business/marketing, summarize
  if (lensType === 'ecommerce' || lensType === 'marketing' || lensType === 'store-review') {
    const trimmed = kw.split(/[:\-–—]/).filter(p => p.trim().length > 10)[0]?.trim();
    if (trimmed && trimmed.length < 60) {
      return trimmed;
    }
  }

  // For research/science
  if (lensType === 'new-research') {
    if (kw.length > 15 && kw.length < 80) {
      return kw;
    }
  }

  // For industry news/controversy
  if (lensType === 'industry-news') {
    const trimmed = kw.split(/[:\-–—]/).filter(p => p.trim().length > 10)[0]?.trim();
    if (trimmed) return trimmed;
  }

  // Default: if keyword is reasonable length, use it
  if (kw.length > 15 && kw.length < 70) {
    return kw;
  }

  return null;
}

// Check if a keyword is too similar to something already in the queue
function isDuplicate(keyword, existingSlugs) {
  const kwWords = new Set(keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  for (const slug of existingSlugs) {
    const slugWords = new Set(slug.split('-').filter(w => w.length > 3));
    // If 60%+ of keyword words appear in an existing slug, skip it
    let overlap = 0;
    for (const w of kwWords) {
      if (slugWords.has(w)) overlap++;
    }
    if (kwWords.size > 0 && overlap / kwWords.size > 0.6) return true;
  }
  return false;
}

// ─── Target selection (smart) ────────────────────────────────────────────────
function selectTarget() {
  if (slugArg) {
    const found = queue.queue.find(k => k.slug === slugArg);
    if (!found) { console.error(`Slug "${slugArg}" not found in queue`); process.exit(1); }
    return found;
  }

  // Priority order:
  // 1. Fresh discoveries (today or yesterday) — these are timely
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  const fresh = queue.queue.filter(k =>
    k.source === 'discovery' &&
    (k.discoveredAt === today || k.discoveredAt === yesterday) &&
    !queue.published.includes(k.slug)
  );
  if (fresh.length > 0) {
    console.log(`  Picking fresh discovery: "${fresh[0].keyword}"`);
    return fresh[0];
  }

  // 2. High priority items, but prefer underrepresented categories
  const categoryCounts = {};
  for (const slug of queue.published) {
    const item = queue.queue.find(k => k.slug === slug);
    const cat = item?.category || 'unknown';
    categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
  }

  const high = queue.queue.filter(k => k.priority === 'high' && !queue.published.includes(k.slug));
  if (high.length > 0) {
    // Sort by category scarcity (fewest published first)
    high.sort((a, b) => (categoryCounts[a.category] || 0) - (categoryCounts[b.category] || 0));
    return high[0];
  }

  // 3. Any remaining
  const remaining = queue.queue.find(k => !queue.published.includes(k.slug));
  if (!remaining) { console.log('Queue empty!'); process.exit(0); }
  return remaining;
}

// ─── 1. Autocomplete → discover long-tail variants ──────────────────────────
async function getAutocomplete(keyword) {
  console.log('  -> Serper autocomplete...');
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
  console.log('  -> Serper search (top results)...');
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
  console.log('  -> Serper people also ask...');
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
  console.log('  -> Serper news...');
  try {
    const data = await serper('news', `${keyword} skincare 2026`);
    const items = (data.news || []).slice(0, 3);
    return items.map(n => `${n.title} (${n.source})`).join('\n');
  } catch (e) {
    return '';
  }
}

// ─── Image deduplication: track URLs already used across posts ───────────────
function getUsedImageUrls() {
  const urls = new Set();
  const blogDir = path.join(ROOT, 'src', 'content', 'blog');
  if (!fs.existsSync(blogDir)) return urls;
  for (const file of fs.readdirSync(blogDir).filter(f => f.endsWith('.md'))) {
    const content = fs.readFileSync(path.join(blogDir, file), 'utf-8').slice(0, 500);
    const match = content.match(/heroImage:\s*"([^"]+)"/);
    if (match) urls.add(match[1]);
  }
  return urls;
}

// ─── 6a. Google Images via Serper (for specific products/brands) ─────────────
async function fetchGoogleImage(keyword, category, usedUrls) {
  const key = process.env.SERPER_API_KEY;
  if (!key) return null;

  // Use keyword-specific queries to avoid duplicates across posts
  const queries = {
    'reviews': `${keyword} product photo`,
    'versus': `${keyword} skincare comparison`,
    'beauty-business': `${keyword} brand skincare`,
    'ingredients': `${keyword} serum bottle`,
    'routines': `${keyword} skincare products flat lay`,
    'beginner-guides': `${keyword} skincare basics products`,
  };
  const query = queries[category] || `${keyword} skincare product`;

  try {
    console.log('  -> Serper images (Google)...');
    const res = await fetch('https://google.serper.dev/images', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num: 20 }),
    });
    if (!res.ok) return null;
    const data = await res.json();

    // Filter: skip faces/people, tiny images, icons, and already-used URLs
    const good = (data.images || []).find(img =>
      img.imageUrl &&
      img.imageWidth >= 600 &&
      img.imageHeight >= 400 &&
      // Skip logos, icons, avatars
      !/logo|icon|favicon|avatar|thumbnail/i.test(img.imageUrl) &&
      // Skip images with people/faces (filter by title/alt text hints)
      !/selfie|portrait|face|person|woman|man|girl|boy|dermatologist|doctor|model|review.*by/i.test(img.title || '') &&
      // Skip already-used image URLs
      !usedUrls.has(img.imageUrl)
    );

    if (good) {
      return {
        url: good.imageUrl,
        alt: (good.title || keyword).replace(/selfie|portrait|face|person/gi, '').trim(),
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

function getExistingImageHashes() {
  const hashes = new Set();
  const imgDir = path.join(ROOT, 'public', 'images', 'blog');
  if (!fs.existsSync(imgDir)) return hashes;
  for (const file of fs.readdirSync(imgDir)) {
    const buf = fs.readFileSync(path.join(imgDir, file));
    hashes.add(createHash('md5').update(buf).digest('hex'));
  }
  return hashes;
}

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
    if (buffer.length < 5000) return null;

    // Check for duplicate: same content as an existing image
    const hash = createHash('md5').update(buffer).digest('hex');
    const existingHashes = getExistingImageHashes();
    if (existingHashes.has(hash)) {
      console.log(`    Skipped duplicate image (same content as existing)`);
      return null;
    }

    fs.writeFileSync(filepath, buffer);
    console.log(`  + Downloaded: public/images/blog/${filename} (${(buffer.length / 1024).toFixed(0)}KB)`);
    return `/images/blog/${filename}`;
  } catch (e) {
    console.warn(`    Download failed: ${e.message}`);
    return null;
  }
}

// ─── 6. Hero image: Google → download local, Unsplash fallback ──────────────
async function fetchHeroImage(keyword, category, slug) {
  const usedUrls = getUsedImageUrls();
  const googleImg = await fetchGoogleImage(keyword, category, usedUrls);
  if (googleImg) {
    const localPath = await downloadImage(googleImg.url, slug);
    if (localPath) {
      return { url: localPath, alt: googleImg.alt };
    }
    console.log('    Google image download failed, trying Unsplash...');
  }

  console.log('  -> Falling back to Unsplash...');
  const unsplashImg = await fetchUnsplashImage(keyword, category);
  const localPath = await downloadImage(unsplashImg.url, slug);
  if (localPath) {
    return { url: localPath, alt: unsplashImg.alt };
  }
  return unsplashImg;
}

// ─── 7. Generate post with Claude ────────────────────────────────────────────
async function generatePost({ keyword, serpResults, paaQuestions, newsAngle, autocomplete, existingSlugs, notes }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set in .env');

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const voicePath = path.join(ROOT, 'voice-bank.md');
  const voiceContext = fs.existsSync(voicePath)
    ? fs.readFileSync(voicePath, 'utf-8')
    : '';

  // Support both old string[] and new {slug, title}[] format
  const internalLinks = existingSlugs.slice(0, 12).map(s =>
    typeof s === 'string' ? `/blog/${s}` : `/blog/${s.slug} — "${s.title}"`
  ).join('\n');

  const serpContext = serpResults.length > 0
    ? `SERP:\n${serpResults.slice(0, 5).map(r => `- ${r.title}`).join('\n')}`
    : '';

  const paaContext = paaQuestions.length > 0
    ? `PAA:\n${paaQuestions.slice(0, 6).map(q => `- ${q}`).join('\n')}`
    : '';

  const newsContext = newsAngle
    ? `NEWS: ${newsAngle.split('\n')[0]}`
    : '';

  const autocompleteContext = autocomplete.length > 0
    ? `VARIANTS: ${autocomplete.slice(0, 5).join(', ')}`
    : '';

  const systemPrompt = `Skincare writer for Glow Intel. Science-first, opinionated, not generic AI.

VOICE:
${voiceContext}

RULES:
Intro=2-3 sentences, state point immediately. Paragraphs<=4 sentences. H2s=reader questions. 1500-2500 words, no padding. Use real product names+prices. Be opinionated ("I think","honestly","the catch"). 2-3 internal links [text](/blog/slug). 1-2 external links to authoritative sites (AAD.org, SkinCancer.org, EWG.org, or a well-known dermatology site) — NEVER link to specific PubMed article IDs (you hallucinate them). No em-dash excess.
BANNED: "game-changer","revolutionary","dive deep","let's explore","it's worth noting","In today's world". No "Furthermore/Moreover/Additionally/In conclusion" as openers.

FORMAT (exact, no extra text):
TITLE: <50-70 chars, includes keyword>
TAGS: <4-6 comma-separated lowercase>
---
<body, no H1>`;


  const userPrompt = `KEYWORD: "${keyword}" | CATEGORY: ${target.category} | NOTES: ${notes}

${serpContext}
${paaContext}
${newsContext}
${autocompleteContext}

INTERNAL LINKS (use 2-3):
${internalLinks}

Beat the SERP angles. Use PAA for H2 inspiration. 1500-2500 words. Specific, opinionated, useful. Sound like a knowledgeable friend, not a content farm.`;

  console.log('  -> Claude API writing post...');
  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = message.content[0].text;

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
    .replace(/\(~\$/g, '(around $')
    .replace(/~\$/g, '$');
}

// ─── 9. Quality gate ─────────────────────────────────────────────────────────
function qualityGate(content, { keyword, category, title, tags, existingSlugs }) {
  const issues = [];
  const fixes = [];
  let fixed = content;

  const kwLower = keyword.toLowerCase();
  const firstPara = content.split('\n').find(l => l.trim() && !l.startsWith('#') && !l.startsWith('---')) || '';

  if (!title.toLowerCase().includes(kwLower) && !title.toLowerCase().includes(kwLower.split(' ')[0])) {
    issues.push(`SEO: keyword "${keyword}" not found in title`);
  }

  if (!firstPara.toLowerCase().includes(kwLower) && !firstPara.toLowerCase().includes(kwLower.replace(/ /g, '-'))) {
    issues.push(`SEO: keyword not found in first paragraph`);
  }

  const internalLinkMatches = content.match(/\]\(\/blog\/[^)]+\)/g) || [];
  if (internalLinkMatches.length < 2) {
    issues.push(`SEO: only ${internalLinkMatches.length} internal links (need 2-3)`);
    const available = existingSlugs
      .filter(s => !content.includes(`/blog/${s}`))
      .slice(0, 3 - internalLinkMatches.length);

    for (const slug of available) {
      const label = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const paragraphs = fixed.split('\n\n');
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

  const externalLinkMatches = (content.match(/\]\(https?:\/\/[^)]+\)/g) || [])
    .filter(l => !l.includes('pubmed.ncbi.nlm.nih.gov') && !l.includes('ncbi.nlm.nih.gov/pmc'));
  if (externalLinkMatches.length < 1) {
    issues.push(`SEO: no external links (need 1-2 authoritative sources — AAD, SkinCancer.org, etc. — no PubMed IDs)`);
  }

  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 1200) {
    issues.push(`Content: only ${wordCount} words (target 1500-2500)`);
  } else if (wordCount > 2800) {
    issues.push(`Content: ${wordCount} words (target 1500-2500, may be padded)`);
  }

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

  const h2Count = (content.match(/^## /gm) || []).length;
  if (h2Count < 3) {
    issues.push(`Structure: only ${h2Count} H2 headings (recommend 4-6)`);
  }

  const desc = extractDescription(content);
  if (desc.length < 120) {
    issues.push(`Meta: description too short (${desc.length} chars, need 150-160)`);
  }

  if (issues.length === 0) {
    console.log('  + All quality checks passed');
  } else {
    console.log(`  ! ${issues.length} issue(s) found:`);
    issues.forEach(i => console.log(`    - ${i}`));
  }
  if (fixes.length > 0) {
    console.log(`  ~ ${fixes.length} auto-fix(es) applied:`);
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
  const clean = first.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
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
  if (added > 0) console.log(`  -> Added ${added} new keywords to queue from related searches`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('Glow Intel Post Generator\n');

  // Step 0: Run discovery brain (unless targeting a specific slug)
  if (!slugArg) {
    await runDiscovery();
    console.log('');
  }

  // Select target
  target = selectTarget();
  console.log(`\nTarget: "${target.keyword}" [${target.category}]${target.source === 'discovery' ? ' (DISCOVERED)' : ''}\n`);

  if (discoverOnly) {
    console.log('--discover-only: stopping after discovery.\n');
    return;
  }

  console.log('Step 1: Research\n');

  const [autocomplete, serpResults, paaQuestions, newsAngle, relatedSearches] = await Promise.all([
    getAutocomplete(target.keyword),
    getSerpStructure(target.keyword),
    getPeopleAlsoAsk(target.keyword),
    getNewsAngle(target.keyword),
    getRelatedSearches(target.keyword),
  ]);

  console.log(`\n  + Top results: ${serpResults.length}`);
  console.log(`  + PAA questions: ${paaQuestions.length}`);
  console.log(`  + Autocomplete variants: ${autocomplete.length}`);
  console.log(`  + Related searches: ${relatedSearches.length}`);

  if (researchOnly) {
    console.log('\n--- RESEARCH OUTPUT ---\n');
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
  // Build slug+title list so Claude picks contextually relevant internal links
  const blogDir = path.join(ROOT, 'src', 'content', 'blog');
  const existingSlugs = fs.readdirSync(blogDir)
    .filter(f => f.endsWith('.md'))
    .map(f => {
      const slug = f.replace('.md', '');
      const content = fs.readFileSync(path.join(blogDir, f), 'utf-8');
      const titleMatch = content.match(/^title:\s*"(.+)"/m);
      return { slug, title: titleMatch ? titleMatch[1] : slug };
    });

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
  const { content: validatedContent, issues } = qualityGate(cleanContent, {
    keyword: target.keyword,
    category: target.category,
    title,
    tags,
    existingSlugs: existingSlugs.map(s => typeof s === 'string' ? s : s.slug),
  });

  const description  = extractDescription(validatedContent);
  const frontmatter  = buildFrontmatter(target, image, description, title, tags);
  const fullPost     = `${frontmatter}\n\n${validatedContent}`;

  if (dryRun) {
    console.log('\n--- DRY RUN (first 800 chars) ---\n');
    console.log(fullPost.slice(0, 800));
    if (issues.length > 0) {
      console.log('\n--- QUALITY ISSUES ---');
      issues.forEach(i => console.log(`  ! ${i}`));
    }
    console.log('\n--- END DRY RUN ---');
    return;
  }

  // Write post
  const outputPath = path.join(ROOT, 'src', 'content', 'blog', `${target.slug}.md`);
  fs.writeFileSync(outputPath, fullPost);
  console.log(`\n  + Written: src/content/blog/${target.slug}.md`);

  // Update queue
  addNewKeywordsToQueue(relatedSearches);
  queue.published.push(target.slug);
  // Track category for discovery brain's balance logic
  if (!queue.publishedItems) queue.publishedItems = [];
  queue.publishedItems.push({ slug: target.slug, category: target.category });
  queue.queue = queue.queue.filter(k => k.slug !== target.slug);
  queue.meta.lastUpdated = new Date().toISOString().split('T')[0];
  queue.meta.totalPublished = queue.published.length;
  queue.meta.totalQueued = queue.queue.length;
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  console.log(`  + Queue updated (${queue.queue.length} remaining)`);

  // Update editorial picks (weekly highlight + monthly best)
  updateEditorialPicks(target.slug, target.category);

  console.log(`\nDone!\n`);
  console.log(`Next step:`);
  console.log(`  git add src/content/blog/${target.slug}.md content-pipeline/keyword-queue.json content-pipeline/editorial-picks.json`);
  console.log(`  git commit -m "post: ${target.keyword}"`);
  console.log(`  git push\n`);
}

// ─── Editorial Picks Auto-Manager ─────────────────────────────────────────────
function updateEditorialPicks(newSlug, newCategory) {
  const picksPath = path.join(__dirname, 'editorial-picks.json');
  let picks = { weeklyHighlight: null, monthlyBest: [], lastUpdated: null };
  try { picks = JSON.parse(fs.readFileSync(picksPath, 'utf-8')); } catch {}

  const now = new Date();
  const lastUpdated = picks.lastUpdated ? new Date(picks.lastUpdated) : null;
  const daysSinceUpdate = lastUpdated ? (now - lastUpdated) / (1000 * 60 * 60 * 24) : 999;

  // Rotate weekly highlight every ~7 days or if empty
  if (!picks.weeklyHighlight || daysSinceUpdate >= 7) {
    picks.weeklyHighlight = newSlug;
    console.log(`  + Weekly highlight updated: ${newSlug}`);
  }

  // Track monthly best (up to 4, rotate after 30 days)
  if (!picks.monthlyBest) picks.monthlyBest = [];
  if (daysSinceUpdate >= 30) {
    picks.monthlyBest = [newSlug];
    console.log(`  + Monthly best reset for new month`);
  } else if (picks.monthlyBest.length < 4) {
    picks.monthlyBest.push(newSlug);
  }

  picks.lastUpdated = now.toISOString().split('T')[0];
  fs.writeFileSync(picksPath, JSON.stringify(picks, null, 2));
}

main().catch(err => { console.error('\nError:', err.message); process.exit(1); });
