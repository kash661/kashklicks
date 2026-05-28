# KashKlicks — Performance & Correctness Audit

**Date:** 2026-05-28
**Scope:** Full `src/` codebase + production build (`dist/`), audited for performance and correctness only (not brand/copy/visual taste).
**Method:** 12 dimension finders → per-dimension adversarial verification (refute-by-default + completeness critic) → empirical build-metrics pass. 25 agents, 74 verified findings.
**Build status:** clean — 84 pages, 3,693 image variants, 6.75s, exit 0, zero warnings.

**Headline verdict:** This is a well-engineered site. The critical-path fundamentals are right (AVIF/WebP images, font preloading, lazy glightbox, tree-shaken shared JS, correct caching headers, scoped CSP, clean secret hygiene, no dead internal links). There are **0 P0 (production-breaking) issues**. The real wins cluster in three themes: **(1) finish the lazy-loading job** (GSAP, flatpickr, glightbox, YouTube, pixels), **(2) fix a site-wide trailing-slash mismatch** that 301-redirects most internal clicks, and **(3) a few revenue/measurement bugs** (dead Google Ads conversion, open form proxy, oversized lightbox originals).

---

## P0 — Production-breaking
None found.

---

## P1 — Must-fix (real, high-impact)

### 1. Engagement-offer LP never fires its Google Ads conversion *(correctness · money)*
`src/pages/free-engagement-session-toronto.astro:1149` sets `window.EOF_GADS_CONVERSION_ID = null`, and the send guard in `EngagementOfferForm.astro:709-715` short-circuits on null. So the **primary paid-ads engagement landing page records zero Google Ads conversions**, starving Smart Bidding on the exact campaign it exists to serve. Leads still capture (Meta + Apps Script fire independently) — this is a measurement/optimization failure, not lost leads.
**Fix:** create the LP conversion action and replace `null` with the real `AW-18099849669/<label>` send_to, mirroring `intimate-wedding-toronto.astro:936-937` which already does this correctly.

### 2. Open, unauthenticated form proxy → lead-injection / inbox-spam *(security · correctness)*
`src/worker.ts:9-34` (`handleEngagementLead`) forwards any POST to the Apps Script endpoint with **no Origin/Referer check, no Turnstile, no honeypot enforcement, no rate limit, no size cap**. All 4 aliases (`/r/intake`, `/r/eof-7k2x`, `/book/intake`, `/api/engagement-lead`) are live, and the upstream `google-apps-script.gs` appends a row + emails `info@kashklicks.ca` on every hit. A loop floods the Inquiries sheet and buries real leads.
**Fix (cheap, high-value):** in `handleEngagementLead`, reject unless `Origin`/`Referer` is `https://kashklicks.ca` (real same-origin form posts — including IG/FB webviews — send this), add a honeypot check, and add a per-IP rate limit via KV keyed on `CF-Connecting-IP`.

### 3. Splash overlay ignores `prefers-reduced-motion` and traps the user *(accessibility · WCAG 2.3.3)*
`SplashOverlay.astro:115-208` + `MobileSplashOverlay.astro:111-190`: on first homepage visit the only guard is the breakpoint; a reduced-motion user gets the full animated splash, **body scroll is locked** (`document.body.style.overflow='hidden'`), and the sole exit (`#splash-enter`) starts `opacity-0` and is revealed only by a GSAP timeline behind `setTimeout(…, 1000)` — a forced ~1s wait before the exit button even appears. The global `global.css:2013` reduced-motion reset only neutralizes CSS keyframes, not GSAP inline tweens.
**Fix:** add a `matchMedia('(prefers-reduced-motion: reduce)')` branch in both `initSplash`/`initMobileSplash` that skips the timeline + 1000ms delay and sets the CTA/corners to final visible state immediately.

### 4. Portfolio galleries init GLightbox twice + render-blocking CDN CSS *(performance)*
`Lightbox.astro:5` pulls `glightbox.min.css` render-blocking from jsdelivr, and `Lightbox.astro:7-16` does a **static** `import GLightbox from 'glightbox'` + init over `.glightbox`. But `BaseLayout.astro:226-231` *already* lazily imports glightbox over the same selector. On every `/portfolio/<slug>` page glightbox is constructed twice (double-bound handlers) and the lazy strategy is defeated. `Lightbox.astro` is the only importer of itself and `GalleryImage` (the only `.glightbox` emitter) is portfolio-only — so `Lightbox.astro` is pure redundancy.
**Fix:** delete the `<script>` block (lines 7-16) and the jsdelivr `<link>` (line 5) from `Lightbox.astro`; BaseLayout's single lazy import already covers it.

