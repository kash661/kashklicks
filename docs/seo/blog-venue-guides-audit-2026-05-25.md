# Blog Venue Guides SEO + LLM Audit — 2026-05-25

**Scope:** `/blog/adamson-estate-wedding-photography-guide/` + `/blog/aera-toronto-wedding-venue-guide/`
**Source files:** `src/content/blog/{adamson-estate-wedding-photography-guide,aera-toronto-wedding-venue-guide}.md`
**Auditor:** Claude
**Status:** Findings + fixes applied

---

## TL;DR

Both venue guide posts ship with clean H1, breadcrumbs, BlogPosting + LocalBusiness schema, AVIF heroes with `fetchpriority="high"`, and correct canonicals + sitemap entries. Three site-wide issues affect every blog post (not just these two): OG image falls back to the generic `/og-default.jpg`, FAQPage schema is missing despite every recent post containing a visible FAQ section, and the journal-level mirror (`public/mirrors/blog.md` + `public/llms.txt` "Blog" section) lists only the original 2 posts and is now 4 posts stale. Per-post: the Aera title overshoots SERP truncation by ~30 chars.

For LLM access specifically: `robots.txt` is already correctly configured (TRAINING crawlers blocked, SEARCH/CITATION crawlers explicitly allowed). The discoverability work is on the content side: mirror files, llms.txt sync, and structured-data quality.

---

## P0 — Fix before next deploy

### 1. Blog OG image falls back to generic placeholder

`src/layouts/BlogLayout.astro:55-66` calls `<BaseLayout title={title} description={description} ogType="article" ...>` without passing the `ogImage` prop. As a result, `src/components/seo/SEO.astro:22` falls through to the default `/og-default.jpg`.

**Built HTML confirms:**
```
<meta property="og:image" content="https://kashklicks.ca/og-default.jpg">
```
on both new posts.

**Impact:** Every social share, Discord/Slack unfurl, ChatGPT browsing preview, and Perplexity citation card for *every* blog post shows the generic site OG instead of the post's actual cover image. This is a site-wide bug, not just these two posts.

**Fix:** In `BlogLayout.astro`, pass `coverImage.src` through to BaseLayout as an absolute URL.

```astro
const ogImageUrl = coverImage ? new URL(coverImage.src, Astro.site).href : undefined;
```

Then `<BaseLayout ... ogImage={ogImageUrl}>`.

### 2. Aera title overshoots SERP truncation

Built `<title>` is `"Aera Toronto Wedding Guide: Inside the Financial District's Cinematic Venue | AD Photography"` — 93 chars. Google SERP truncates around 55–60 chars, so the visible portion ends mid-clause and the keyword tail (`Cinematic Venue`) never displays.

**Fix:** Shorten frontmatter `title` to keep `Aera Toronto Wedding` in the first 30 chars and drop the descriptive tail. Suggested: `"Aera Toronto Wedding Guide: A Photographer's Look"` (49 chars + " | AD Photography" suffix = 66 chars; primary keyword in first 20 chars).

### 3. FAQPage schema is missing

Both posts have a `## Frequently asked questions` H2 with 6 Q&A pairs each, but no `FAQPage` JSON-LD is emitted. AI search engines (Perplexity, ChatGPT browsing, Claude with web) preferentially extract Q&A from structured FAQ schema. Without it, these answers stay buried in prose.

**Built HTML confirms:**
```
$ grep -c 'FAQPage' dist/blog/adamson-estate-wedding-photography-guide/index.html
0
```

**Fix:** Extend the content collection schema (`src/content.config.ts`) with an optional `faq` array. Update `BlogLayout.astro` to accept the `faq` prop and inject a `FAQPage` JSON-LD when present. Add `faq:` blocks to both posts' frontmatter mirroring the rendered questions.

### 4. llms.txt blog list is 4 posts stale

`public/llms.txt` "Blog" section currently lists 2 posts:
- `best-toronto-pre-wedding-locations`
- `what-to-wear-pre-wedding-shoot`

Missing all of these, all currently in `dist/sitemap-0.xml`:
- `best-toronto-sunrise-photo-locations-lake-ontario`
- `aera-toronto-wedding-grace-giovanni`
- `hamilton-wedding-st-patricks-dundurn-roxanne-justin`
- `adamson-estate-wedding-photography-guide` (new)
- `aera-toronto-wedding-venue-guide` (new)

**Impact:** When an LLM fetches `llms.txt` to enumerate site content, it sees 4 fewer posts than exist and may cite stale top-of-site items instead of recent venue guides.

**Fix:** Replace the Blog section with all 6 posts, each with title + URL + 1-line summary. Same template as the existing entries.

---

## P1 — Next iteration

### 5. `public/mirrors/blog.md` is 4 posts stale

Same drift as llms.txt — only the original 2 posts are listed. Fix: refresh with all 6, including 2-sentence summaries to give LLM context without forcing a fetch of every post.

### 6. No per-post mirrors

`public/mirrors/` has page-level mirrors (home, about, services-*, contact, location-guide, blog) but no per-blog-post mirrors. For high-intent venue guides, adding `public/mirrors/blog/<slug>.md` files lets LLMs grab a clean markdown copy of the full post without parsing HTML.

