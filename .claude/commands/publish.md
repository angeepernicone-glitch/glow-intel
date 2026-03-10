# /publish — Commit and deploy a post

Commit a blog post to GitHub and trigger Cloudflare auto-deploy.

## Instructions

Given a post filename (or "last" to publish the most recently created post):

1. Run `npm run build` — if it fails, fix the error before proceeding
2. Check which post(s) are new/modified with `git status`
3. Stage only the new post file: `git add src/content/blog/[filename].md`
4. Commit with message: `post: [post title]`
5. Push to GitHub: `git push`
6. Confirm push succeeded
7. Report: post title, URL it will be live at, estimated deploy time (~60 seconds)

**Never commit:**
- `.env` files
- `node_modules/`
- Multiple posts at once unless explicitly requested

## Usage
`/publish [filename or "last"]`

Example: `/publish niacinamide-vs-vitamin-c-which-goes-first`