### 5. Intimate-wedding LP loads flatpickr render-blocking *(performance · paid-ads page)*
`intimate-wedding-toronto.astro:143` (blocking `<link>`) + `:819` (parser-blocking inline `<script src>`, no defer) load flatpickr from jsdelivr on the critical path of a Tier-1 paid-ads page — where LCP/INP drive Quality Score and CPC — for a date field most visitors never touch. The sibling `free-engagement-session-toronto.astro:71-96` already proves the lazy pattern (load on `requestIdleCallback` or first `focusin`).
**Fix:** port the idle+focus loader from the engagement LP; the init at `:836` already guards on `typeof window.flatpickr === 'function'`.

### 6. Canonical / og:url omit the trailing slash the worker 301-forces *(SEO correctness — 30+ indexable pages)*
`intimate-wedding-toronto.astro:131` and `location-guide/[slug].astro:44` build hardcoded `${site.url}/…` canonicals with no trailing slash, but `worker.ts:85-88` 301-redirects every extension-less slash-less path. So 30+ sitemap pages declare a self-canonical that immediately redirects — weakening the canonical signal and causing social scrapers that don't follow the 301 to miss the link preview.
**Fix:** append `/` to both templates, and set `trailingSlash: 'always'` in `astro.config.mjs` (currently `'ignore'`) so Astro's default canonical logic stays consistent with the worker. (See the trailing-slash theme below — this is the tip of a larger pattern.)

### 7. Homepage statically imports ~114KB of GSAP for decorative scroll *(performance)*
`index.astro:1025-1028` statically imports gsap (70.5KB) + ScrollTrigger (44KB) — ~46KB gzipped — purely for the desktop ken-burns pin, char stagger, plate-rule unfurl, and CTA bracket. Verified **none of it affects LCP** (splash is pre-seeded off, hero char-reveal is the lightweight BaseLayout bundle), so it's pure INP/TBT + bandwidth on the highest-traffic ad page, and it's the swing factor pushing first-load over the project's own 500KB above-fold budget (measured ~494KB raw).
**Fix:** dynamic-`import()` GSAP behind `requestIdleCallback` + `(min-width:768px)` + `(prefers-reduced-motion:no-preference)` — exactly how `magnetic.ts` already dropped its static GSAP dep. Better: reimplement the non-pinned effects with the existing IntersectionObserver/CSS pattern and load ScrollTrigger only for the desktop ken-burns.

### 8. 589MB of full-resolution JPG lightbox originals shipped *(performance — single biggest weight liability)*
Build metrics: `dist/_astro/*.jpg` = **589MB across 561 files, avg 1.45MB, 306 files >1MB, max 2.86MB**. Grid thumbnails are correctly WebP/AVIF (~100KB), but `GalleryImage.astro:13-19` points the lightbox `href` at `src.src` — the **raw unprocessed original**. Opening a 56-image gallery and swiping pulls tens of MB on mobile data (glightbox preloads adjacent slides). E.g. `portfolio/sonia-achyut` = 80MB of lightbox JPGs.
**Fix:** run lightbox targets through `getImage()` (or a sharp pass) to a capped ~2000px-long-edge AVIF/WebP at q60-70 (~150-350KB vs 1.45MB) and point the `href` there. Cuts ~80% of the JPG payload.

### 9. YouTube embeds load the full iframe player instead of a facade *(performance)*
`YouTubeEmbed.astro:49-59` renders a live `youtube-nocookie.com/embed` iframe; `portfolio/[slug].astro:150-164` places the films block at the **top of the left gallery column** (above the masonry), so the first film's iframe boots the full player (hundreds of KB of JS + youtube/googlevideo/doubleclick connections) eagerly on conversion-critical detail pages. `loading=lazy` only helps below-fold ones. (Verified: max 2 films/page, only `manisha-harish` + `harsh-bhayva` have 2.)
**Fix:** click-to-load facade — render the YouTube poster (or an Astro `<Image>`) with a play overlay (reuse `FilmCard.astro:24-31`), swap in the real `<iframe …&autoplay=1>` on click. Zero third-party JS until interaction.

---

## P2 — Should-fix (meaningful but narrower)

