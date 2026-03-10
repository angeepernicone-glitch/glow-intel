# /research — Keyword research for a topic

Find the best keywords to target for a new blog post.

## Instructions

Given a broad topic or seed keyword, research and return a list of specific keywords to target.

**Steps:**
1. Use WebSearch to search Google for: `[topic] site:google.com/search` variations
2. Search for "People Also Ask" questions around the topic
3. Look at what related keywords come up in search suggestions
4. Evaluate each keyword by:
   - Search intent (informational = good for this blog)
   - Long-tail vs head term (prefer 3+ word phrases)
   - Competition level (avoid keywords dominated by Sephora, Allure, Byrdie, etc.)

**Return a table with:**
| Keyword | Intent | Difficulty | Notes |
|---------|--------|------------|-------|
| ...     | info   | low/med    | ...   |

**Also suggest:**
- The single best keyword to write about next (with reasoning)
- 2-3 H2 ideas for that post

## Usage
`/research [topic or seed keyword]`

Example: `/research retinol for beginners`
