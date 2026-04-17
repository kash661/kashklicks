# /blog SEO Audit — 2026-04-17

**Scope:** `/blog` (`src/pages/blog/index.astro`), `public/llms.txt`, `public/mirrors/` (missing), `dist/sitemap-0.xml`
**Auditor:** Claude (page-seo-audit skill)
**Status:** Findings + fixes applied

---

## TL;DR

The blog index has solid scaffolding: title, description, canonical (`https://kashklicks.ca/blog/`), OG/Twitter, a single `LocalBusiness` from `BaseLayout`, a `BreadcrumbList` from the Breadcrumbs component, one `<h1>`, the route is in the sitemap with `<lastmod>`. Three gaps:

1. **No blog-level structured data.** The page emits zero page-specific JSON-LD — no `Blog`, no `CollectionPage`, no `ItemList`. Google has to infer that this is a blog listing from the URL alone.
2. **No markdown mirror.** `public/mirrors/` has `home`, `about`, `services`, and all four service sub-pages — but no `blog.md`. LLM crawlers that weight `/mirrors/*.md` (GPTBot, PerplexityBot) see nothing clean.
3. **H1 and title are emotional-only.** H1 is "Stories & Guides" (pure tagline); title is `Blog | AD Photography` (18 chars, generic). Target keyword per `docs/seo/keyword-map.md` is "Toronto wedding photography blog" — neither element carries it.

Everything else is polish.

---

## P0 — Fix before next deploy

### 1. No `Blog` / `CollectionPage` JSON-LD

**File:** `src/pages/blog/index.astro:12-14` (the `<BaseLayout>` opening tag)

**Current:**
```astro
<BaseLayout
  title="Blog"
  description="Tips, guides, and behind-the-scenes stories from AD Photography. Wedding planning advice, Toronto location guides, and photography inspiration."
>
```

No `jsonLd` prop is passed. `dist/blog/index.html` contains only the site-wide `LocalBusiness` and the `BreadcrumbList` from Breadcrumbs — no `Blog`/`CollectionPage`/`ItemList`.

**Fix:** build a `Blog` schema from the content collection at render time and pass it through:

```astro
---
import BaseLayout from '../../layouts/BaseLayout.astro';
import Breadcrumbs from '../../components/seo/Breadcrumbs.astro';
import { Image } from 'astro:assets';
import { getCollection } from 'astro:content';
import site from '../../data/site.json';

const posts = (await getCollection('blog', ({ data }) => !data.draft))
  .sort((a, b) => b.data.publishDate.valueOf() - a.data.publishDate.valueOf());

const blogSchema = {
  '@context': 'https://schema.org',
  '@type': 'Blog',
  '@id': `${site.url}/blog/#blog`,
  url: `${site.url}/blog/`,
  name: 'AD Photography Journal',
  description: 'Toronto wedding photography tips, engagement shoot guides, and location features from AD Photography.',
  inLanguage: 'en-CA',
  publisher: { '@id': `${site.url}/#business` },
  blogPost: posts.map((post) => ({
    '@type': 'BlogPosting',
    '@id': `${site.url}/blog/${post.id}/`,
    headline: post.data.title,
    description: post.data.description,
    url: `${site.url}/blog/${post.id}/`,
    datePublished: post.data.publishDate.toISOString(),
    ...(post.data.updatedDate && { dateModified: post.data.updatedDate.toISOString() }),
    author: { '@type': 'Person', name: post.data.author },
    keywords: post.data.tags.join(', '),
  })),
};
---

<BaseLayout
  title="Toronto Wedding Photography Journal"
  description="Toronto wedding photography tips, engagement shoot guides, and location features from AD Photography — candid, cinematic, honest."
  jsonLd={blogSchema}
>
```

Keep the `BreadcrumbList` emitting from the Breadcrumbs component — two schemas is correct here.

### 2. No `public/mirrors/blog.md`

**File:** `public/mirrors/blog.md` (missing)

Every other top-level page has a mirror. Blog is listed in `llms.txt` but with no mirror registered, LLM crawlers get HTML-with-CSS instead of a clean markdown summary. Create `public/mirrors/blog.md` with:

- Title, description, canonical URL.
- One line per published post: headline, 1–2 sentence summary, publish date, URL.
- Short positioning paragraph.

Then register it in `llms.txt` under the "Markdown Mirrors" section.

### 3. H1 missing target keyword

**File:** `src/pages/blog/index.astro:24`

**Current:**
```astro
<h1 class="text-display-md char-reveal" style="margin-top: var(--spacing-element);">Stories & Guides</h1>
```

Keyword map says primary keyword for `/blog` is "Toronto wedding photography blog". H1 reads "Stories & Guides" — pure tagline.

**Fix:** same pattern as the /about fix from 2026-04-16 — keep the visual serif display, but wrap an italic keyword subtitle inside the same `<h1>` so crawlers read the full phrase:

```astro
<h1 class="text-display-md char-reveal" style="margin-top: var(--spacing-element);">
  <span class="block">Stories & Guides</span>
  <span class="block text-body-lg italic text-on-surface-variant" style="margin-top: var(--spacing-tight); letter-spacing: 0;">
    Toronto wedding photography journal
  </span>