### Theme A — Trailing-slash mismatch (the biggest cross-cutting issue)
The worker 301-forces a trailing slash, but many internal links/canonicals are slash-less, so primary navigation 301-redirects on nearly every click and structured-data URLs advertise redirecting URLs. **Root-cause fix: `trailingSlash: 'always'` + normalize link templates.**
- **`correct-dynamic-card-links-trailing-slash-301`** — *all* card-nav loops omit the slash: blog cards (`index.astro:764`, `blog/index.astro:61`), location cards (`location-guide.astro:183,233`, `[slug].astro:223`), every portfolio gallery card (`portfolio/index.astro:226`, `weddings/civil-ceremony/pre-weddings/films`, `RelatedGalleries.astro:43`), service cards (`services/index.astro:261`), portfolio hub chapters (`portfolio/index.astro:29-56`). These are the highest-traffic links on the site. Add `/` to each template literal.
- **`correct-breadcrumb-trailing-slash-301`** (`Breadcrumbs.astro:22,35`) — every non-leaf crumb + its JSON-LD `item` URL omits the slash. Normalize centrally in `Breadcrumbs.astro`.
- **`correct-canonical-trailingslash-mismatch`** — portfolio + location-guide JSON-LD `@id`/`url` keys also omit the slash (rel=canonical on portfolio is fine; location-guide rel=canonical is the P1 above).
- **`correct-service-saleHref-trailing-slash`** (P3) — `services/index.astro:146` `…/${slug}#${id}` → add slash before the fragment.

### Theme B — Finish lazy-loading third-party (perf)
- **`perf-pixels-not-idle-deferred`** — Meta Pixel + gtag + Clarity bootstrap at parse in `BaseLayout.astro:126-172`. Injected scripts are `async` (network non-blocking) but the eval + 3 cross-origin handshakes contend with the LCP hero. Wrap the IIFE body in the same `requestIdleCallback` gate already used at `:209`.
- **`perf-bcdn-preconnect-wasted`** (`BaseLayout.astro:93`) — preconnect to `b-cdn.net` fires on every route, but it's used only by the below-fold homepage video (`preload=none`). Move it to `index.astro` only, downgrade to `dns-prefetch` or attach on scroll.
- **`perf-lcp-not-preloaded`** — homepage hero (`index.astro:210-220`) is `fetchpriority=high` but body-discovered (behind head parse + the analytics IIFE). Add a responsive `<link rel=preload as=image imagesrcset>` for the hero.
- **`perf-oversized-fallback-src`** — hero/CTA `<Image>` `widths` arrays cap below source size, so Astro emits a multi-MB full-res bare `src` fallback (celebrations hero = 2.16MB, CTA = 1.66MB, homepage hero = 695KB). srcset browsers skip it, but non-srcset webviews/preloaders/crawlers pull it. Add a top width matching the largest slot or pre-resize the sources.

### Theme C — Cloudflare worker (perf + security)
- **`perf-no-asset-bypass`** — `run_worker_first:true` runs the worker's JS on all 4,266 `dist/_astro` files + fonts + sounds. Per-asset CPU is trivial (assets still stream from edge) but it's wasted Worker invocations. Add an early bypass: `if (url.pathname.startsWith('/_astro/')||startsWith('/fonts/')||startsWith('/sounds/')) return env.ASSETS.fetch(request);`
- **`perf-double-redirect-chain`** — `www` + slash-less URL = 2 hops (www→apex 301, then →slash 301). Normalize the slash inside the www branch (`worker.ts:43-46`) to collapse to one hop. Query string already survives.
- **`sec-worker-responses-no-security-headers`** — worker-authored Responses (form proxy, `/__diag/ping`, 405/500 bodies) bypass `public/_headers` because `run_worker_first` means `_headers` applies only to ASSETS responses. Spread a shared `securityHeaders` const (nosniff, X-Frame-Options: DENY, tight CSP) into every `new Response()`.

### Theme D — SEO correctness
- **`seo-noindex-page-in-sitemap`** — `free-engagement-session-toronto` is `noindex` but listed in `sitemap-0.xml` → "Submitted URL marked noindex" GSC error. Add `&& !page.includes('/free-engagement-session-toronto')` to the sitemap filter (better: one `NOINDEX_PATHS` array driving both robots meta and sitemap exclusion).
- **`seo-location-guide-description-overlength`** — all 30+ location pages (`[slug].astro:90`) emit 200-259 char meta descriptions; Google truncates at ~155. Shorten the template.
- **`seo-og-image-dimensions-hardcoded`** (`SEO.astro:42-43`, `BlogLayout.astro:36,85`) — every blog post declares `og:image` 1200×630 but serves 2560px covers, including one **portrait 1706×2560** declared as landscape → mis-crop in FB/LinkedIn/Slack. Pass real `coverImage.width/height` or generate a 1200×630 social crop.

