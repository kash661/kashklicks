# Pre-Wedding Services SEO Audit — 2026-04-16

**Scope:** `/services/pre-wedding` (`src/pages/services/pre-wedding.astro`)
**Auditor:** Claude (via `page-seo-audit` skill)
**Status:** Findings + fixes applied in this run

---

## TL;DR

Structural twin of the wedding service page, so it inherits the same P0 gaps: no `FAQPage` schema despite a rendered FAQ, `sr-only` H1 duplicated by the following H2, hero `<Image>` stuck on WebP at quality 90, inline `LocalBusiness` stubs inside `Service` / `OfferCatalog` / `Offer.seller` instead of `@id` refs, no `public/mirrors/services-pre-wedding.md`, and a `Book Your Call` link pointed at `#`. One page-specific bug: hero image `alt` mismatches the caption (alt names Ayushi and Parth, caption names Swati and Saksham).

---

## P0 — Fix before next deploy

### 1. Hero image alt/caption mismatch

`src/pages/services/pre-wedding.astro`

```astro
alt="Ayushi and Parth pre-wedding photography in Toronto by AD Photography"
...
data-caption="Swati & Saksham, Toronto"
```

The image is labeled as Swati & Saksham visually but crawled as Ayushi & Parth. Pick the one that's in the photo. Based on the data-caption + testimonial context, update alt to `Swati and Saksham pre-wedding photography in Toronto by AD Photography`.

### 2. Missing `FAQPage` schema

Same pattern as wedding — visible `<FAQAccordion items={preWeddingFaq} />` with no schema. Add:

```astro
const faqPageSchema = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: preWeddingFaq.map((q: any) => ({
    '@type': 'Question',
    name: q.question,
    acceptedAnswer: { '@type': 'Answer', text: q.answer },
  })),
};

const jsonLd = [serviceSchema, offerCatalogSchema, faqPageSchema];
```

### 3. `sr-only` H1 + duplicate H2

```html
<h1 class="sr-only">Pre-Weddings & E-Shoots</h1>
...
<h2>Pre-Weddings & E-Shoots</h2>
```

**Fix:** delete sr-only H1, promote visible H2 to H1 with `Toronto Pre-Wedding Photography` as the text — better keyword than "E-Shoots".

### 4. Hero image is WebP at q=90

`format="avif"`, `quality={75}` on the hero Image.

### 5. Inline `LocalBusiness` in Service/OfferCatalog — convert to `@id` ref

Same consolidation pattern as wedding.astro:

```astro
const businessRef = { '@id': `${site.url}/#business` };

// provider: businessRef  (in Service)
// offeredBy: businessRef (in OfferCatalog)
// seller: businessRef    (in each Offer)
```

Also add `image: `${site.url}/og-default.jpg`` to Service.

### 6. Missing mirror

Create `public/mirrors/services-pre-wedding.md` and register in `public/llms.txt`.

### 7. Broken "Book Your Call" CTA

`<a href="#">` → `<a href="/contact?service=pre-wedding">` until Calendly is wired.

---

## P1 — Next iteration

### 8. Title could be keyword-forward

Current: `Pre-Weddings & E-Shoots | AD Photography`. Change base title to `Toronto Pre-Wedding Photography` so SEO renders `Toronto Pre-Wedding Photography | AD Photography` (56 chars, primary keyword in position 1).

### 9. Generic alt on bottom CTA

```html
alt="Pre-wedding photography by AD Photography"
```

Replace with a location-anchored version, e.g., `Toronto pre-wedding couple portrait by AD Photography`.

### 10. Service description image alt is generic

```html
alt="Toronto pre-wedding photographer capturing a couple at a scenic location"
```

Replace with something naming the scene if known, else `Toronto pre-wedding couple at golden hour by AD Photography`.

---

## P2 — Nice-to-haves

- Anchor IDs on section headings (`#packages`, `#journey`, `#faq`) for shareable deep links.
- Consider `HowTo` schema on the journey timeline.
- Filter pills are a nice UX — adding `noindex` to filtered URL states isn't needed (no URL state currently), but if filters become URL-bound, canonicalize to the unfiltered URL.

---

## What's already good (don't regress)

- `Service` + `OfferCatalog` already emitted.
- `BreadcrumbList` rendered.
- Hero has `loading="eager"` + `fetchpriority="high"`.
- ~1,400 words of crawlable copy.
- No em/en dashes.
- Package data pulls live from `packages.json`.
- Sitemap entry present with lastmod.

---

## Priority punch list (copyable)

- [ ] P0 — Fix hero alt/caption mismatch
- [ ] P0 — Add FAQPage schema
- [ ] P0 — Promote H1 to `Toronto Pre-Wedding Photography`, remove sr-only H1
- [ ] P0 — Hero → AVIF q75
- [ ] P0 — Convert Service/OfferCatalog/Offer.seller to `@id` ref
- [ ] P0 — Create mirror + register in llms.txt
- [ ] P0 — Fix `#` CTA → `/contact?service=pre-wedding`
- [ ] P1 — Title → `Toronto Pre-Wedding Photography`
- [ ] P1 — Tighten CTA/bottom alt text
- [ ] P1 — Add `image` to Service schema
