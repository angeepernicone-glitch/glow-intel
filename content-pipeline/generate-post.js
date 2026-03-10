#!/usr/bin/env node
/**
 * Glow Intel — Autonomous Post Generator
 *
 * Usage:
 *   node content-pipeline/generate-post.js              # picks next from queue
 *   node content-pipeline/generate-post.js --slug foo   # specific keyword
 *   node content-pipeline/generate-post.js --dry-run    # no file write
 *
 * Requires env vars (set in .env or Cloudflare/GitHub secrets):
 *   ANTHROPIC_API_KEY   — Claude API key
 *   UNSPLASH_ACCESS_KEY — Unsplash API key (free, get at unsplash.com/developers)
 */

import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ─── Load .env manually (no dotenv dependency needed) ───────────────────────
function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
}
loadEnv();

// ─── Args ───────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const slugArg = args.includes('--slug') ? args[args.indexOf('--slug') + 1] : null;

// ─── Load queue ─────────────────────────────────────────────────────────────
const queuePath = path.join(__dirname, 'keyword-queue.json');
const queue = JSON.parse(fs.readFileSync(queuePath, 'utf-8'));

// Pick target keyword
let target;
if (slugArg) {
  target = queue.queue.find(k => k.slug === slugArg);
  if (!target) { console.error(`Slug "${slugArg}" not found in queue`); process.exit(1); }
} else {
  // Pick highest-priority keyword not yet published
  const highPriority = queue.queue.filter(k =>
    k.priority === 'high' && !queue.published.includes(k.slug)
  );
  target = highPriority[0] || queue.queue.find(k => !queue.published.includes(k.slug));
  if (!target) { console.log('Queue empty — all keywords published!'); process.exit(0); }
}

console.log(`\n📝 Generating post: "${target.keyword}" → ${target.slug}\n`);

// ─── Fetch Unsplash image ────────────────────────────────────────────────────
async function fetchUnsplashImage(query) {
  const key = process.env.UNSPLASH_ACCESS_KEY;
  if (!key) {
    console.warn('No UNSPLASH_ACCESS_KEY — using fallback image');
    return {
      url: 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1200&q=80',
      alt: 'Skincare products on a clean surface',
    };
  }

  const res = await fetch(
    `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${key}` } }
  );
  const data = await res.json();
  const photo = data.results?.[0];
  if (!photo) return null;

  return {
    url: `${photo.urls.raw}&w=1200&q=80&fm=jpg`,
    alt: photo.alt_description || photo.description || query,
  };
}

// ─── Read voice bank for context ────────────────────────────────────────────
function getVoiceContext() {
  const vbPath = path.join(ROOT, 'voice-bank.md');
  if (!fs.existsSync(vbPath)) return '';
  return fs.readFileSync(vbPath, 'utf-8').slice(0, 3000); // First 3000 chars
}

// ─── Read existing posts for internal linking ────────────────────────────────
function getExistingPostSlugs() {
  const blogDir = path.join(ROOT, 'src', 'content', 'blog');
  if (!fs.existsSync(blogDir)) return [];
  return fs.readdirSync(blogDir)
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace('.md', ''));
}

// ─── Generate post with Claude ───────────────────────────────────────────────
async function generatePost(target, image, existingSlugs) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const voiceContext = getVoiceContext();
  const internalLinks = existingSlugs.slice(0, 5).map(s =>
    `- /blog/${s}`
  ).join('\n');

  const systemPrompt = `You are a skincare content writer for Glow Intel, a skincare and beauty ecommerce blog.

VOICE (critical — write like this person):
${voiceContext}

STYLE RULES:
- Intro: 2-3 sentences max. No "In today's world", no "Let's dive in"
- Paragraphs: 3-4 sentences max
- Tone: knowledgeable but direct, opinionated, not academic
- Specific product names + prices when relevant
- H2s should answer questions the reader has
- Length: 1500-2500 words
- NO em-dashes in excess, NO "game-changer", NO "revolutionary", NO "Moreover"/"Furthermore"/"Additionally" to start sentences
- Internal links to existing posts (use the slugs provided)
- 1-2 external links to authoritative sources (PubMed, AAD, reputable dermatologists)

OUTPUT FORMAT: Return ONLY the markdown content starting from the first H2. No frontmatter. No intro paragraph before the first H2. Just the body content.`;

  const userPrompt = `Write a complete blog post for Glow Intel targeting the keyword: "${target.keyword}"

Category: ${target.category}
Slug: ${target.slug}
Notes for this post: ${target.notes}

Available internal links to include (use 2-3 naturally):
${internalLinks}

Write 1500-2500 words. Be specific, opinionated, and useful. No fluff.`;

  console.log('Calling Claude API...');
  const message = await client.messages.create({
    model: 'claude-opus-4-6',
    max_tokens: 4000,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });

  return message.content[0].text;
}