### Theme E — Accessibility
- **`a11y-nav-dropdown-aria-expanded-static`** (`Nav.astro:47-83`) — desktop dropdowns hardcode `aria-expanded="false"` (never updates) and misuse `role=menu`/`menuitem` for plain link nav. Remove the menu roles; drop or JS-toggle aria-expanded.
- **`a11y-contactmodal-escape-no-focus-return`** (`ContactModal.astro:114-116`) — Escape closes the native `<dialog>` via the `close` event, which doesn't call `lastFocused?.focus()` (only the button/backdrop paths do). Move focus-return into the `close` listener.

### Theme F — Forms (lead capture)
- **`eof-honeypot-never-checked`** (`EngagementOfferForm.astro:30-33,611-664`) — the highest-spend form's honeypot is decorative; the submit handler never reads `_gotcha`. Add the same client check the other two forms use.
- **`eof-native-date-ios-gotcha-fallback`** (`EngagementOfferForm.astro:87-93`) — wedding-date is `type=date`; if flatpickr is blocked in an IG webview (the exact environment this form targets), the native iOS picker commits today's date on "Done" (per vault gotcha). Switch to `type=text` like the other two date fields.

### Theme G — Duplicate desktop/mobile components (perf)
- **`dup-desktop-mobile-double-render`** — 4 pairs (GearBreaker/MobileGearBreaker, SplashOverlay/MobileSplashOverlay, JourneyTimelineDesktop/Mobile ×6 pages) both render server-side and toggle via CSS `display:none`, doubling HTML/DOM. Astro de-dupes the image binaries but not the markup/scoped styles.
- **`gear-double-eager-image`** (`GearBreaker.astro:63`, `MobileGearBreaker.astro:66`) — the first gear image is `loading=eager` in **both** variants, so the browser eagerly fetches the hidden variant's copy (different srcset/quality, so no cache reuse). Make eager visibility-aware, or unify. (Arguably the mid-page gear breaker shouldn't be eager at all.)

### Theme H — Dev pages + misc
- **`dev-pages-ship-to-prod`** — `/dev/design-system`, `/dev/font-preview`, `/dev/gsap` build into `dist` and are publicly reachable (noindex + sitemap-excluded, but no robots `Disallow: /dev/` and no build exclusion). Gate behind `import.meta.env.DEV` or block in the worker. (`dev/gsap` ships its own page-isolated GSAP chunk — verified NOT in the shared bundle.)
- **`correctness-no-consent-gate`** — pixels fire with no consent mechanism (only a host gate). If EEA/UK traffic is in scope, add Google Consent Mode v2 defaults before the gtag config. For GTA/Canada-only (PIPEDA), document the scoping decision; at minimum add Consent Mode defaults so Google Ads conversion modeling stays valid.
- **`correct-prefetch-config-inert`** (`astro.config.mjs:66-69`) — `prefetchAll:false` + `defaultStrategy:'hover'` with **zero** `data-astro-prefetch` links = nothing ever prefetches. Add `data-astro-prefetch` to nav + portfolio/location card anchors for a free hover-prefetch speedup (the cheapest nav win on a static MPA).

---

