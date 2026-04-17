# Workflow: Content Publish

## Trigger
Publishing a new blog post or adding a portfolio entry/client story.

## Sequence

### 0. Assign
**Agent**: PM
- Confirm topic aligns with content calendar (`docs/content/content-calendar.md`)
- Verify target keyword from keyword map (`docs/seo/keyword-map.md`)
- Assign to Content agent with deadline

### 1. Content Draft
**Agent**: Content
- **Blog post**: Create markdown file in `src/content/blog/` following schema in `src/content.config.ts`
  - Required frontmatter: title, description, publishDate, coverImage, coverImageAlt, tags
  - Target 1,200-2,000 words with internal links
- **Portfolio entry**: Add/update JSON in `src/data/portfolio.json`
- **Location**: Add/update JSON in `src/data/locations.json`
- Place images in `src/assets/images/` with descriptive SEO-friendly filenames

### 2. SEO Optimization
**Agent**: SEO
- Review title tag and meta description against keyword target
- Verify heading structure (single H1, logical nesting)
- Check internal links (must link to services, portfolio, contact)
- Validate image alt text follows format
- Confirm structured data will generate correctly (BlogPosting for blog, ImageGallery for portfolio)
- Reference `docs/seo/keyword-map.md` — update if new keywords targeted

### 3. Frontend Check
**Agent**: Frontend
- Verify content renders correctly in existing templates
- Check image optimization (Astro Image component processing new images)
- Confirm no layout breaks with content length
- Test responsive rendering on mobile breakpoints

### 4. QA Validation
**Agent**: QA
- Spell check and grammar check
- Verify all links work (internal and external)
- Confirm images load and are optimized (WebP/AVIF)
- Run Lighthouse on the new page
- Check OG preview renders correctly

### 5. Deploy
**Agent**: DevOps
- `pnpm run build` — verify clean
- Deploy to Cloudflare Pages
- Verify page is live and indexable

### 6. Track
**Agent**: Analytics + PM
- Update `docs/content/content-calendar.md` status to `published`
- SEO agent submits URL to Search Console
- Analytics sets 30/90-day performance checkpoints
- Content agent drafts social repurposing assets
