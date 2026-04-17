# Homepage SEO Audit — 2026-04-16

**Scope:** `/` (src/pages/index.astro), `/llms.txt`, `/mirrors/home.md`, `/sitemap-index.xml`, `/robots.txt`
**Auditor:** Claude
**Status:** Findings only. No changes applied.

---

## TL;DR

The homepage scaffolding is solid: title, description, canonical, OG/Twitter, JSON-LD, sitemap, robots.txt, llms.txt and a markdown mirror are all in place. The issues fall into three buckets:

1. **Stale content mirrors** — `mirrors/home.md` and `llms.txt` reference deleted pages and out-of-date hero data.
2. **Duplicate / conflicting JSON-LD** — a second `LocalBusiness` in `index.astro` conflicts with the global one in `BaseLayout.astro`.
3. **Hero image weight** — the LCP image is ~1MB base, well above the 150KB / 500KB above-fold budgets defined in `CLAUDE.md`.

Everything else is polish. Full list below, prioritised.

---

## P0 — Fix before next deploy

### 1. `mirrors/home.md` is out of date

File: `public/mirrors/home.md`

- **Title/description mismatch.** Claims description is "Warm, candid wedding and civil ceremony photography…" — actual site description is "Toronto wedding photographer and filmmaker. AD Photography captures candid, cinematic pre-wedding and wedding photography across the GTA and Canada. Packages from $350."
- **Hero couple mismatch.** Says `Ayushi & Parth, Toronto, 2025` — homepage now shows `Mehak & Manal, Toronto, 2026`.
- **Dead link: `/pricing`.** Mirror's Investment CTA points to `/pricing` — that route was deleted (`D src/pages/pricing.astro` in git status). Homepage now points to `/services`.
- **Featured gallery mismatch.** Mirror only lists two pair images (Ayushi+Parth, Alex+Aziz); current homepage also surfaces Meghna+Puneeth, Swathi+Saksham, Nora+Ali in the "Recent Work" block.

### 2. `llms.txt` has a dead-link URL

File: `public/llms.txt`

- Lists `https://kashklicks.ca/pricing/` under Pages — route is deleted, will 404 for any LLM that crawls it.
- Packages block lists both `Love Story Duo: $550` and `Love Story + Film: $550` — verify pricing.json is the source of truth and reconcile.
- Only one markdown mirror is registered. Plan to add mirrors for `/services`, `/portfolio`, `/about`, `/contact` and list them here once they exist.

### 3. Duplicate `LocalBusiness` JSON-LD with conflicting fields

Files: `src/layouts/BaseLayout.astro` (site-wide org schema) + `src/pages/index.astro` (page-specific jsonLd).

Both emit `@type: LocalBusiness` for the same entity. Conflicts:

| Field | BaseLayout | index.astro |
|---|---|---|
| `priceRange` | `$$` | `$350 - $3800` |
| `email` | *missing* | `hello@kashklicks.ca` |
| `@id` | *missing* | `https://kashklicks.ca/#business` |
| `areaServed` | flat string array | `City` objects |

**Fix:** pick one canonical LocalBusiness emission (recommend keeping it in `BaseLayout` so every page has it, and adding `@id`, `email`, full `areaServed`, explicit `priceRange`). Remove the duplicate `LocalBusiness` from `index.astro` — keep only the `WebSite` entry there.

### 4. Hero image LCP weight

- Base hero WebP: `hero-main.D0yqv8Gw_1BsKjx.webp` = **988KB**. Largest srcset variant = **552KB**. CLAUDE.md target is **150KB AVIF** for hero.
- Hero `<Image>` does not set `fetchpriority="high"` — built HTML shows `fetchpriority="auto"`. Astro's `priority` / explicit `fetchpriority` prop needed to hint the browser.
- `loading="eager"` is set ✓ but without `fetchpriority="high"` it competes with other eager resources.
- No AVIF output — only WebP. Astro image pipeline supports AVIF; add `format="avif"` or configure `image.formats`.

**Fix:**
```astro
<Image
  src={heroImage}
  alt="…"
  widths={[768, 1280, 1920]}
  sizes="100vw"
  quality={75}
  format="avif"
  loading="eager"
  fetchpriority="high"
/>
```
Drop quality to 70–75 for the hero specifically — it's a darkened gradient overlay, compression artefacts won't show.

