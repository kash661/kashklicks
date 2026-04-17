# Location Guide SEO Audit — 2026-04-17

**Scope:** `/location-guide` (`src/pages/location-guide.astro`)
**Auditor:** Claude
**Status:** Findings + fixes applied

---

## TL;DR

Schema scaffolding, sitemap, and breadcrumbs are healthy. Primary issues: an em-dash in the intro copy that violates the project rule, no eager/high-priority loading on the first mosaic tile (killing LCP on this image-heavy page), a title tag that underuses the keyword budget, a missing `public/mirrors/location-guide.md`, and a missed opportunity to emit `CollectionPage` alongside `ItemList` for a page that is literally a curated collection of 27 Places.

---

## P0 — Fix before next deploy

### 1. Em-dash in intro copy (violates project rule)

`src/pages/location-guide.astro:73`

```astro
A gallery of places we've shot across Toronto and the GTA. Hover any image for a quick read, or tap through for the full rundown — parking, permits, walking, best seasons.
```

Rule in `CLAUDE.md` + memory: **no em/en dashes in any copy.** Replace `—` with a comma.

**Fix:**
```astro
A gallery of places we've shot across Toronto and the GTA. Hover any image for a quick read, or tap through for the full rundown: parking, permits, walking, best seasons.
```

### 2. No eager / fetchpriority on the first mosaic tile — LCP penalty

`src/pages/location-guide.astro:88-95`

All 27 tiles render with `loading="lazy"` and `fetchpriority="auto"`. On an image-only mosaic page with no separate hero, the first tile (Allan Gardens) is the LCP element on mobile and one of the top three on desktop. Currently the browser defers all of them.

**Fix:** Make the first tile eager + high-priority, and keep tiles 2-3 eager so the above-the-fold grid paints without waiting on the intersection observer.

```astro
<Image
  src={loc.img}
  alt={`${loc.name}, photography location in ${loc.area}`}
  widths={[400, 640, 960]}
  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
  class="mosaic-img"
  loading={i < 3 ? 'eager' : 'lazy'}
  fetchpriority={i === 0 ? 'high' : 'auto'}
/>
```

---

## P1 — Next iteration

### 3. Title tag underuses keyword budget (39 chars)

`src/pages/location-guide.astro:53`

Currently: `Toronto Location Guide | AD Photography` (39 chars). The SEO component appends ` | AD Photography` automatically, so the page-supplied title fragment is too generic. "Location" alone doesn't capture intent — searchers look for `"toronto photography locations"`, `"GTA pre-wedding locations"`, etc.

**Fix:** raise to a 60-65 char title that carries two keyword phrases.

```astro
title="Best Photography Locations in Toronto & the GTA"
```
Rendered: `Best Photography Locations in Toronto & the GTA | AD Photography` (~64 chars). Keyword rich, still under Google's ~70-char SERP cutoff.

### 4. Missing `CollectionPage` schema

Page emits `ItemList` (good) but Google treats `CollectionPage` as a semantic signal for "this is an index/collection." Since the page has 27 curated Places, `CollectionPage` pairs naturally with `ItemList`.

**Fix:** pass the schema as an array so both are emitted.

```ts
const locationListSchema = [
  {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Best Photography Locations in Toronto & the GTA',
    description: 'Curated photography locations across Toronto and the GTA by AD Photography, with parking, permits, and session tips.',
    url: `${site.url}/location-guide`,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    // ...existing body
  },
];
```

### 5. Missing content mirror at `public/mirrors/location-guide.md`

Every other key route has one (`home.md`, `about.md`, `services-*.md`). Location Guide is the single biggest SEO asset (27 linkable child pages). A mirror makes the content crawlable / ingestible by LLMs without requiring JS.

**Fix:** create `public/mirrors/location-guide.md` with title + meta-description-style intro + a markdown list of all 27 locations linking to their detail pages.

### 6. Description length slightly over budget (165 chars)

`src/pages/location-guide.astro:54`

Current 165 chars is right at the edge of Google's 160 char mobile truncation. Tighten by 10-15 chars.

**Fix:**
```
Curated Toronto and GTA photography locations for pre-wedding, engagement, and portrait sessions. Parking, permits, and best times for each.
```
(~140 chars)

---

## P2 — Nice-to-haves

### 7. Enrich alt text with an event-type keyword

Current: `Allan Gardens Conservatory, photography location in Downtown Toronto, Garden District`
Better: `Allan Gardens Conservatory, Toronto pre-wedding photography location in the Garden District`

Adds the high-intent keyword ("pre-wedding") without stuffing. Do this in the template, not per-location:

```astro
alt={`${loc.name}, Toronto pre-wedding and engagement photography location in ${loc.area}`}
```

### 8. Add `image` to each `Place` in the `ItemList`

Google's rich results for collection pages can surface the image when the `Place` carries `image`. The template already knows `loc.image`.

```ts
item: {
  '@type': 'Place',
  name: loc.name,
  description: loc.vibe,
  url: `${site.url}/location-guide/${loc.id}`,
  image: `${site.url}/_astro/${loc.image}`,  // will need resolved astro:assets path, or drop this in favor of a public/ copy
  address: { /* ... */ },
},
```

If the `_astro/` hashed path is hard to reach at build time, skip and only emit `image` on the detail pages.

### 9. Enrich llms.txt with a locations count

`public/llms.txt:32`

Current: `- [Location Guide](https://kashklicks.ca/location-guide/): Toronto and GTA photography location recommendations`

Swap for:
`- [Location Guide](https://kashklicks.ca/location-guide/): 27 curated Toronto and GTA photography locations with parking, permits, and session guidance`

### 10. Consider adding a text-based intro section

The current hero is a one-line tagline. A 80-120 word SEO paragraph beneath the mosaic ("Why these locations," "What's covered in each guide," etc.) gives Google crawlable body content and gives AI search engines an extractable answer. Currently the page is ~95% imagery.

---

## Needs input from Akash

- **OG image**: Using `/og-default.jpg`. A location-guide-specific 1200×630 (e.g., a mosaic collage) would out-convert default in SERP and Instagram previews, but requires a real asset.

---

## What's already good (don't regress)

- Single `<h1>` with primary keyword ("Toronto Location Guide").
- Exactly one `LocalBusiness` emission (from BaseLayout, not duplicated here).
- `BreadcrumbList` present via the `Breadcrumbs` component.
- `ItemList` schema with all 27 `Place` entries, each with `PostalAddress`.
- Sitemap includes `/location-guide/` + all 27 detail pages with `lastmod`.
- Alt text is present and informative on every tile.
- Mosaic images are served as WebP via Astro's image pipeline (AVIF would be marginal improvement).
- llms.txt lists the route.

---

## Priority punch list

- [x] P0 — Remove em-dash at `location-guide.astro:73`
- [x] P0 — Add eager/fetchpriority to first mosaic tile
- [x] P1 — Strengthen title to `Best Photography Locations in Toronto & the GTA`
- [x] P1 — Emit `CollectionPage` alongside `ItemList`
- [x] P1 — Create `public/mirrors/location-guide.md`
- [x] P1 — Tighten description to ~140 chars
- [x] P2 — Enrich alt text with "pre-wedding and engagement" keyword
- [x] P2 — Update llms.txt entry with locations count
- [ ] P2 — Add `image` to each `Place` in `ItemList` (skipped — path resolution is brittle)
- [ ] P2 — Add SEO intro paragraph beneath mosaic (left as future content work)
- [ ] Needs Akash — custom OG image
