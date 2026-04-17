# Portfolio Section SEO Audit — 2026-04-17

**Scope:** `/portfolio`, `/portfolio/weddings`, `/portfolio/pre-weddings`, `/portfolio/civil-ceremony`, `/portfolio/films`, and the shared `/portfolio/[slug]` template (`src/pages/portfolio/*.astro`).
**Auditor:** Claude
**Status:** Findings + fixes applied

---

## TL;DR

Post-redesign the structural scaffolding (meta, canonical, OG, AVIF LCP, `ImageGallery` JSON-LD, single `LocalBusiness` via `BaseLayout`, sr-only `BreadcrumbList`) is all in place on every route. The redesign introduced three new problems: (1) the hero H1 is now a tagline with zero keywords on 4 of 5 pages, (2) `/portfolio/films` ships an em-dash in its meta description and OG/Twitter tags (AI-tell, Akash's memoryed rule), (3) portfolio section has no Markdown mirrors and isn't listed in `llms.txt` under Mirrors. Cover-card alt text is also missing the event type.

---

## P0 — Fix before next deploy

### P0.1 — Em-dashes on `/portfolio/films` meta description, OG:description, Twitter:description

**Where:** `src/pages/portfolio/films.astro:43`
**Current:**
```astro
description="Cinematic Toronto wedding and pre-wedding films by AD Photography. Motion, sound, and feeling — watch love stories unfold."
```
**Why:** Memory rule `feedback_no_em_dashes.md` — em/en dashes are an AI tell and banned across site copy. Three instances in rendered HTML (meta name, og:description, twitter:description).
**Fix:** Replace ` — ` with `. ` (or a comma).
```astro
description="Cinematic Toronto wedding and pre-wedding films by AD Photography. Motion, sound, and feeling. Watch love stories unfold."
```

### P0.2 — H1 is tagline with no keywords on 4 of 5 portfolio pages

Visual design is "big serif mood line, small sans eyebrow above". That's fine visually but it leaves the `<h1>` with no target keywords. Google uses H1 as a strong ranking signal — the H1 should carry the page's primary keyword.

**Current H1s (from `dist/{route}/index.html`):**
| Route | H1 | Target keyword | Keyword in H1? |
|---|---|---|---|
| `/portfolio` | "Capturing the unspoken." | Toronto wedding photography portfolio | ❌ |
| `/portfolio/weddings` | "Toronto Wedding Day Stories." | Toronto wedding photographer | ✅ |
| `/portfolio/pre-weddings` | "Before the big day." | Toronto pre-wedding photography | ❌ |
| `/portfolio/civil-ceremony` | "Intimate, uncomplicated." | Civil ceremony photographer Toronto | ❌ |
| `/portfolio/films` | "Love, in motion." | Toronto wedding videographer | ❌ |

**Fix pattern:** Keep the tagline as the big visual serif display, but wrap it in a semantic `<p>` (with matching display classes) and promote the existing eyebrow (category + location phrase) to the `<h1>`, using label typography so the visual hierarchy is unchanged but the semantic one is keyword-correct. Simpler alternative: edit the tagline text to include the keyword. Both work — second is faster, we use it here.

Specific edits:

- `/portfolio` (`src/pages/portfolio/index.astro:102`): change `Capturing the <em>unspoken.</em>` → `Toronto wedding <em>photography portfolio.</em>`
- `/portfolio/pre-weddings` (`src/pages/portfolio/pre-weddings.astro:60`): change `Before the <em>big day.</em>` → `Toronto pre-wedding <em>photography.</em>`
- `/portfolio/civil-ceremony` (`src/pages/portfolio/civil-ceremony.astro:60`): change `Intimate, <em>uncomplicated.</em>` → `Toronto civil <em>ceremony photography.</em>`
- `/portfolio/films` (`src/pages/portfolio/films.astro:60`): change `Love, <em>in motion.</em>` → `Toronto wedding <em>films.</em>`

Weddings H1 (`Toronto Wedding Day Stories.`) already contains the target phrase; leave it.

---

## P1 — Next iteration

### P1.1 — Cover card alt text missing event type

**Where:** `src/components/ui/PortfolioCard.astro:19`
**Current:** `alt={`${couple}, ${location}`}`
**Why:** Skill target pattern is `[subject], [event type], [location]`. Cards render across the portfolio hub and every category grid — this is the most-repeated alt text on the site.
**Fix:** Include the `category` prop, formatted as `Toronto wedding photography` / `Toronto pre-wedding photography` / etc.:
```astro
alt={`${couple}, ${categoryLabel(category)} in ${location}`}
```
with a helper that maps `'wedding' → 'Toronto wedding photography'`, `'pre-wedding' → 'Toronto pre-wedding photography'`, etc.

### P1.2 — No Markdown mirrors for portfolio routes

**Where:** `public/mirrors/` has mirrors for home, about, blog, contact, location-guide, services (5) — nothing for portfolio.
**Why:** Mirrors feed LLM crawlers clean markdown of each page. Skill criteria: mirrors should exist for key pages including portfolio.
**Fix:** Create `public/mirrors/portfolio.md`, `portfolio-weddings.md`, `portfolio-pre-weddings.md`, `portfolio-civil-ceremony.md`, `portfolio-films.md`. Each mirrors the page's H1, hero copy, featured cover list (couple + location + link), philosophy quote, and CTA. Applied in this pass.

### P1.3 — `llms.txt` Markdown Mirrors list omits portfolio

**Where:** `public/llms.txt:75-87`
**Current:** Mirror list covers home, about, services (x4 + overview), blog, contact, location-guide. No portfolio entries.
**Fix:** Append 5 portfolio mirror entries under "Markdown Mirrors" (matching the new files from P1.2).

---

## P2 — Nice-to-haves

### P2.1 — Add `about` field to each page's `ImageGallery` JSON-LD

Right now the `ImageGallery` has `name`, `description`, `url`, `creator`, `image[]`. Adding `about: { @type: 'Thing', name: 'Toronto wedding photography' }` (varied per page) gives Google an explicit topic hint. Marginal gain but free.

### P2.2 — Add a short internal-link block on each category page back to the other 3 categories

Improves on-page link equity distribution. Right now each category page only links outward via the nav and the "View All Work" fallback CTA when empty. A small "Other chapters" block near the footer would route crawl budget across the whole category cluster.

### P2.3 — Consider `CollectionPage` as a secondary schema on `/portfolio` index

`ImageGallery` is good. `CollectionPage` would let Google understand that `/portfolio` is a hub page and the 4 chapter links are sub-collections. Low effort, uncertain gain.

---

## Needs input from Akash

None on this pass. `og-default.jpg` is site-wide and flagged in prior audits; unchanged here.

---

## What's already good (don't regress)

- Single `LocalBusiness` per page (correctly emitted once via `BaseLayout.astro`, not duplicated on any route).
- `BreadcrumbList` emitted on every category page via the sr-only component.
- Unique `ImageGallery` per page with proper business `@id` reference.
- AVIF hero with `fetchpriority="high"` + `loading="eager"` + `quality={75}` on every route.
- Canonicals correct, trailing-slash consistent.
- Meta titles 50–65 chars, meta descriptions 140–170 chars.
- OG `image:width/height/alt` present. Twitter card type `summary_large_image`.
- Section alternation avoids `bg-surface-dark` as final section (no footer merge).
- H2 cadence reads like a TOC on each page.
- Sitemap includes every portfolio route with `lastmod`.
- `ImageObject` entries inside `ImageGallery` include `contentLocation` with place name — good local-SEO hint.

---

## Priority punch list

- [x] P0.1 — Remove em-dash from `films.astro` description
- [x] P0.2 — Rewrite H1 on `/portfolio`, `/portfolio/pre-weddings`, `/portfolio/civil-ceremony`, `/portfolio/films` to include target keyword
- [x] P1.1 — PortfolioCard alt text includes event type
- [x] P1.2 — Create 5 portfolio mirror files under `public/mirrors/`
- [x] P1.3 — Add 5 portfolio entries to `llms.txt` mirror list
- [ ] P2.1 — Add `about` field to `ImageGallery` schema on each page
- [ ] P2.2 — Add cross-chapter internal-link block on each category page
- [ ] P2.3 — Add `CollectionPage` schema on `/portfolio` index
