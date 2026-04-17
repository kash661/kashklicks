# Wedding Services SEO Audit — 2026-04-16

**Scope:** `/services/wedding` (`src/pages/services/wedding.astro`)
**Auditor:** Claude (via `page-seo-audit` skill)
**Status:** Findings + fixes will be applied in this run

---

## TL;DR

The page is the strongest-scaffolded service page on the site: ~1,300 words of crawlable copy, `Service` + `OfferCatalog` + `BreadcrumbList` schemas all present, single `LocalBusiness` emission, `BreadcrumbList` wired, prices pulled from `packages.json`. Three real gaps: (1) a `FAQAccordion` renders seven questions but no `FAQPage` schema wraps them, (2) the hero image still serves WebP with no `format="avif"` and weighs 194 KB at 960w / 380 KB at 1280w — miss on the LCP budget, (3) the `<h1>` is `sr-only` **and** duplicates the text of the next `<h2>`, so the page has no visible keyword-rich top-level heading. Plus one broken link (`<a href="#">Book Your Call</a>`) and a missing `public/mirrors/services-wedding.md`.

---

## P0 — Fix before next deploy

### 1. Missing `FAQPage` schema for the rendered FAQ

`src/pages/services/wedding.astro` — `weddingFaq` is iterated into a visible `<FAQAccordion>` near the bottom, but `jsonLd` only contains `[serviceSchema, offerCatalogSchema]`. Confirmed in `dist/services/wedding/index.html`: `grep -c FAQPage` returns `0`.

**Fix:** add a `faqPageSchema` alongside the others and include it in `jsonLd`.

```astro
const faqPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: weddingFaq.map((q) => ({
    '@type': 'Question',
    name: q.question,
    acceptedAnswer: { '@type': 'Answer', text: q.answer },
  })),
};

const jsonLd = [serviceSchema, offerCatalogSchema, faqPageSchema];
```

### 2. H1 is `sr-only` and duplicates the next H2

```html
<h1 class="sr-only">Wedding Day Coverage</h1>
...
<h2 class="text-display-md char-reveal">Wedding Day Coverage</h2>
```

Two problems:
- Google weights H1 heavily; making it invisible weakens the signal (not a penalty, but a leak).
- Two consecutive headings with identical text confuse crawlers and hurt snippet generation.

**Fix:** promote the visible `<h2>Wedding Day Coverage</h2>` to be the actual H1, and make it keyword-rich — `Toronto Wedding Photography`. The sr-only H1 can be deleted. The hero blockquote ("They made us feel like the only two people in the room.") stays as a visual lede — it doesn't need to be semantically H1.

```astro
// Remove: <h1 class="sr-only">Wedding Day Coverage</h1>

// Later, change this h2 to h1:
<h1 class="text-display-md char-reveal" style="margin-top: var(--spacing-element);">Toronto Wedding Photography</h1>
```

This gives the page: hero blockquote (visual only) → visible keyword-rich H1 in the service description section → cascading H2s for Journey / Packages / Good to Know / FAQ / CTA.

### 3. Hero image is WebP, not AVIF, and over budget

Built variants:
- 80 KB at 640w ✓
- 194 KB at 960w
- 380 KB at 1280w (LCP candidate at desktop viewports)
- 783 KB base

CLAUDE.md budget: ~150 KB AVIF at the 1280w srcset. The Astro Image component is left at default format. Homepage hero (after today's fix) renders AVIF at 108 KB / 1280w.

**Fix:** `src/pages/services/wedding.astro` hero Image — add `format="avif"`, drop `quality={90}` to `quality={75}`:

```astro
<Image
  src={heroImage}
  alt="Natalie and Shavar wedding photography at The Glenerin Inn by AD Photography"
  widths={[640, 960, 1280]}
  sizes="(max-width: 768px) 100vw, 50vw"
  quality={75}
  format="avif"
  class="w-full h-full object-cover parallax-img"
  loading="eager"
  fetchpriority="high"
/>
```

### 4. `Service` / `OfferCatalog` reference `LocalBusiness` as inline stubs instead of `@id`

Current:
```json
"provider":{"@type":"LocalBusiness","name":"AD Photography","url":"https://kashklicks.ca"}
"offeredBy":{"@type":"LocalBusiness","name":"AD Photography","url":"https://kashklicks.ca"}
"seller":{"@type":"LocalBusiness","name":"AD Photography"}  // × 3 inside Offers
```

Google sees six `LocalBusiness` nodes on this page and can't confidently merge them with the site-wide one emitted from `BaseLayout.astro`. That business is published with `@id: https://kashklicks.ca/#business`.

**Fix:** replace every inline stub with an `@id` reference. The schema becomes smaller and unambiguous.

```astro
const businessRef = { '@id': `${site.url}/#business` };

const serviceSchema = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Toronto Wedding Photography',
  description: weddingService.description,
  provider: businessRef,
  areaServed: { '@type': 'City', name: 'Toronto' },
  serviceType: 'Wedding Photography',
  image: `${site.url}/og-default.jpg`,
};

