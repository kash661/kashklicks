# Services SEO Audit — 2026-04-16

**Scope:** `/services` (`src/pages/services/index.astro`)
**Auditor:** Claude (via `page-seo-audit` skill)
**Status:** Findings + fixes will be applied in this run

---

## TL;DR

The page has the editorial design system wired up cleanly (eyebrows, parallax, captions, char-reveal) but the SEO scaffolding has four concrete problems: (1) a duplicate `LocalBusiness` is emitted from the page's `Service.provider` even though `BaseLayout.astro` already provides the canonical one, (2) the visible `<h1>` is a bare "Services" with zero keyword signal, (3) the LCP hero renders as WebP at `quality={90}` instead of AVIF at ~75, and (4) the pre-wedding service card ships a broken alt attribute literally containing `<br>` markup. Plus one missing mirror file. Good news: the single-H1 rule holds, canonical/OG/Twitter emit correctly, `BreadcrumbList` schema is present via the sr-only `Breadcrumbs` component, and the sitemap has `lastmod`.

---

## P0 — Fix before next deploy

### 1. Duplicate `LocalBusiness` schema

`dist/services/index.html` — `grep -c 'LocalBusiness'` returns `2`. Two separate `LocalBusiness` objects ship on this route:
- The canonical one from `src/layouts/BaseLayout.astro` (full address / geo / hours / sameAs, has `@id`).
- A stripped re-emission from `src/pages/services/index.astro:58-63` inside the `Service.provider` field: `{"@type":"LocalBusiness","name":"AD Photography","url":"https://kashklicks.ca"}`.

Two `LocalBusiness` entities confuse crawlers and split Knowledge Graph signals.

**Fix:** replace the inline `provider` object with an `@id` reference to the one `BaseLayout` already emits.

```diff
- const jsonLd = {
-   '@context': 'https://schema.org',
-   '@type': 'Service',
-   name: 'AD Photography Services',
-   description: '...',
-   provider: {
-     '@type': 'LocalBusiness',
-     name: 'AD Photography',
-     url: 'https://kashklicks.ca',
-   },
-   areaServed: { '@type': 'City', name: 'Toronto' },
- };
+ const businessRef = { '@id': `${site.url}/#business` };
+
+ const serviceSchema = {
+   '@context': 'https://schema.org',
+   '@type': 'Service',
+   name: 'Toronto Wedding Photography Services',
+   description: '...',
+   provider: businessRef,
+   areaServed: { '@type': 'City', name: 'Toronto' },
+   serviceType: 'Wedding Photography',
+   image: `${site.url}/og-default.jpg`,
+ };
```

This matches the pattern already established in `src/pages/services/wedding.astro`.

### 2. `<h1>` is "Services" — no keyword signal

`src/pages/services/index.astro:97`
```astro
<h1 class="text-display-md text-on-surface char-reveal">Services</h1>
```

The page's target keyword per `docs/seo/keyword-map.md` is **"wedding photography services Toronto"**. Current H1 carries none of it. Google will not read `<title>` as a substitute for a missing keyword H1 on a landing page.

**Fix:** expand the H1 to a single natural phrase. Keep the visual hierarchy via Tailwind — don't invent new classes.

```astro
<h1 class="text-display-md text-on-surface char-reveal">Toronto Wedding Photography Services</h1>
```

The surrounding design-md font already handles the size; longer text wraps gracefully in the white bar at the bottom of the hero.

### 3. Hero LCP image served as WebP at `quality={90}`, not AVIF

`src/pages/services/index.astro:82-91`. The first `<Image>` on the page is above the fold (LCP), marked `loading="eager" fetchpriority="high"`, but it:
- Has no `format="avif"` — Astro defaults to WebP for the fallback + WebP only. Confirmed in built HTML: `<img src="/_astro/services-hero.BJP9V04Z_Z1NjKQV.webp">`.
- Runs `quality={90}` — wastes bytes on an image that then has a 40% black gradient overlay.

**Fix:**
```diff
 <Image
   src={(await import('../../assets/images/homepage/services-hero.jpg')).default}
   alt="Toronto wedding and event photography services by AD Photography"
   widths={[1280, 1920, 2560]}
   sizes="100vw"
-  quality={90}
+  quality={75}
+  format="avif"
   class="absolute inset-0 w-full h-full object-cover"
   loading="eager"
   fetchpriority="high"
 />
```

Target weight: ~100 KB at 1280w / ~150 KB at 1920w. Matches the pattern from `services/wedding.astro` hero.

### 4. Pre-Wedding service card alt contains raw HTML

`dist/services/index.html` emits:
```html
<img ... alt="Pre-Weddings &#38;<br>E-Shoots photography by AD Photography in Toronto" ...>
```

Root cause: `src/pages/services/index.astro:25` sets `title: 'Pre-Weddings &<br>E-Shoots'` (HTML used for a line break in the visible H2 via `set:html`). Then line 121 interpolates that same title into the alt attribute: `alt={`${service.title} photography by AD Photography in Toronto`}`.

Screen readers will speak "Pre-Weddings ampersand B R E-Shoots", and Google will treat this as literal alt text. Broken accessibility and broken SEO.

**Fix:** add an `altTitle` field to each service object (plain text, no HTML), use it for alt while keeping `title` for the visible HTML-rendered heading.

```diff
 const services = [
   {
     title: 'Wedding Day',
+    altTitle: 'Wedding day',
     ...
   },
   {
     title: 'Pre-Weddings &<br>E-Shoots',
+    altTitle: 'Pre-wedding and engagement shoot',
     ...
   },
   ...
 ];
