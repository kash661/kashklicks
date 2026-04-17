# Celebrations Services SEO Audit — 2026-04-16

**Scope:** `/services/celebrations` (`src/pages/services/celebrations.astro`)
**Auditor:** Claude (via `page-seo-audit` skill)
**Status:** Findings + fixes applied in this run

---

## TL;DR

Mirror of the wedding/pre-wedding pattern, so it inherits the `sr-only` H1 + duplicate H2, missing `FAQPage` schema, WebP-at-q90 hero, inline `LocalBusiness` stubs, missing mirror, and broken `Book Your Call`. One oddity: the hero blockquote is attributed to AD Photography itself rather than a real client — that's a copy choice rather than an SEO issue, flagged for Akash's awareness.

---

## P0 — Fix before next deploy

### 1. `sr-only` H1 + duplicate H2

```html
<h1 class="sr-only">Events & Celebrations Photography</h1>
...
<h2>Events & Celebrations</h2>
```

**Fix:** delete sr-only H1, promote H2 to H1 with text `Toronto Event Photography` (more searched than "Celebrations").

### 2. Missing `FAQPage` schema

Same pattern. Add `faqPageSchema` for `eventFaq`.

### 3. Hero image is WebP at q=90

`format="avif"`, `quality={75}`.

### 4. Inline `LocalBusiness` stubs across Service / OfferCatalog / Offer.seller

Convert to `@id` refs via `businessRef`. Add `image` to Service.

### 5. Missing mirror

Create `public/mirrors/services-celebrations.md` + register in `llms.txt`.

### 6. Broken "Book Your Call" CTA

`href="#"` → `href="/contact?service=celebrations"`.

---

## P1 — Next iteration

### 7. Title too short, missing geo

`Events & Celebrations | AD Photography` → `Toronto Event Photography | AD Photography`.

### 8. Alt text on hero, service-detail, moment, CTA all generic

- Hero: `Celebration event photography by AD Photography in Toronto` — decent but could name the event type (birthday, bridal shower).
- Service detail: `Candid celebration photography capturing guests and decor at a Toronto event` — OK.
- Moment: `Floral centerpiece and candlelight details at a Toronto celebration, photographed before guests arrive` — actually this one is strong, keep.
- CTA: `Celebration event photography by AD Photography` — add geo: `Toronto celebration photography by AD Photography`.

### 9. Hero blockquote is attributed to "AD Photography"

```html
<p class="text-label-md text-on-surface-variant mt-8">AD Photography</p>
```

This looks like a testimonial structurally, but it's a brand statement with the brand's own name underneath. It's not misleading enough to be an SEO issue, but it dilutes the review pattern the other service pages use. **Recommended**: either (a) attribute to a real client testimonial (preferred), or (b) remove the attribution line so it reads as an editorial statement instead of a fake testimonial.

---

## P2 — Nice-to-haves

- `HowTo` schema on the 4-step journey.
- Anchor IDs on section headings.
- The "In The Details" interlude could emit its own `ImageObject` with a richer description.

---

## What's already good (don't regress)

- `Service` + `OfferCatalog` both emitted.
- `BreadcrumbList` rendered.
- Hero has `loading="eager"` + `fetchpriority="high"`.
- Sitemap entry with lastmod.
- ~1,300 words of crawlable copy.
- "In The Details" editorial block is well-written and keyword-adjacent.

---

## Priority punch list (copyable)

- [ ] P0 — Promote H2 to visible H1 `Toronto Event Photography`, remove sr-only H1
- [ ] P0 — Add FAQPage schema
- [ ] P0 — Hero → AVIF q75
- [ ] P0 — Service/OfferCatalog/Offer.seller → `@id` refs
- [ ] P0 — Create mirror + register in llms.txt
- [ ] P0 — Fix `#` CTA → `/contact?service=celebrations`
- [ ] P1 — Title → `Toronto Event Photography`
- [ ] P1 — Tighten hero + CTA alt text with event type / geo
- [ ] P1 — Decide: real testimonial or drop the AD Photography attribution
