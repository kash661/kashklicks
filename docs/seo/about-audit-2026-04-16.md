# About Page SEO Audit — 2026-04-16

**Scope:** `/about` (`src/pages/about.astro`)
**Auditor:** Claude (page-seo-audit skill)
**Status:** Findings + fixes applied

---

## TL;DR

The /about page has clean scaffolding (one H1, `LocalBusiness` only emitted once from BaseLayout, `Person` + `BreadcrumbList` schemas present, canonical correct, alt text descriptive), but it fumbles the three SEO primitives that matter most for a bio page: (1) the H1 is pure tagline ("The Quiet Observer") with zero keyword signal, (2) the title tag is only 33 chars and omits Toronto/photographer, and (3) the LCP portrait renders as WebP q90 instead of AVIF q75. There is also no `public/mirrors/about.md` yet, which leaves LLM crawlers without a clean version of the page.

---

## P0 — Fix before next deploy

### 1. H1 carries no keyword
**File:** `src/pages/about.astro:38`
**Current:** `<h1 class="text-display-lg char-reveal">The Quiet Observer</h1>`
**Problem:** Target keyword set for /about is "about AD Photography / Akash photographer Toronto / wedding photographer story" (see `docs/seo/keyword-map.md`). H1 reads as a tagline with zero keyword match.
**Fix:** Keep "The Quiet Observer" as the visual display but wrap the phrase plus a subtitle inside a single `<h1>`, so the element contains the primary keyword:

```astro
<h1 class="text-display-lg char-reveal" style="margin-top: var(--spacing-element); max-width: 16ch;">
  <span class="block">The Quiet Observer</span>
  <span class="block text-body-lg italic text-on-surface-variant" style="margin-top: var(--spacing-element); letter-spacing: 0;">
    Toronto wedding photographer and videographer
  </span>
</h1>
```

The display serif still dominates visually; the keyword phrase sits as an italic subtitle below. Both live inside the same `<h1>`, so crawlers read the full phrase.

### 2. Title tag missing geo + role keyword
**File:** `src/pages/about.astro:27`
**Current:** `title="The Experience"` → renders as `<title>The Experience | AD Photography</title>` (33 chars).
**Problem:** No "Toronto", no "photographer". The bio page is the #1 landing page for branded + "Akash photographer Toronto" searches.
**Fix:** Change prop to:
```astro
title="About Akash, Toronto Wedding Photographer"
```
Renders to 57 chars: `About Akash, Toronto Wedding Photographer | AD Photography`.

### 3. Hero portrait renders WebP q90, not AVIF q75
**File:** `src/pages/about.astro:80-88`
**Current:**
```astro
<Image
  src={portraitImage}
  alt="Akash, photographer and founder of AD Photography"
  widths={[400, 600, 800]}
  sizes="(max-width: 639px) 100vw, 50vw"
  class="w-full object-cover parallax-img"
  loading="eager"
  fetchpriority="high"
  decoding="async"
/>
```
Built HTML (`dist/about/index.html`) emits `.webp` with no `format` directive and default quality.
**Problem:** The portrait is this page's LCP. AVIF cuts ~40% off vs. WebP at matched visual quality.
**Fix:** Add `format="avif"` and `quality={75}`:
```astro
<Image
  src={portraitImage}
  alt="Akash Desai, Toronto wedding photographer and founder of AD Photography"
  widths={[400, 600, 800, 1000]}
  sizes="(max-width: 639px) 100vw, 50vw"
  format="avif"
  quality={75}
  class="w-full object-cover parallax-img"
  loading="eager"
  fetchpriority="high"
  decoding="async"
/>
```
Also tighten alt from "Akash, photographer and founder" → "Akash Desai, Toronto wedding photographer and founder of AD Photography" — name + geo + role.

### 4. No markdown mirror for /about
**File:** `public/mirrors/about.md` (missing)
**Problem:** LLM crawlers (GPTBot, PerplexityBot, etc.) now heavily weight `/mirrors/*.md` when they exist. Home and services-wedding have mirrors; about is a top-3 page for branded searches and should too.
**Fix:** Create `public/mirrors/about.md` with page-structured copy (title, description, bio, approach pillars, process steps, CTA). Then add the mirror link to `public/llms.txt` under "Markdown Mirrors".

---

## P1 — Next iteration