```

```diff
-alt={`${service.title} photography by AD Photography in Toronto`}
+alt={`${service.altTitle} photography by AD Photography in Toronto`}
```

---

## P1 — Next iteration

### 5. `<title>` is short and missing the primary keyword

`dist/services/index.html` → `<title>Services | AD Photography</title>` (25 characters). The skill's own spec targets 50–65 and requires the primary keyword.

**Fix:** pass a longer `title` prop into `BaseLayout`:
```diff
- <BaseLayout title="Services" ...>
+ <BaseLayout title="Toronto Wedding Photography Services" ...>
```

Built title becomes `Toronto Wedding Photography Services | AD Photography` (55 chars). Fits SERP, includes keyword.

### 6. Service cards have generic alt text

Each card alt currently reads `"{Service Type} photography by AD Photography in Toronto"` — the words are fine but the text is templated and redundant across all four cards. Ideal: each card names a visible detail (couple, venue, moment type).

Punt on this until real cover images are confirmed — the current cards use cover images pulled from `serviceImages`, so the alt text should follow the cover's subject, not the service label. Flag: revisit when swapping covers.

**Minimum fix for now** (handled by #4): `altTitle` field gives one clean word stream per service without broken HTML.

### 7. `public/mirrors/services.md` missing

`public/mirrors/home.md` exists; the `services` mirror does not. `llms.txt` lists every services page but no mirror entry for the services index. Low-impact but easy to fix.

**Fix:** create `public/mirrors/services.md` with pricing, service links, and positioning blurb. Content should mirror the live page headings + copy + CTAs.

### 8. No `OfferCatalog` on the services landing

The four child service pages each emit their own `OfferCatalog`. The landing page has a chance to emit a single `OfferCatalog` with all four services as `Offer`s, which helps rich-results eligibility for the "photography services Toronto" query cluster.

**Fix sketch** (deferrable — proposal):
```ts
const offerCatalogSchema = {
  '@context': 'https://schema.org',
  '@type': 'OfferCatalog',
  name: 'AD Photography Services',
  url: `${site.url}/services`,
  offeredBy: businessRef,
  itemListElement: services.map((s) => ({
    '@type': 'Offer',
    name: s.altTitle,
    url: `${site.url}/services/${s.slug}`,
    ...(s.startingAt && { price: s.startingAt, priceCurrency: 'CAD' }),
  })),
};
```

---

## P2 — Nice-to-haves

### 9. No `<link rel="preload" as="image">` for the hero
The hero is already `fetchpriority="high"`, which is the modern equivalent. A `<link rel="preload">` in the `<head>` edges LCP a further 50–150ms in some browsers but adds source-map complexity because Astro hashes the filename. Skip unless CrUX data shows LCP > 2.5s.

### 10. Card images could have richer alts when real cover subjects are selected
Tied to #6. When `serviceImages` get curated covers from real sessions, rewrite alts to name the subject ("Tara and James, Casa Loma ballroom" etc.).

---

## What's already good (don't regress)

- One `<h1>` per page (verified).
- Canonical URL present and correct: `https://kashklicks.ca/services/`.
- Meta description: 170 chars, includes "Toronto", "wedding", "pre-wedding", "event photography", pricing signal.
- Full Open Graph block (title, description, image, 1200×630, alt, url, type, locale, site_name).
- Twitter card (summary_large_image).
- `BreadcrumbList` JSON-LD emitted via the `Breadcrumbs` component's built-in schema (sr-only UI, schema still present).
- `fetchpriority="high"` and `loading="eager"` on the hero.
- Preconnect to `kashklicks.b-cdn.net`, preloads for Cormorant + Inter woff2.
- Sitemap includes `/services/` with a `lastmod` on every URL.
- Sub-service pages all live and listed in llms.txt.

---

## Priority punch list (copyable)

- [ ] P0 — Replace inline `LocalBusiness` in `Service.provider` with `@id` reference to `${site.url}/#business` (ref: `services/index.astro:58-63`).
- [ ] P0 — Change `<h1>Services</h1>` to `<h1>Toronto Wedding Photography Services</h1>` (ref: `services/index.astro:97`).
- [ ] P0 — Hero `<Image>`: add `format="avif"`, drop `quality={90}` → `quality={75}` (ref: `services/index.astro:82-91`).
- [ ] P0 — Add `altTitle` field per service, use it for alt text (fixes broken `<br>` in alt) (ref: `services/index.astro:14-51` and `121`).
- [ ] P1 — Change `BaseLayout title="Services"` → `title="Toronto Wedding Photography Services"` (ref: `services/index.astro:68`).
- [ ] P1 — Add `OfferCatalog` schema covering all four child services with starting prices.
- [ ] P1 — Create `public/mirrors/services.md` mirror file.
- [ ] P2 — Revisit service card alts when real cover images are finalized.
