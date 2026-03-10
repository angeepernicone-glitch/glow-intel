# Glow Intel — Claude Instructions

## What this project is
A beauty & skincare blog in English. Built with Astro v6 + Tailwind + Cloudflare Pages. Posts are `.md` files in `src/content/blog/`. Every post committed to GitHub auto-deploys via Cloudflare Pages.

## Stack
- Framework: Astro v6 (static output)
- Styling: Tailwind CSS v4
- Hosting: Cloudflare Pages (auto-deploy on push)
- Repo: GitHub
- Content: Markdown files in `src/content/blog/`

## How to add a new post
1. Create a `.md` file in `src/content/blog/` with the slug as filename
2. Add the required frontmatter (see schema below)
3. Write the content
4. Run `npm run build` to verify no errors
5. Commit and push to GitHub — Cloudflare deploys automatically

## Frontmatter schema (required for every post)
```yaml
---
title: "Post title here"
description: "150-160 char meta description with the keyword"
pubDate: YYYY-MM-DD
category: "versus"  # one of: ingredients | routines | reviews | versus | beauty-business | beginner-guides
tags: ["tag1", "tag2"]
heroImage: "https://images.unsplash.com/photo-XXXXX?w=1200&q=80"
heroImageAlt: "Descriptive alt text for the image"
draft: false
---
```

## Voice & Tone (CRITICAL — read this before writing any post)

The blog owner is Angelo — a freelance web developer who also runs a skincare business. Posts must sound like HIM, not like a generic AI.

**His voice:**
- Science-first but not academic. Explains things simply.
- Optimization mindset: "less is more" with routines, rather than 10-product stacks
- Direct and opinionated — says "this is overpriced" or "this is actually worth it"
- Informal contractions (don't, it's, you'll) — not stiff
- References specific products with real prices (e.g. "The Ordinary Niacinamide 10% + Zinc 1% (~$7)")
- Skeptical of hype, but respects the science when it exists
- Hates unnecessary disclaimers and filler

**His skincare opinions (from voice bank):**
- Less is more — 3-4 products with scientific backing beats a 10-step routine
- Favorite ingredients: niacinamide, tretinoin/retinol, hyaluronic acid, zinc
- Vitamin C is good IF well-formulated (many products have it for marketing, not efficacy)
- CeraVe and The Ordinary are genuinely good value
- Clean beauty is interesting but nutrition matters more
- Skinimalism: yes
- SPF 50 from European brands preferred (better formulations)
- Skincare for men is different in focus/messaging, not necessarily different products
- Dermatologists on TikTok: some are good, many just want followers. Always verify.
- Tretinoin is underrated — derms don't promote it enough
- The #1 mistake beginners make: buying a complex routine all at once without testing
- Start with a skin analysis before buying anything

**His ecommerce opinions:**
- Marketing wins first, then the store has to convert, then the product has to be good
- Most beauty brands focus too much on "who we are" — customers only care what the product does for them
- Mobile optimization is non-negotiable (80%+ of buyers are on phones)
- Shopify is the best platform for beauty ecommerce
- Influencer marketing works — even if it feels cheap
- Ecommerce beauty is still early — massive growth ahead
- Video/Reels/TikTok is the most effective content for selling skincare

## Style rules
- Intro: 2-3 sentences MAX. State what the post covers immediately. No "In today's world..."
- Paragraphs: 3-4 sentences max
- H2s: clear, informational, can be questions the reader would ask
- Length: 1500-2500 words. Don't pad.
- No em-dashes in excess (—)
- No: "game-changer", "revolutionary", "dive deep", "let's explore", "it's worth noting"
- No: "Furthermore", "Moreover", "Additionally" as sentence starters
- No more than 2 emojis per post (ideally zero)
- Yes: specific product names + prices, "I think" / "In my experience", direct comparisons
- Yes: "the catch" — honest about limitations

## SEO rules
- Keyword in: title, H1, first paragraph, meta description, URL slug
- Meta description: 150-160 chars, compelling, includes keyword
- Internal links: 2-3 links to other posts per article
- External links: 1-2 links to authoritative sources (studies, PubMed, dermatologist sites)
- URL = filename = `/blog/keyword-phrase-here`

## Content categories
1. `ingredients` — niacinamide, retinol, vitamin C, HA, AHA/BHA, etc.
2. `routines` — AM/PM, oily/dry/combination skin, beginners, anti-aging
3. `reviews` — specific products, honest
4. `versus` — A vs B comparisons
5. `beauty-business` — ecommerce, brand building, trends, DTC
6. `beginner-guides` — starting skincare, skin types 101, building a routine

## Build & deploy commands
```bash
npm run dev      # local dev server at localhost:4321
npm run build    # build to /dist — run this before committing
git add src/content/blog/new-post.md
git commit -m "post: title of post"
git push         # triggers Cloudflare auto-deploy
```

## Files to know
- `src/content/blog/` — all posts go here
- `src/content.config.ts` — content collection schema
- `src/layouts/BlogPost.astro` — post layout
- `src/pages/blog/[...slug].astro` — post route
- `astro.config.mjs` — update `site:` when domain is bought
- `public/robots.txt` — update sitemap URL when domain changes

## Important: domain not set yet
The site URL in `astro.config.mjs` is set to `https://glowintel.com` as placeholder. Update it when the real domain is purchased.
