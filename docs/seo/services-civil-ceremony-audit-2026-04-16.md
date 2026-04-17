# Civil Ceremony Services SEO Audit — 2026-04-16

**Scope:** `/services/civil-ceremony` (`src/pages/services/civil-ceremony.astro`)
**Auditor:** Claude (via `page-seo-audit` skill)
**Status:** Findings + fixes applied in this run

---

## TL;DR

Unique among the service pages because it already has a visible H1 ("Every venue tells a story.") — but that H1 is tagline-style and carries zero keywords. The page is also missing an `OfferCatalog` even though it has one package, missing `FAQPage` schema, has six hero mosaic images still at WebP quality 90 (six LCP candidates, not one — makes AVIF conversion doubly valuable), inline `LocalBusiness` stubs in `Service`, no mirror, and the usual `Book Your Call → #` broken link.

---

## P0 — Fix before next deploy

### 1. H1 carries no keywords

```html
<h1 class="text-display-md">Every venue tells a story.</h1>
```

Poetic, but Google sees zero relevant terms. Swap to keyword-rich `Toronto Civil Ceremony Photography` and demote the tagline — it can live as a paragraph above or below the H1, not as the H1 itself.

### 2. Missing `FAQPage` schema

Visible FAQAccordion, no schema. Add `faqPageSchema` as on wedding.

### 3. Missing `OfferCatalog`

Single package (`The Civil Ceremony — $500`) is rendered via `PricingCard` but there's no Offer schema at all. Add:

```astro
const offerCatalogSchema = {
  '@context': 'https://schema.org',
  '@type': 'OfferCatalog',
  name: 'Civil Ceremony Photography Packages',
  description: 'Toronto civil ceremony photography package by AD Photography. Intimate ceremony coverage from $500.',
  url: `${site.url}/services/civil-ceremony`,
  offeredBy: businessRef,
  itemListElement: civilPackages.filter((p: any) => p.price !== null).map((p: any) => ({
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

### 4. Hero mosaic of 6 images, no AVIF, quality 90

Six images in the top section, two marked `loading="eager"` (the LCP candidates). All at `quality={90}` WebP. Convert all six to AVIF + q=80 (slightly higher than the standard hero because portrait frames can show noise at 75):

```astro
<Image
  src={img.src}
  alt={img.alt}
  widths={[480, 640, 960]}
  sizes="(max-width: 768px) 50vw, 33vw"
  quality={80}
  format="avif"
  class="w-full h-auto"
  loading={i < 2 ? 'eager' : 'lazy'}
/>
```

Also add `fetchpriority="high"` to the two eager images (currently missing).

### 5. Inline `LocalBusiness` stub in `Service`

Replace with `businessRef` (`@id` ref). Add `image` field.

### 6. Missing mirror

Create `public/mirrors/services-civil-ceremony.md` and register in `llms.txt`.

### 7. Broken "Book Your Call" CTA

`href="#"` → `href="/contact?service=civil-ceremony"`.

---

## P1 — Next iteration

### 8. Gallery alt text is formulaic

All six gallery images have structurally identical alts: `Civil ceremony [noun] by AD Photography`. No location, no venue, no identifying detail. Since civil ceremonies are location-heavy, naming the venue (City Hall, specific courthouse, etc.) if known makes the alt far more valuable.

### 9. Title is keyword-correct but short

Current: `Civil Ceremony Photography | AD Photography` (44 chars). Consider `Toronto Civil Ceremony Photography` (55 chars final) to explicitly geo-target.

### 10. CTA image alt is generic

`alt="Civil ceremony portrait by AD Photography"` → `alt="Toronto civil ceremony couple portrait by AD Photography"`.

### 11. Description image alt is generic

`alt="Civil ceremony couple portrait by AD Photography"` — likewise, geo-anchor.

---

## P2 — Nice-to-haves

- `HowTo` schema for the 4-step journey.
- Anchor IDs on sections.
- `ImageGallery` schema for the hero mosaic — six `ImageObject` children.

---

## What's already good (don't regress)

- H1 is visible (better than wedding/pre-wedding where it was `sr-only`) — just needs keyword update.
- BreadcrumbList rendered.
- Sitemap entry with lastmod.
- Gallery mosaic uses `loading={i < 2 ? 'eager' : 'lazy'}` — correct LCP strategy.
- Package data from packages.json.
- Crawlable body copy ~1,100 words.

---

## Priority punch list (copyable)

- [ ] P0 — Replace H1 tagline with `Toronto Civil Ceremony Photography`
- [ ] P0 — Add FAQPage schema
- [ ] P0 — Add OfferCatalog schema (was missing entirely)
- [ ] P0 — Hero mosaic → AVIF q80 + fetchpriority=high on the eager ones
- [ ] P0 — Service uses `@id` ref, adds `image`
- [ ] P0 — Create mirror + register in llms.txt
- [ ] P0 — Fix `#` CTA → `/contact?service=civil-ceremony`
- [ ] P1 — Title → `Toronto Civil Ceremony Photography`
- [ ] P1 — Tighten gallery + description + CTA alts with locations