## P3 — Minor / polish (selected)
- `perf-q90-heavy-variants` — `quality={90}` (no `format=avif`) on FinalCTA/PortfolioFinalCTA + 4 service pages; drop to q75 AVIF to match the hero convention.
- `perf-magnetic-mousemove-unthrottled-read-write` (`magnetic.ts:23-32`) — `getBoundingClientRect()` read + writes every mousemove, no rAF guard (unlike `parallax.ts`). Cache rect on mouseenter.
- `perf-video-poster-mismatch` (`index.astro:936`) — full-bleed video uses the 1200×630 OG card as poster; generate a real first-frame poster.
- `dead-after-swap-listeners` — 16 `astro:after-swap`/`page-load`/`before-*` listeners site-wide are dead (no `<ClientRouter/>`). Harmless (every one has an immediate init fallback) but misleading. `char-reveal.ts` has no idempotency guard, so this becomes a real double-init bug *if* view transitions are ever added. Delete them, and fix the stale `.claude/CLAUDE.md` "View Transitions" claim + `global.css:1664` comment.
- `unused-components` — `LocationCard`, `FilmCard`, `SectionHeading`, `GalleryGrid`, `PortfolioSidebar`, `SoundToggle` are never imported. `SectionHeading` also violates the CLAUDE.md "No SectionHeading component" rule and references non-existent tokens. Delete.
- `prod-debug-console` (`EngagementOfferForm.astro:658`) — on submit failure, real prospects see `debug: Error: http_502 (after 1843ms)`. Replace with a friendly retry message.
- `seo-homepage-duplicate-localbusiness-node` — homepage emits 2 `LocalBusiness` nodes sharing `@id #business` (works via graph-merge, but brittle). Merge rating onto the single org schema.
- `seo-meta-description-overlength` — homepage description 168 chars (truncated past ~155).
- `a11y-skiplink-target-not-focusable` — add `tabindex="-1"` to `<main id="main-content">`.
- `a11y-mobilemenu-background-not-inert` — set `inert` on siblings when MobileMenu opens (keyboard trap already works).
- `a11y-anchor-role-button` — remove `role="button"` from real `<a href>` in GalleryImage + PricingCard.
- `a11y-floatingselect-no-label-for` — FloatingSelect uses `<p>` not `<label for>` (dev-page-only today).
- `correct-sitemap-404-rule-and-portfolio-tier` — dead `!page.endsWith('/404/')` + `!page.includes('/font-lab')` filter clauses (neither route exists); portfolio hubs and galleries share priority 0.8.
- `correct-lead-no-timeout` (`worker.ts:13-19`) — no AbortController on the Apps Script fetch; add an ~8s timeout → existing 502 path.
- `correct-lead-catch-cacheable` (`worker.ts:28-33`) — 500 branch omits `no-store` (success/diag set it).
- `correctness-diag-colo-mislabeled` (`worker.ts:55-56`) — `colo` field actually holds `cf-ipcountry` (country code). Rename to `country` or read `request.cf.colo`.
- `sec-diag-endpoint-info-disclosure` — `/__diag/ping` reflects caller's own cf-ray/country/UA (self-reflection, low risk); gate behind a query secret or remove.
- `sec-no-hsts` — no `Strict-Transport-Security` in `_headers` (Cloudflare zone-level HSTS likely covers it; add for defense-in-depth).
- `no-js-native-submit-leaks-bare-response` — Contact + intimate-wedding forms have no iframe target; a no-JS submit shows a bare "ok"/"err" page. Add a hidden iframe or a 303 redirect for non-fetch posts.
- `about-travel-notify-no-honeypot-no-attribution` — the about-page travel-log signup posts to the same `/r/intake` booking pipe with no honeypot; confirm Apps Script routes `list=travel-log` to a separate destination.

---

## ✅ Verified correct (explicit passes — don't "fix" these)
- **Form routing** — every form `action` matches a worker-handled alias; no silent lead loss.
- **Form error UX** — all 3 forms correctly key success on `res.ok`, handle 502/500 with retry + mailto/IG fallback; no stuck "Sending…" state.
- **Internal links** — no dead links; dynamic params resolve; all `target=_blank` carry `rel=noopener`; all anchor targets exist.
- **Build & routing** — all 3 dynamic routes' `getStaticPaths` correct, blog draft filter works, content schema valid, clean build.
- **Caching** — `_headers` sets `immutable` long-cache on `/_astro/` + `/fonts/`, `must-revalidate` on HTML; internal links already trailing-slashed so navigation rarely hits the worker 301.
- **Security config** — `_headers` ships nosniff/X-Frame-Options:DENY/Referrer-Policy/Permissions-Policy + scoped CSP; 0 tracked `.env`/`.DS_Store`; no secret leaks; MCP server reads creds from `process.env`.
- **Shared JS bundle** — BaseLayout's 8-init bundle is 7.3KB, tree-shaken (only static dep is sound-manager), glightbox dynamically imported, non-critical inits idle-deferred.
- **Shared CSS** — one 82KB sheet (15KB gzip), deduped `@font-face`, single build-resolved `@import`; near-optimal.
- **Homepage critical path** — ~494KB raw / ~365KB gzip; AVIF/WebP hero, font preloads, lazy glightbox. The one thing over budget is the eager GSAP (P1 #7).

---

## Recommended fix order
1. **Same-day quick wins (high value, low risk):** P1 #1 (Google Ads conversion ID), P1 #4 (delete redundant Lightbox.astro init), the trailing-slash root fix (`trailingSlash:'always'` + card-link templates — Theme A), P2 worker asset-bypass + single-hop redirect.
2. **This week:** P1 #2 (form-proxy abuse controls), P1 #3 (splash reduced-motion), P1 #5 (flatpickr lazy), P1 #8 (lightbox image pipeline — biggest weight win), P1 #9 (YouTube facade), P1 #7 (GSAP defer).
3. **Backlog:** the P2 SEO/a11y/forms themes, then P3 polish + dead-code cleanup.
