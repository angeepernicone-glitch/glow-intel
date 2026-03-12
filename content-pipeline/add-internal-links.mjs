/**
 * add-internal-links.mjs
 * Retroactively adds 2-3 relevant internal links to each existing blog post.
 * Uses keyword/tag overlap scoring — no API calls.
 *
 * Usage: node content-pipeline/add-internal-links.mjs
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, basename } from 'path';

const BLOG_DIR = 'src/content/blog';
const MAX_LINKS_PER_POST = 3;
const MIN_LINKS_PER_POST = 2;

// Stopwords to ignore when building keyword index
const STOPWORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','up','about','into','through','during','before','after',
  'above','below','between','out','off','over','under','again','then',
  'once','here','there','when','where','why','how','all','both','each',
  'few','more','most','other','some','such','no','not','only','own',
  'same','so','than','too','very','just','can','will','do','does','did',
  'is','are','was','were','be','been','being','have','has','had','if',
  'its','it','that','this','these','those','they','them','their','which',
  'who','what','your','you','we','our','us','i','my','me','he','she','his',
  'her','they','also','as','what','should','would','could','may','might',
  'one','two','three','make','makes','made','use','uses','used','using',
  'get','gets','got','need','needs','any','every','much','many','even',
  'like','well','now','still','actually','really','however','while',
  'without','because','since','though','although','whether','way',
]);

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const fm = {};
  const raw = match[1];
  const body = match[2];
  // title
  const titleM = raw.match(/^title:\s*["']?(.*?)["']?\s*$/m);
  fm.title = titleM ? titleM[1].replace(/^["']|["']$/g, '') : '';
  // description
  const descM = raw.match(/^description:\s*["']?(.*?)["']?\s*$/m);
  fm.description = descM ? descM[1].replace(/^["']|["']$/g, '') : '';
  // category
  const catM = raw.match(/^category:\s*["']?(.*?)["']?\s*$/m);
  fm.category = catM ? catM[1].replace(/^["']|["']$/g, '') : '';
  // tags
  const tagsM = raw.match(/^tags:\s*\[(.*?)\]/m);
  fm.tags = tagsM
    ? tagsM[1].split(',').map(t => t.trim().replace(/^["']|["']$/g, '').toLowerCase())
    : [];
  fm.rawFm = raw;
  return { fm, body };
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));
}

function getKeywords(post) {
  const words = new Set();
  // From title (high weight — add 3x)
  tokenize(post.fm.title).forEach(w => { words.add(w); words.add(w); words.add(w); });
  // From tags
  post.fm.tags.forEach(tag => tokenize(tag).forEach(w => words.add(w)));
  // From slug
  tokenize(post.slug.replace(/-/g, ' ')).forEach(w => words.add(w));
  return [...words];
}

function scoreRelevance(sourcePost, targetPost) {
  const sourceTokens = new Set(tokenize(sourcePost.body));
  const targetKeywords = getKeywords(targetPost);
  let score = 0;
  for (const kw of targetKeywords) {
    if (sourceTokens.has(kw)) score++;
  }
  // Bonus for same category
  if (sourcePost.fm.category === targetPost.fm.category) score += 2;
  // Bonus for shared tags
  const sharedTags = sourcePost.fm.tags.filter(t => targetPost.fm.tags.includes(t));
  score += sharedTags.length * 3;
  return score;
}

function alreadyLinked(body, slug) {
  return body.includes(`/blog/${slug}`);
}

function findBestInsertionPoint(body, targetPost) {
  // Split body into paragraphs
  const paragraphs = body.split('\n');
  const targetKeywords = getKeywords(targetPost);
  // Also try key phrases from title (multi-word)
  const titleWords = targetPost.fm.title.toLowerCase().split(/\s+/).filter(w => !STOPWORDS.has(w));

  let bestLine = -1;
  let bestScore = 0;
  let bestKeyword = null;
  let bestAnchorText = null;

  for (let i = 0; i < paragraphs.length; i++) {
    const line = paragraphs[i];
    // Skip headings, existing links, code blocks, frontmatter
    if (line.startsWith('#') || line.includes('](') || line.startsWith('```') || line.startsWith('---')) continue;
    // Skip short lines
    if (line.trim().length < 30) continue;

    const lineLower = line.toLowerCase();
    let lineScore = 0;
    let matchedKw = null;
    let anchorText = null;

    // Try to find multi-word title phrases first (best anchors)
    for (let len = 4; len >= 2; len--) {
      for (let start = 0; start <= titleWords.length - len; start++) {
        const phrase = titleWords.slice(start, start + len).join(' ');
        if (phrase.length < 5) continue;
        const idx = lineLower.indexOf(phrase);
        if (idx !== -1) {
          // Find actual case in original line
          const actualPhrase = line.slice(idx, idx + phrase.length);
          // Make sure it's not already in a link
          const before = line.slice(0, idx);
          if ((before.match(/\[/g) || []).length > (before.match(/\]/g) || []).length) continue;
          lineScore = 10 + len;
          matchedKw = phrase;
          anchorText = actualPhrase;
          break;
        }
      }
      if (matchedKw) break;
    }

    // Fall back to single keywords
    if (!matchedKw) {
      for (const kw of targetKeywords) {
        if (kw.length < 4) continue;
        const idx = lineLower.indexOf(kw);
        if (idx !== -1) {
          const before = line.slice(0, idx);
          if ((before.match(/\[/g) || []).length > (before.match(/\]/g) || []).length) continue;
          const actualWord = line.slice(idx, idx + kw.length);
          lineScore = 5;
          matchedKw = kw;
          anchorText = actualWord;
          break;
        }
      }
    }

    if (lineScore > bestScore) {
      bestScore = lineScore;
      bestLine = i;
      bestKeyword = matchedKw;
      bestAnchorText = anchorText;
    }
  }

  return bestScore > 0 ? { lineIdx: bestLine, keyword: bestKeyword, anchorText: bestAnchorText } : null;
}

function injectLink(paragraphs, lineIdx, anchorText, slug) {
  const line = paragraphs[lineIdx];
  const lineLower = line.toLowerCase();
  const kwLower = anchorText.toLowerCase();
  const idx = lineLower.indexOf(kwLower);
  if (idx === -1) return false;

  const before = line.slice(0, idx);
  const after = line.slice(idx + anchorText.length);

  // Don't link if it's already inside brackets
  if ((before.match(/\[/g) || []).length > (before.match(/\]/g) || []).length) return false;

  paragraphs[lineIdx] = `${before}[${anchorText}](/blog/${slug})${after}`;
  return true;
}

// Load all posts
const files = readdirSync(BLOG_DIR).filter(f => f.endsWith('.md'));
const posts = [];

for (const file of files) {
  const slug = basename(file, '.md');
  const filePath = join(BLOG_DIR, file);
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parseFrontmatter(content);
  if (!parsed) {
    console.log(`⚠ Skipping ${file} — could not parse frontmatter`);
    continue;
  }
  posts.push({ slug, filePath, content, fm: parsed.fm, body: parsed.body });
}

console.log(`Loaded ${posts.length} posts\n`);

let totalLinksAdded = 0;
const results = [];

for (const post of posts) {
  // Find candidates — rank by relevance
  const candidates = posts
    .filter(p => p.slug !== post.slug && !alreadyLinked(post.body, p.slug))
    .map(p => ({ post: p, score: scoreRelevance(post, p) }))
    .filter(c => c.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8); // top 8 candidates to try

  if (candidates.length === 0) {
    console.log(`${post.slug}: no relevant candidates found`);
    results.push({ slug: post.slug, added: 0 });
    continue;
  }

  let paragraphs = post.body.split('\n');
  let linksAdded = 0;
  const addedSlugs = [];

  for (const { post: target, score } of candidates) {
    if (linksAdded >= MAX_LINKS_PER_POST) break;

    const insertion = findBestInsertionPoint(post.body, target);
    if (!insertion) continue;

    const success = injectLink(paragraphs, insertion.lineIdx, insertion.anchorText, target.slug);
    if (success) {
      linksAdded++;
      addedSlugs.push(`→ ${target.slug} (anchor: "${insertion.anchorText}", score: ${score})`);
      // Update post.body for subsequent checks
      post.body = paragraphs.join('\n');
    }
  }

  if (linksAdded > 0) {
    // Reconstruct full file content
    const newContent = `---\n${post.fm.rawFm}\n---\n${post.body}`;
    writeFileSync(post.filePath, newContent, 'utf-8');
    totalLinksAdded += linksAdded;
    console.log(`✓ ${post.slug} — ${linksAdded} link(s) added:`);
    addedSlugs.forEach(s => console.log(`   ${s}`));
  } else {
    console.log(`○ ${post.slug} — no suitable insertion point found`);
  }

  results.push({ slug: post.slug, added: linksAdded });
}

console.log(`\nDone. ${totalLinksAdded} internal links added across ${results.filter(r => r.added > 0).length} posts.`);