</h1>
```

Visual hierarchy unchanged; the keyword phrase becomes part of the heading.

### 4. Title tag wastes SEO real estate

**File:** `src/pages/blog/index.astro:12`

**Current:** `title="Blog"` → renders as `<title>Blog | AD Photography</title>` (18 chars used, ~60 available).

**Fix:** change the prop:

```astro
title="Toronto Wedding Photography Journal"
```

Renders to 57 chars: `Toronto Wedding Photography Journal | AD Photography`. Includes geo + role + content-type.

Description also tightens:

```
"Toronto wedding photography tips, engagement shoot guides, and location features from AD Photography — candid, cinematic, honest."
```

One note: the description above uses an em dash. Replace with a comma per `feedback_no_em_dashes.md`:

```
"Toronto wedding photography tips, engagement shoot guides, and location features from AD Photography. Candid, cinematic, honest."
```

---

## P1 — Next iteration

### 5. Blog cover images emit WebP only (no AVIF)

**File:** `src/pages/blog/index.astro:37-44`

**Current:**
```astro
<Image
  src={post.data.coverImage}
  alt={post.data.coverImageAlt}
  widths={[400, 600]}
  sizes="(max-width: 768px) 100vw, 33vw"
  loading="lazy"
  class="w-full h-full object-cover cubic-ease group-hover:scale-[1.02]"
  style="transition-duration: var(--duration-slow);"
/>
```

Built HTML srcset shows only `.webp` variants. No `format` or `quality` prop — Astro defaults to WebP q80.

**Fix:** add AVIF + explicit quality:

```astro
<Image
  src={post.data.coverImage}
  alt={post.data.coverImageAlt}
  widths={[400, 600]}
  sizes="(max-width: 768px) 100vw, 33vw"
  format="avif"
  quality={80}
  loading="lazy"
  class="w-full h-full object-cover cubic-ease group-hover:scale-[1.02]"
  style="transition-duration: var(--duration-slow);"
/>
```

These are small (400w / 600w) below-fold images, so the savings are modest, but consistency with portfolio cards is worth it.

### 6. First blog card is above the fold on desktop but `loading="lazy"`

On 1440×900 screens, the first blog card's cover image is within the initial viewport. `loading="lazy"` defers it, so the browser waits a tick before fetching. Not disastrous (CWV counts only the LCP element), but on a page where photographs are the point, the first one should render immediately.

**Consider:** add `i === 0 ? 'eager' : 'lazy'` (plus matching `fetchpriority`) to the first card. Deferring — text LCP is more likely on this layout (header is text), and a single `fetchpriority="high"` on the hero `<h1>` area isn't applicable. Skip for now, revisit if CWV regresses.

### 7. Description could lead with target keyword

Currently leads with "Tips, guides…". Moving "Toronto wedding photography" to the front loads the primary keyword earlier in the snippet. Addressed in P0 fix #4 above.

---

## P2 — Nice-to-haves

### 8. Consider an `ItemList` schema in addition to `Blog`

`ItemList` helps Google parse the cards as distinct items. Overlap with `Blog.blogPost` is fine — both can coexist. Defer until more posts ship; with two posts the schema weight isn't worth the head-bloat.

### 9. Blog-level RSS/Atom feed

Standard for a journal. Not an SEO fix per se, but increases distribution surface (Feedly, aggregators, LLM crawlers). Astro has a first-party integration (`@astrojs/rss`). Separate task.

### 10. "Related posts" block on individual blog posts

Each `/blog/{slug}` page could link to the other post. Not this audit's scope, but worth tracking — internal linking helps both posts rank.

---

## What's already good (don't regress)

- Exactly one `<h1>` in `dist/blog/index.html`.
- Exactly one `LocalBusiness` (site-wide emission from `BaseLayout`).
- `BreadcrumbList` present with Home → Blog hierarchy.
- Canonical `https://kashklicks.ca/blog/` matches sitemap entry, trailing slash consistent.
- `<time datetime="...">` wraps each publish date — machine-readable.
- Post titles render as `<h2>` — correct hierarchy under the page `<h1>`.
- Image alt text is descriptive with subject + location + "AD Photography" (e.g., `Ayushi and Parth pre-wedding shoot at a Toronto location, wide cinematic landscape by AD Photography`).
- Draft filter (`!data.draft`) in `getCollection` means unpublished posts don't leak.
- Posts sorted newest first.
- `posts.length === 0` fallback copy present (no empty-state layout break).
- No em dashes in the page body (post index copy is clean — only the description I'm replacing had one).
- Route present in `dist/sitemap-0.xml` with `<lastmod>` set by the sitemap integration.

---

## Priority punch list (copyable)

- [x] P0 — Add `Blog` JSON-LD schema to `src/pages/blog/index.astro` with `blogPost` list built from the content collection.
- [x] P0 — Create `public/mirrors/blog.md`; register it under "Markdown Mirrors" in `public/llms.txt`.
- [x] P0 — Wrap H1 with keyword subtitle ("Toronto wedding photography journal").
- [x] P0 — Change `title` prop from `"Blog"` to `"Toronto Wedding Photography Journal"`; update description to lead with target keyword and drop the em dash.
- [x] P1 — Add `format="avif"` and `quality={80}` to the blog card `<Image>`.
- [ ] P2 — Add RSS feed (separate ticket).
- [ ] P2 — Add "Related posts" block on individual blog posts (separate ticket).

---

## Needs input from Akash (not fixed here)

- `YOUR_CF_ANALYTICS_TOKEN` in `BaseLayout.astro` — still a placeholder site-wide.
- `YOUR_FORMSPREE_ID` in `ContactForm.astro` — not on this page but flagged site-wide.