---

## P1 — Next iteration

### 5. Two H1s when splash is present

`public/mirrors/home.md`... actually: when `showSplash={true}` the built HTML contains:
- Splash H1: `<h1 class="text-display-lg text-on-dark">AD</h1>` (inside `#splash-overlay`, `style="display:none"` by default)
- Page H1: `<h1 class="text-display-lg text-on-dark char-reveal" …>Moments fade. Memories don't.</h1>`

Both render server-side. Google treats each as an H1. Fix by demoting the splash `AD` to `<p class="text-display-lg">` or `<h2>` — the splash heading is decorative branding, not document structure.

### 6. Hero H1 contains no target keywords

Current H1 is the tagline `Moments fade. Memories don't.` (brand/emotional). The H2 below it carries the keyword payload: `Your Toronto wedding photographer and filmmaker, telling real love stories.`

This is a deliberate brand choice per the design system (serif/emotional vs. sans/informational). Not a bug, but flagging because:
- Google heavily weights H1 for topical relevance.
- Bing/DuckDuckGo weight it even more.

**Options:**
- (a) Keep as-is. Accept weaker H1 signal; rely on title + H2 + body.
- (b) Swap H1 ↔ H2 semantic roles while preserving visual hierarchy (H1 = "Toronto wedding photographer…", H2 = "Moments fade…"). Design unchanged, crawler sees keyword H1.
- (c) Merge into a single H1 like `Toronto wedding photographer — moments fade, memories don't.` (kills tagline elegance).

Recommend **(b)**.

### 7. OG image is 5.5KB placeholder

- `public/og-default.jpg`: 1200×630, **5594 bytes**. That's extremely light for a photography site — almost certainly a placeholder, confirmed by `Known Issues` in CLAUDE.md.
- Social link previews (Facebook, WhatsApp, Slack, iMessage, LinkedIn) will look awful.
- Also missing: `<meta property="og:image:width" content="1200">`, `og:image:height`, `og:image:alt`.

**Fix:** regenerate a real 1200×630 hero frame with "AD Photography" wordmark + tagline, 100–200KB JPEG.

### 8. Testimonial rendered but no `Review` / `aggregateRating` schema

Homepage displays a testimonial block with quote + attribution. No `Review` schema attached. Rich snippets for a single testimonial are limited (Google discourages single-Review on business pages), but an `aggregateRating` against the `LocalBusiness` would unlock star-rating rich results if you track real ratings.

**Fix:** once `testimonials.json` stabilises with enough samples, emit `aggregateRating` on the `LocalBusiness` with `ratingValue` + `reviewCount`.

### 9. Missing/empty contact fields in `site.json`

- `phone: ""` — empty. LocalBusiness schema without telephone is weaker for local pack.
- No `openingHours` in schema.
- Consider adding `sameAs` for Google Business Profile if one exists.

### 10. Sitemap has no `<lastmod>`

Built `sitemap-0.xml` is bare `<url><loc>…</loc></url>`. Adding `lastmod` nudges Google to recrawl faster after changes.

**Fix:** configure `@astrojs/sitemap` with `lastmod` option + per-page frequency hints. Or emit a custom sitemap route.

---

## P2 — Nice-to-haves

### 11. Preconnect / DNS-prefetch missing

Homepage loads video from `kashklicks.b-cdn.net` and analytics from `static.cloudflareinsights.com`. No `<link rel="preconnect">` or `rel="dns-prefetch">`.

```html
<link rel="preconnect" href="https://kashklicks.b-cdn.net" crossorigin>
<link rel="dns-prefetch" href="https://static.cloudflareinsights.com">
```

### 12. CTA video lacks `poster` and `preload` strategy

The `<video>` in the Contact CTA auto-loads metadata by default. On a page where the video is the 6th section, this is wasted bandwidth until the user scrolls down. Options:
- `preload="none"` + IntersectionObserver to start loading ~200px before viewport entry.
- Add `poster="/og-default.jpg"` (or a dedicated poster) so the dark background doesn't flash.

### 13. Alt text quality