// ─── AI slop scrubber ────────────────────────────────────────────────────────
function scrubAISlop(text) {
  const replacements = [
    [/In today's (world|age|landscape|digital age|fast-paced world)/gi, 'Right now'],
    [/It's worth noting that/gi, ''],
    [/It is worth noting that/gi, ''],
    [/Let's dive (in|deep)/gi, 'Here\'s the breakdown'],
    [/deep dive/gi, 'closer look'],
    [/game.changer/gi, 'real upgrade'],
    [/revolutionary/gi, 'significant'],
    [/groundbreaking/gi, 'solid'],
    [/Without further ado/gi, ''],
    [/^Furthermore,/gm, 'And'],
    [/^Moreover,/gm, 'Also'],
    [/^Additionally,/gm, 'Also'],
    [/^In conclusion,/gm, 'The bottom line:'],
    [/ — /g, ' — '], // normalize em-dashes (max 1 per paragraph is fine)
    [/Firstly,/gi, 'First:'],
    [/Secondly,/gi, 'Second:'],
    [/Thirdly,/gi, 'Third:'],
    [/At the end of the day/gi, 'Ultimately'],
  ];

  let result = text;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// ─── Build frontmatter ───────────────────────────────────────────────────────
function buildFrontmatter(target, image, description) {
  const today = new Date().toISOString().split('T')[0];
  return `---
title: "${target.keyword.charAt(0).toUpperCase() + target.keyword.slice(1)}"
description: "${description}"
pubDate: ${today}
category: "${target.category}"
tags: [${target.notes.split(',').slice(0, 3).map(t => `"${t.trim().split(' ').slice(0, 2).join(' ')}"`).join(', ')}]
heroImage: "${image?.url || 'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=1200&q=80'}"
heroImageAlt: "${image?.alt || target.keyword}"
draft: false
---`;
}

// ─── Extract description from content ────────────────────────────────────────
function extractDescription(content) {
  // Find first sentence-like paragraph after frontmatter
  const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  const firstPara = lines[0] || '';
  return firstPara.slice(0, 155) + (firstPara.length > 155 ? '...' : '');
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Error: ANTHROPIC_API_KEY not set in .env');
    process.exit(1);
  }

  const existingSlugs = getExistingPostSlugs();

  // Fetch image
  console.log('Fetching Unsplash image...');
  const image = await fetchUnsplashImage(target.keyword);
  console.log(`Image: ${image?.url?.slice(0, 60)}...`);

  // Generate content
  const rawContent = await generatePost(target, image, existingSlugs);
  const cleanContent = scrubAISlop(rawContent);

  // Build description from content
  const description = extractDescription(cleanContent);

  // Build full post
  const frontmatter = buildFrontmatter(target, image, description);
  const fullPost = `${frontmatter}\n\n${cleanContent}`;

  if (dryRun) {
    console.log('\n--- DRY RUN OUTPUT ---\n');
    console.log(fullPost.slice(0, 500) + '\n...(truncated)');
    console.log('\n--- END DRY RUN ---');
    return;
  }

  // Write file
  const outputPath = path.join(ROOT, 'src', 'content', 'blog', `${target.slug}.md`);
  fs.writeFileSync(outputPath, fullPost);
  console.log(`\n✓ Post written: src/content/blog/${target.slug}.md`);

  // Update queue — mark as published
  queue.published.push(target.slug);
  queue.queue = queue.queue.filter(k => k.slug !== target.slug);
  queue.meta.lastUpdated = new Date().toISOString().split('T')[0];
  queue.meta.totalPublished = queue.published.length;
  queue.meta.totalQueued = queue.queue.length;
  fs.writeFileSync(queuePath, JSON.stringify(queue, null, 2));
  console.log(`✓ Queue updated (${queue.queue.length} remaining)`);

  console.log(`\n🚀 Next: git add src/content/blog/${target.slug}.md content-pipeline/keyword-queue.json && git commit -m "post: ${target.keyword}" && git push`);
}

main().catch(err => { console.error(err); process.exit(1); });