### 5. Person schema is thin
**File:** `src/pages/about.astro:10-22`
**Current:**
```ts
const personSchema = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: 'Akash',
  jobTitle: 'Photographer & Videographer',
  worksFor: { '@type': 'LocalBusiness', name: 'AD Photography' },
  url: `${site.url}/about`,
  sameAs: [site.social.instagram],
};
```
**Fix:** Enrich with `image`, `description`, `knowsAbout`, and link `worksFor` to the LocalBusiness `@id`:
```ts
const personSchema = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  '@id': `${site.url}/about#person`,
  name: 'Akash Desai',
  givenName: 'Akash',
  familyName: 'Desai',
  jobTitle: 'Photographer & Videographer',
  description: 'Toronto-based wedding and pre-wedding photographer and videographer. Solo practice focused on intimate, unhurried ceremonies and cinematic editorial storytelling.',
  image: `${site.url}/og-default.jpg`,
  url: `${site.url}/about/`,
  worksFor: { '@id': `${site.url}/#business` },
  knowsAbout: [
    'Wedding photography',
    'Pre-wedding photography',
    'Civil ceremony photography',
    'Wedding videography',
    'Cinematic editorial portraiture',
  ],
  sameAs: [site.social.instagram, site.social.pinterest, site.social.youtube],
};
```

### 6. Breadcrumb URL for /about missing trailing slash
**File:** `src/pages/about.astro:34`
**Current:** `{ label: 'The Experience', href: '/about' }` → breadcrumb schema emits `https://kashklicks.ca/about` while canonical is `https://kashklicks.ca/about/`.
**Fix:** Change to `href: '/about/'`.

### 7. Travel Madeira image at quality 90
**File:** `src/pages/about.astro:200`
**Current:** `quality={90}` on a below-the-fold lazy-loaded 3:2 image.
**Fix:** Drop to `quality={80}` and add `format="avif"` to halve the file size — no perceptible quality loss at that viewport.

### 8. Internal links missing from bio body
**Problem:** Body mentions "pre-wedding", "wedding", "civil ceremonies", "celebrations" but the words are not linked. Internal linking from /about to service pages strengthens topical authority.
**Fix:** Turn the first mention of each service in paragraph 1–3 into a link to the matching `/services/{slug}` page. Keep to 2–3 links max to stay editorial.

---

## P2 — Nice-to-haves

### 9. H2 variety
The four approach pillars (`The Curated Frame`, `Natural Luminosity`, `Timeless Aesthetic`) and CTA H2 (`Let's find the light.`) are all artistic. Crawlers read the H2 list as a table of contents. Consider one H2 that includes a keyword (e.g., `The Approach · Cinematic wedding photography`) to broaden the topical signal — optional.

### 10. Add `/about` to `docs/seo/keyword-map.md` status as "implemented + optimized"
Already marked implemented; after this pass, bump notes to confirm on-page targeting is live.

---

## What's already good (don't regress)

- One `<h1>` per page (verified in built HTML).
- `LocalBusiness` schema emitted exactly once from `BaseLayout.astro` — no duplicate on this page.
- `Person` + `BreadcrumbList` schemas present and valid JSON-LD.
- Canonical is correct: `https://kashklicks.ca/about/`.
- Open Graph and Twitter tags complete; `og:image:alt` auto-generated.
- Meta description includes "Toronto", "wedding", "pre-wedding", "cinematic", "Fujifilm" — 165 chars, in range.
- Alt text on both images is descriptive (though /about portrait can be tighter — see P0 #3).
- Portrait is `loading="eager"` + `fetchpriority="high"` — correct for LCP.
- Sitemap includes `/about/` with `lastmod`.
- No em dashes or en dashes in copy (checked body + schema).
- Body copy respects "solo, intimate weddings" positioning from memory.

---

## Needs input from Akash

- `public/og-default.jpg` — still placeholder; Akash needs to export a real 1200×630 brand image.
- `YOUR_CF_ANALYTICS_TOKEN` in `BaseLayout.astro:132` — needs real Cloudflare Web Analytics token.
- Real phone number for `site.json` (currently empty).

---

## Priority punch list

- [x] P0 — Rewrite H1 with keyword subtitle inside `<h1>`
- [x] P0 — Change title prop to "About Akash, Toronto Wedding Photographer"
- [x] P0 — Hero portrait: `format="avif"` + `quality={75}` + tighter alt
- [x] P0 — Create `public/mirrors/about.md` + register in `llms.txt`
- [x] P1 — Enrich Person schema (image, description, @id ref, knowsAbout)
- [x] P1 — Fix breadcrumb /about → /about/
- [x] P1 — Travel Madeira image quality 90 → 80, format AVIF
- [ ] P2 — One keyword-bearing H2 in the Approach section (optional)
- [ ] P2 — Inline internal links from bio to service pages (optional)