**Fix:** Create:
- `public/mirrors/blog/adamson-estate-wedding-photography-guide.md`
- `public/mirrors/blog/aera-toronto-wedding-venue-guide.md`

Each: title, URL, publish date, tags, full body (stripped of image markdown, keeping link text for inline references).

### 7. No portfolio reverse-links

The portfolio galleries for `ayushi-parth-adamson` and `grace-giovanni` don't link forward to their corresponding new blog venue guides. Internal linking from a high-PageRank portfolio page to a fresh blog post is one of the fastest ways to get the post indexed and ranked.

**Fix:** Add a "Read the venue guide" link in the portfolio detail template (or to the per-portfolio metadata in `portfolio.json` if the template is dynamic) for these two galleries.

### 8. No /location-guide reverse-links

`/location-guide/adamson-estate` and `/location-guide/aera-toronto` (rendered from `locations.json` via `src/pages/location-guide/[slug].astro`) don't link forward to the new blog guides. Same internal-link logic as #7.

**Fix:** Add an optional `blogGuideSlug` field on the location-guide entries in `locations.json` for Adamson and Aera. The slug template should render a "Photographer's deep-dive guide" link when present.

---

## P2 — Nice-to-haves

### 9. BlogPosting schema missing `wordCount`

Astro markdown doesn't expose word count automatically. Could add a computed prop in `[...slug].astro`. Marginal SEO value — defer.

### 10. ContactForm doesn't read `?venue=` param

Both posts' CTAs link to `/contact?venue=adamson-estate` / `/contact?venue=aera-toronto`, but `ContactForm.astro` doesn't read the param to prefill the message body. Inquiries arrive untagged. Add ~5 lines of init JS.

### 11. Adamson title slightly long (79 chars total)

`A Wedding Photographer's Guide to Adamson Estate, Mississauga | AD Photography` — also overshoots SERP truncation but the keyword `Adamson Estate` lands in the visible portion. Lower priority than Aera fix.

---

## What's already good (don't regress)

- `BlogLayout.astro` already emits `BlogPosting` schema with author, datePublished, image, headline, description, publisher.
- `src/components/seo/SEO.astro` correctly handles `ogType="article"` + article tags + Twitter card.
- Hero image is AVIF + `fetchpriority="high"` + `loading="eager"` (verified in `dist/blog/*/index.html`).
- 10 body images per post are AVIF/WebP + `loading="lazy"` + `fetchpriority="auto"`.
- H1 hierarchy is clean: single H1, 9 H2s in TOC-friendly order.
- Sitemap entries present with `lastmod`.
- Canonical URLs correct on both.
- LocalBusiness schema emitted once site-wide via `BaseLayout`, not duplicated per-post.
- **Robots.txt:** TRAINING crawlers blocked (GPTBot, ClaudeBot, Google-Extended, CCBot, etc.), SEARCH/CITATION crawlers explicitly allowed (OAI-SearchBot, ChatGPT-User, PerplexityBot, Perplexity-User). This is the optimal config for LLM-citation visibility without giving up training rights.
- Both posts' meta descriptions are 154 chars (sweet spot).
- Alt text follows the `[subject] [scene] at [venue spot] by AD Photography, [light/mood]` pattern.

---

## Needs input from Akash

- **Cover image picks:** Image numbers were chosen blind (no visual access to the JPEG content). Eyeball both covers + body images on the live site and swap any that don't fit.
- **Manual GSC indexing:** Submit both URLs to Google Search Console > Inspect URL > Request Indexing within 1 hour of deploy. Cannot be automated.

---

## Priority punch list (copyable)

- [x] **P0** — Fix BlogLayout to pass coverImage as ogImage (`BlogLayout.astro:55-66`)
- [x] **P0** — Shorten Aera title in frontmatter (`aera-toronto-wedding-venue-guide.md:2`)
- [x] **P0** — Add FAQPage schema: extend `content.config.ts`, extend `BlogLayout.astro`, add `faq:` to both posts' frontmatter
- [x] **P0** — Update `public/llms.txt` Blog section with all 6 posts + the 2 new venue guide mirror URLs
- [x] **P1** — Refresh `public/mirrors/blog.md` with all 6 posts
- [x] **P1** — Create `public/mirrors/blog/adamson-estate-wedding-photography-guide.md`
- [x] **P1** — Create `public/mirrors/blog/aera-toronto-wedding-venue-guide.md`
- [x] **P1** — Add reverse-link from Ayushi+Parth Adamson portfolio gallery to new Adamson post
- [x] **P1** — Add reverse-link from Grace+Giovanni portfolio gallery to new Aera post
- [x] **P1** — Add reverse-link from `/location-guide/adamson-estate` to new Adamson post
- [x] **P1** — Add reverse-link from `/location-guide/aera-toronto` to new Aera post
- [ ] **P2** — ContactForm reads `?venue=` query param and prefills message body
- [ ] **P2** — Add `wordCount` to BlogPosting schema
- [ ] **P2** — Shorten Adamson title (lower priority — keyword still lands in visible truncation)
- [ ] **Manual** — Submit both URLs to GSC for indexing
- [ ] **Manual** — Eyeball image picks on live site + swap any that don't fit
