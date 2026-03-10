# /optimize — Improve an existing post

Audit and improve an existing blog post for SEO, voice, and quality.

## Instructions

Given a post filename or slug:

1. Read the post from `src/content/blog/[slug].md`
2. Run a full audit:

**SEO audit:**
- Is the keyword in title, H1, first paragraph, meta description, URL?
- Is the meta description 150-160 chars?
- Are there 2-3 internal links?
- Are there 1-2 external links to authoritative sources?
- Is the URL slug clean (lowercase, hyphens)?

**Voice audit:**
- Does it sound like Angelo or like a generic AI?
- Are there any forbidden phrases (see CLAUDE.md)?
- Is the intro longer than 3 sentences?
- Are paragraphs longer than 4 sentences?
- Is there unnecessary padding?

**Structure audit:**
- Is the H2/H3 structure clear?
- Are H2s answering questions the reader would have?
- Is the word count 1500-2500?

3. List all issues found
4. Ask for approval before making changes
5. Apply approved changes
6. Run `npm run build` to verify

## Usage
`/optimize [slug or filename]`

Example: `/optimize niacinamide-vs-vitamin-c-which-goes-first`
