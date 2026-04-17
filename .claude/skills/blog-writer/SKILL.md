---
name: blog-writer
description: "Write a blog post for a portfolio session. Selects a hero image, writes SEO-optimized content, and adds it to the blog. Use when asked to 'write a blog', 'create a blog post', 'blog about this shoot', or 'write about this session'."
---

# Blog Writer

**Status: STUB - Not yet implemented**

## Purpose
Takes a completed portfolio gallery and generates a blog post about the session. This drives SEO (local search for "Toronto wedding photographer at [location]") and gives prospective clients a deeper look into what a session feels like.

## Inputs
- Portfolio slug (to find images and story from portfolio.json)
- Gallery images (to select a hero/cover image for the blog post)
- Story from story-generator (the editorial narrative)

## Output
- New markdown file in `src/content/blog/{slug}.md` with frontmatter
- Cover image selected from the gallery (different from portfolio cover for variety)
- SEO-optimized title targeting location + session type keywords
- 500-800 word post in Akash's voice
- Cross-links to the portfolio gallery page
- Tags for blog categorization

## Blog Post Structure
1. Hook (what made this session special)
2. Location context (why this spot, what it offers photographers/couples)
3. The session story (pulled from story-generator, expanded)
4. 2-3 inline images from the gallery
5. CTA (book your session)

## Key Constraints
- Never use em dashes or en dashes
- Write in first person as Akash
- Include location-specific keywords naturally (Toronto, GTA, neighborhood names)
- Link to the portfolio gallery page
- Link to the location guide page if one exists

## Pipeline Position
```
story-generator → blog-writer (YOU)
```
Consumes the story from story-generator and the images from image-selector.