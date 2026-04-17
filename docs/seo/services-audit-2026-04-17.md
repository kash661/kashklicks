# Services Index SEO Audit — 2026-04-17

**Scope:** `/services` (`src/pages/services/index.astro`)
**Auditor:** Claude
**Status:** Findings + fixes applied

---

## TL;DR
The page redesign (editorial four-card row + auto-scrolling marquee) landed the visual brief, but it left the semantic `<h1>` as a poetic tagline ("Four ways to be photographed.") with zero keyword weight — the most important SEO fix. Site-wide scaffolding (LocalBusiness uniqueness, Service/OfferCatalog/BreadcrumbList, OG/Twitter, canonical, mirror, llms.txt, sitemap) all verified healthy. Remaining items are small: unused imports left by the redesign, inconsistent Offer name casing in schema, and an unnecessary eager-load on marquee tiles that sit below the fold in an `aria-hidden` section.

---

## P0 — Fix before next deploy

### 1. `<h1>` carries no keywords
**File:** `src/pages/services/index.astro:160`
**Current:**
```astro
<h1 class="text-display-lg mt-8 max-w-4xl char-reveal">Four ways to be photographed.</h1>
```
`<h1>` text is the poetic tagline. Primary keyword (`Toronto Wedding Photography Services`) is only in `<title>` and meta description. Google weighs H1 heavily for topic relevance.

**Fix:** Swap semantic roles without changing the visual design. The existing eyebrow (`<p class="text-label-md ... eyebrow-rule">Services</p>`) becomes the `<h1>` with full keyword. The poetic line demotes to a `<p>` with the same `text-display-lg` classes — nothing changes visually.

```astro
<h1 class="text-label-md text-on-surface-muted eyebrow-rule reveal">Toronto Wedding Photography Services</h1>
<p class="text-display-lg mt-8 max-w-4xl char-reveal">Four ways to be photographed.</p>
```

---

## P1 — Next iteration

### 2. Dead imports from the redesign
**File:** `src/pages/services/index.astro:4, 10-15`
`Button` is imported but no longer referenced (CTA uses `BookingLink`). `serviceImages` record is defined but no longer rendered — the redesign removed the per-card images and the sticky preview column. Both are dead weight.

**Fix:** Remove unused `Button` import and the entire `serviceImages` Record.

### 3. Marquee tiles eager-load 4 images that are below the fold
**File:** `src/pages/services/index.astro:224`
Marquee section is wrapped in `aria-hidden="true"` and sits below the four package cards. The first four tiles still have `loading={i < 4 ? 'eager' : 'lazy'}`, forcing the browser to fetch ~4 × ~15 KB before the package grid above even fully paints. These tiles never compete for LCP.

**Fix:** All marquee tiles should be `loading="lazy"`.

### 4. `Service` schema doesn't link `OfferCatalog`
**File:** `src/pages/services/index.astro:114-123`
Google can associate the Service with its pricing if the schema references an OfferCatalog via `hasOfferCatalog`. Currently they're independent siblings.

**Fix:** Add `hasOfferCatalog: { '@id': `${site.url}/services#offers` }` on the Service, and give the OfferCatalog a matching `@id`. Small rich-results uplift, no visual effect.

### 5. `Offer` names are lowercase in schema
**File:** `src/pages/services/index.astro:132-137`
Uses `s.altTitle` which reads: `"Wedding day"`, `"Pre-wedding and engagement shoot"`, `"Civil ceremony"`, `"Celebration and private event"`. Title-case is expected for product/service names in structured data and matches what crawlers already see in the visual H2s.

**Fix:** Either rewrite `altTitle` values in title-case, or use `s.title` (but `s.title` contains `<br>`, so altTitle after capitalization is cleaner).

---

## P2 — Nice-to-haves

### 6. Marquee selection is nondeterministic
`Math.random()` runs at build time, so every deploy reshuffles which portraits appear. Functionally fine, but commits that only change the marquee appear to "update the services page" in diffs and analytics. Acceptable; flagging only.

### 7. `<br>` inside `<h2>` for "Pre-Weddings & E-Shoots"
Text content reads as "Pre-Weddings & E-Shoots" to crawlers (the `<br>` is stripped during extraction), so there's no SEO cost. Mentioning in case the design later wants a single-line variant.

### 8. Marquee `.webp` but not `.avif`
Hero/LCP policy is AVIF; tiles are small (240–480px) so WebP is fine. Acceptable as-is.

---

## What's already good (don't regress)

- **`<title>`**: "Toronto Wedding Photography Services | AD Photography" — keyword + brand, 53 chars.
- **Meta description**: 165 chars, keyword-rich, includes price anchor + CTA.
- **Canonical**: present and correct.
- **OpenGraph + Twitter**: all expected fields present (`og:title`, `og:description`, `og:image`, `og:image:width`, `og:image:height`, `og:image:alt`, `og:url`, `og:type`, `og:locale`, `og:site_name`, `twitter:card`, etc.).
- **Schema**: `LocalBusiness` count = 1 (not duplicated), `Service`, `OfferCatalog`, `BreadcrumbList`, `GeoCoordinates`, `PostalAddress`, `OpeningHoursSpecification` all emit cleanly.
- **`hreflang` / `lang`**: `en_CA` locale set.
- **Content mirror** (`public/mirrors/services.md`): current — includes all four services, Civil Ceremony at $500 (just updated), areas served, and "solo photographer" positioning.
- **Sub-mirrors exist** for wedding, pre-wedding, civil-ceremony, celebrations.
- **llms.txt**: references all 5 service routes + 5 mirror files.
- **Sitemap**: all 5 services URLs present with `lastmod=2026-04-17`.
- **No 3rd-party render-blocking CSS/fonts** (self-hosted woff2 via `BaseLayout`).
- **Marquee uses `aria-hidden`** since photos are decorative — no empty-alt SEO penalty.

---

## Needs input from Akash (skipped)

- **`og-default.jpg`** is still the site-wide default. A services-specific `og-services.jpg` (1200×630, including at least one hero moment + branding) would lift click-through on Facebook/LinkedIn shares targeting the services URL. Skipping — this is a brand-asset decision.

---

## Priority punch list (copyable)

- [x] P0 — Rewrite `<h1>` to `Toronto Wedding Photography Services`; demote poetic tagline to `<p>`.
- [x] P1 — Remove unused `Button` import + dead `serviceImages` record.
- [x] P1 — Drop eager loading from marquee tiles (all `loading="lazy"`).
- [x] P1 — Add `hasOfferCatalog` reference + matching `@id` on Service/OfferCatalog.
- [x] P1 — Title-case Offer names in schema.
- [x] P2 — Switched marquee to Mulberry32 seeded PRNG (`MARQUEE_SEED = 20260417`); bump seed to reshuffle.
- [x] Akash input — generated `public/og-services.jpg` (1200×630 attention-crop of `services-hero.jpg`, 127 KB); wired via `ogImage` prop and into Service schema `image`.
