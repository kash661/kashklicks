# Mobile / Desktop UI — Best Practices for KashKlicks

**Context:** Astro 5 static site, Tailwind v4, Cloudflare. Mobile is the dominant, revenue-driving traffic source (paid social + Google Ads land on phones). Researched + grounded in the codebase 2026-05-28.

## The governing rule: different UI, same UX

"Different UI, same UX" is current (2025–2026) best practice — keep that instinct. The line:

- **Must be IDENTICAL across devices:** all body copy, headings, internal links, every CTA / conversion path, JSON-LD, alt text.
- **Free to differ:** column count, source order, nav pattern (inline vs drawer), tap-vs-hover affordances, density, motion.

Mobile-first indexing is fully rolled out — **the mobile HTML is effectively the only index.** Never move SEO-relevant text, a link, or structured data into a desktop-only block or a `client:only` island the mobile HTML lacks. (Our static one-URL-per-route MPA has zero m-dot / dynamic-serving risk.)

## How to deliver device-different UI on a *static* site

Two honest tools only — per-request UA sniffing is out (no SSR adapter, and it blows up Cloudflare's cache via `Vary: User-Agent`):

1. **CSS-only single component (DEFAULT).** Mobile-first CSS reflow (`grid-template-areas` / flex `order` / `clamp()`) + **container queries** (Baseline-wide since Aug 2025, no polyfill). Smallest HTML, one heading outline, one image set, nothing to keep in sync, cleanest for indexing.
2. **`matchMedia` / `client:media`-gated JS** — when motion/behavior must differ; gate so the wrong device never runs the JS.

**Avoid as the default:** rendering BOTH a desktop and a mobile component and hiding one with `display:none`. It's not an SEO or a11y problem (`display:none` is dropped from the a11y tree; text stays in the mobile HTML; repeated HTML brotli-compresses to ~10–30%), but it's duplicated markup + a two-files-to-sync maintenance tax. **Use it only when the DOM nesting or motion choreography genuinely can't reflow.**

## Verdict on our duplicate component pairs

| Pair | Verdict | Why |
|------|---------|-----|
| **JourneyTimelineDesktop / Mobile** | **Merge → one responsive component** | Same `steps` prop, layout-only difference, duplicated across 5 pages. CSS reflow + one `gsap.matchMedia` block covers it. `GearStrip` is already a single responsive component — proof it works here. |
| **GearBreaker / MobileGearBreaker** | **Keep separate** | Desktop asymmetric "chapter" layout vs mobile vertical card-stack is a genuine DOM/choreography fork — the legitimate two-component case. Images already `loading="lazy"` so the hidden twin doesn't fetch. |
| **SplashOverlay / MobileSplashOverlay** | **Borderline; currently disabled** | Same copy. If re-enabled, lean to one DOM with the intro branched by `matchMedia`. (Splash is off today via `showSplash={false}`.) |

**Rule of thumb:** separate code is correct when the layouts genuinely fork (Gear); it's just overhead when they don't (Journey).

## Mobile-perfection checklist (state as of 2026-05-28)

- [x] Inputs ≥16px (no iOS zoom-on-focus); EOF form sets `type=email inputmode=email autocomplete=email`.
- [x] Full-height sections use `100dvh` / `100svh`, not raw `100vh`.
- [x] LCP hero eager + `fetchpriority=high` + matching preload (one copy per page — verified not duplicated).
- [x] `magnetic` gated to `pointer:fine`; GSAP behind `gsap.matchMedia` + `prefers-reduced-motion`.
- [x] Gear images lazy (hidden twin doesn't fetch).
- [x] **`viewport-fit=cover`** added so the existing `env(safe-area-inset-*)` CSS actually fires on notched iPhones. *(done 2026-05-28)*
- [x] **Hero srcset has sub-640 steps** (480/640) so small phones don't pull a 768w file. *(done 2026-05-28)*
- [ ] **Unify breakpoints** — splash 767 / journey 768 / gear 1024 → pick one boundary per concern; make the CSS hide-boundary and the `matchMedia` JS-gate use the identical value (avoids dead zones).
- [ ] **Tap targets** — primary CTAs (book/inquire, FAQ summary rows) at 44–48px; everything interactive ≥24px (WCAG 2.2). Ghost Button (~32px) + nav/footer links need a check.
- [ ] **Dedupe ids/`<h2>`** in any kept-split pair (duplicate `id`s are invalid HTML even when hidden — breaks `querySelector`/fragment links). Keep the canonical heading on one variant.
- [ ] FloatingInput: forward `inputmode`/`autocomplete` for reuse; add CSS guardrail `input,textarea,select{font-size:max(16px,1em)}` (regression-proofing; real forms already correct).
- [ ] *(optional)* `content-visibility:auto` + `contain-intrinsic-size` on below-the-fold sections for INP/render wins on long mobile pages.
- [ ] *(optional)* Gate splash Ken Burns + autoplay video behind `prefers-reduced-data` / Save-Data.

## Measure mobile on FIELD data, not Lighthouse

Lighthouse is lab-only and **can't measure INP** (the metric that replaced FID in March 2024). Use PageSpeed Insights/CrUX field data + the Microsoft Clarity already wired in (`wfh1khoxjx`). Targets at **p75-mobile: LCP ≤2.5s, INP ≤200ms, CLS <0.1.**