const offerCatalogSchema = {
  '@context': 'https://schema.org',
  '@type': 'OfferCatalog',
  name: 'Wedding Photography Packages',
  description: 'Toronto wedding day photography packages by AD Photography. Full-day and partial-day coverage from $1,200.',
  url: `${site.url}/services/wedding`,
  offeredBy: businessRef,
  itemListElement: weddingPackages.filter((p) => p.price !== null).map((p) => ({
    '@type': 'Offer',
    name: p.name,
    description: p.description,
    price: p.salePrice || p.price,
    priceCurrency: p.currency,
    availability: 'https://schema.org/InStock',
    seller: businessRef,
  })),
};
```

### 5. Missing content mirror

`public/mirrors/services-wedding.md` does not exist. `home.md` is currently the only mirror. Crawlers and LLMs following `llms.txt` have no markdown representation of the service page.

**Fix:** create the mirror and register it in `public/llms.txt` under "Markdown Mirrors".

### 6. Broken primary CTA

```astro
<a href="#" class="magnetic ...">Book Your Call</a>
```

`#` makes this button a no-op. It's billed as a Calendly hook but nothing is wired up. Not strictly SEO, but Google notices high bounce and failed CTAs on money pages.

**Fix:** until Calendly is wired, point it to `/contact?service=wedding` (same target as the other two CTAs on this page) so users don't hit a dead-end.

---

## P1 — Next iteration

### 7. Title is short

`Wedding Photography | AD Photography` is 39 chars — under the 50-char lower bound and missing the geo modifier that every competing Toronto photographer uses. Real SERP shows the geo will fit.

**Fix:** change SEO template call to `title="Toronto Wedding Photography"` so SEO.astro produces `Toronto Wedding Photography | AD Photography` (56 chars).

### 8. Generic alt text on CTA bottom image

```html
alt="Wedding photography by AD Photography"
```

No couple, no venue, no location. The image is `homepage-01.jpg`. Rewrite to something like `Toronto wedding couple portrait by AD Photography`.

### 9. Description image alt is also too generic

```html
alt="Toronto wedding photographer capturing bride and groom portrait at ceremony venue"
```

Neutral but no specifics. If the underlying photo is identifiable (venue, couple name), name them.

### 10. `Service` schema has no `image`

Add a representative image URL so Google can include a thumbnail in some knowledge-panel surfaces. Included in the P0 fix block above.

---

## P2 — Nice-to-haves

### 11. Add `aggregateRating` to the `LocalBusiness` (site-wide, not this page)

Out of this page's scope but relevant: once `testimonials.json` has a real rating count, emit `aggregateRating` on `LocalBusiness` in `BaseLayout.astro`. All service pages inherit it.

### 12. Timeline steps are H3s — consider adding `HowTo` schema

The "From Inquiry to Gallery" 7-step timeline is the perfect shape for Google's `HowTo` schema. Low priority — `HowTo` rich results were deprecated for most categories in 2023, but the structure is still useful for AI-answer surfaces.

### 13. Anchor links to section headings

Nothing on the page exposes a table-of-contents-style set of anchors. Adding `id` attributes to each section heading (`#journey`, `#packages`, `#faq`) unlocks deep-link sharing (e.g., `/services/wedding#packages`) that often gets clicked from Instagram bios and text messages.

---

## What's already good (don't regress)

- One `LocalBusiness` on the page (from `BaseLayout`). Clean.
- `Service` + `OfferCatalog` + `BreadcrumbList` schemas all emitted.
- Pricing in copy pulled live from `packages.json` — no drift risk.
- Title/description/canonical/OG/Twitter all present; OG includes width/height/alt (from today's homepage fixes propagating through `SEO.astro`).
- Hero image has `loading="eager"` + `fetchpriority="high"` on the right element.
- Sitemap entry present with `<lastmod>`.
- ~1,300 words of substantive crawlable copy — strong for a service page.
- No em dashes or en dashes in copy.
- Breadcrumb rendered for both users (`sr-only`) and crawlers (schema).

---

## Needs input from Akash (not fixed automatically)

- Real Calendly URL for "Book Your Call" — currently points at `#`. Interim fix redirects to `/contact?service=wedding`.
- Better OG image specifically for this page (optional) — currently falls back to the placeholder `/og-default.jpg` sitewide.

---

## Priority punch list (copyable)

- [ ] P0 — Add `FAQPage` schema (`wedding.astro`)
- [ ] P0 — Promote visible H2 "Wedding Day Coverage" to H1, rename to keyword-rich "Toronto Wedding Photography", delete `sr-only` H1
- [ ] P0 — Convert hero Image to AVIF @ q75
- [ ] P0 — Replace inline `LocalBusiness` stubs in `Service` / `OfferCatalog` / `Offer.seller` with `@id` refs
- [ ] P0 — Create `public/mirrors/services-wedding.md` and register in `llms.txt`
- [ ] P0 — Point "Book Your Call" at `/contact?service=wedding` until Calendly is wired
- [ ] P1 — Lengthen title to `Toronto Wedding Photography`
- [ ] P1 — Tighten CTA-bottom image alt
- [ ] P1 — Tighten service description image alt
- [ ] P1 — Add `image` to `Service` schema (bundled in P0.4)
- [ ] P2 — Add `HowTo` schema to the journey timeline
- [ ] P2 — Add anchor IDs on major section headings