Most alts are good. Two are generic:
- `Ayushi and Parth, candid wedding moment` — add Toronto / location.
- `Wedding photography session in Toronto by AD Photography` — no couple identifier, no event type. Could be `Full-day wedding photography, Toronto`.
- `Alex and Aziz, pre-wedding portrait` — add Toronto.

Rule of thumb: `[couple/subject], [event type], [location], [photographer]` when natural.

### 14. Cloudflare Analytics token is still placeholder

`data-cf-beacon='{"token": "YOUR_CF_ANALYTICS_TOKEN"}'` in `BaseLayout.astro`. No analytics = no Core Web Vitals field data, no search landing data. Not SEO blocking, but blocks measurement.

### 15. No FAQ / faq schema on homepage

`src/data/faq.json` exists but isn't surfaced on `/`. A 3–4 question FAQ block near the bottom (below testimonial, above contact CTA) with `FAQPage` schema would:
- Add indexable long-tail content.
- Potentially earn FAQ rich results (Google has scaled these back but they still appear for local-service queries).

### 16. Missing meta hints

- `<meta name="theme-color" content="#faf9f6">` — small brand polish.
- `<meta name="author" content="Akash Desai">`.
- Geo meta tags (`geo.region`, `geo.placename`, `ICBM`) — marginal, some local SEO tools check them.

### 17. `keyword-map.md` is stale

`docs/seo/keyword-map.md` still references `/portfolio/events` and `/portfolio/portraits` (deleted routes) and uses "KashKlicks Studios" naming. Update to match current brand ("AD Photography") and current route structure when you next touch it.

### 18. llms.txt could be richer

The current file is spec-compliant but bare. Consider adding:
- Brand positioning statement (from `project_positioning_solo.md`): "solo, intimate weddings, church/civil ceremonies — not a studio".
- Style cues: "candid, cinematic, editorial; no posed line-ups".
- "Do not book" signals if any (e.g. large destination Indian weddings requiring multi-shooter teams).
- Blog post index (currently missing from llms.txt entirely).

---

## What's already good (don't regress)

- Title template (`AD Photography | Toronto Wedding Photographer & Videographer`) is 62 chars, keyword-forward, within SERP limits.
- Description is 169 chars, includes brand + service + geo + price hook.
- `<link rel="canonical">` present and correct.
- OG + Twitter Card tags all present with site name, locale `en_CA`, `og:type=website`.
- `html lang="en-CA"` set.
- Skip-to-content link for a11y (crossover with SEO via engagement signals).
- Single (intended) H1; semantic heading order otherwise clean.
- Sitemap auto-generated, all 30 URLs present, no orphans, no deleted pages leaking in.
- `robots.txt` allows all + points to sitemap index.
- Images have width/height, srcsets, lazy-loading on below-fold, eager on hero.
- JSON-LD: `WebSite` + `LocalBusiness` (fix duplication per P0.3) with geo, areaServed, sameAs.
- View transitions + prefetch + client prerender enabled for fast navigation.

---

## Priority punch list (copyable)

- [ ] P0 — Regenerate `public/mirrors/home.md` from current `index.astro`
- [ ] P0 — Remove `/pricing` entry + reconcile package pricing in `public/llms.txt`
- [ ] P0 — Consolidate LocalBusiness schema to one emission (recommend `BaseLayout`)
- [ ] P0 — Shrink hero to <200KB AVIF + add `fetchpriority="high"`
- [ ] P1 — Demote splash H1 to avoid two H1s on homepage
- [ ] P1 — Decide H1 vs H2 swap for keyword targeting
- [ ] P1 — Replace `og-default.jpg` placeholder with real 1200×630 brand asset
- [ ] P1 — Fill `site.json` phone + hours, enable `aggregateRating` once sample size allows
- [ ] P1 — Enable `lastmod` in `@astrojs/sitemap` config
- [ ] P2 — Add preconnect to `b-cdn.net`
- [ ] P2 — Add `poster` + `preload="none"` to CTA video
- [ ] P2 — Tighten generic alt texts
- [ ] P2 — Real Cloudflare Analytics token
- [ ] P2 — Add FAQ block + `FAQPage` schema to homepage
- [ ] P2 — Add theme-color + author meta
- [ ] P2 — Refresh `keyword-map.md` brand + routes
- [ ] P2 — Enrich `llms.txt` with positioning + blog index
