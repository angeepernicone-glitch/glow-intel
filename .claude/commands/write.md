# /write — Write a new blog post

Write a complete, publish-ready blog post for Glow Intel.

## Instructions

Given a keyword or topic, write a full blog post following ALL rules in CLAUDE.md.

**Steps:**
1. Confirm the target keyword and search intent
2. Determine the best category for this post
3. Write the post in Markdown with complete frontmatter
4. Save it to `src/content/blog/[slug].md`
5. Find a relevant Unsplash image URL for the heroImage
6. Run `npm run build` to verify it builds without errors
7. Report back: title, slug, word count, category, and any notes

**The post must:**
- Sound like Angelo (see CLAUDE.md voice section)
- Be 1500-2500 words
- Have H2/H3 structure
- Include 2-3 internal links to existing posts
- Include 1-2 external links to authoritative sources
- Pass the AI slop check (no forbidden phrases from CLAUDE.md)
- Have complete, valid frontmatter

**AI slop check before saving — remove any:**
- "In today's world/age/landscape"
- "It's worth noting/mentioning"
- "Let's dive in / deep dive"
- "Game-changer / revolutionary / groundbreaking"
- "Furthermore / Moreover / Additionally" as sentence starters
- "Without further ado"
- Lists that start "Firstly, Secondly, Thirdly"
- Excessive em-dashes

## Usage
`/write [keyword or topic]`

Example: `/write best retinol for beginners`
