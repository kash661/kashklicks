# Homepage Mobile Patterns — Reference

Captured from the `feature/home-page-redesign` work on 2026-04-17.
Use this as the pattern spec when applying the same treatment to the
Portfolio, Services, About, Contact, and sub-pages on mobile.

Primary audience: couples spending $30–50k on their wedding, landing
on mobile (≈80% of site traffic). The site must feel premium and
editorial from the first tap.

---

## 1. Design Principles

### 1.1 Mobile-first, always
Every layout decision optimises for a 375–430px viewport. Desktop
is an enhancement on top, never the default. Test on an actual phone
before calling anything done.

### 1.2 Editorial gallery (Digital Curator)
Photographs are the hero. Interface is supporting architecture. The
page should feel like walking through a sun-drenched gallery — quiet,
architectural, intentional. Never a wedding template, never corporate.

### 1.3 Typography by intent
Every text element is classified before it's written:

| Intent | Font | Classes |
|---|---|---|
| Emotional / artistic | Serif (Cormorant Garamond), italic when poetic | `text-display-lg`, `text-display-md`, `text-heading-lg`, `text-quote` |
| Informational / functional | Sans (Inter) | `text-body-lg`, `text-body-md`, `text-label-md`, `text-label-sm` |

Before adding any text, ask: *emotional or informational?* The answer
picks the font. No exceptions.

### 1.4 Asymmetric grids
`grid-editorial` is a 12-column grid with 24px gutters. Use asymmetric
spans — headings on cols 1–5, body on cols 7–12 (or mirrored). Never
centre everything. Never 3-equal-column card rows.

### 1.5 Content visible from scroll start
Do not rely on hover or tap to surface critical information. Hover is
enhancement only. Every CTA, price, and trust signal is readable on a
static mobile screenshot.

### 1.6 Safe-area respect
Every absolutely-positioned bottom element uses
`max(1.5rem, env(safe-area-inset-bottom))` so it isn't hidden behind
the iOS home indicator.

### 1.7 Hard rules (non-negotiable)
- **0px border-radius** everywhere.
- **No gold, no metallic.** Stone/taupe palette only.
- **No em/en dashes** in copy — instant AI tell. Use periods, commas,
  middle dots (·), or restructure.
- **No auto-playing sound.** Muted by default.
- **No Google Fonts CDN.** All fonts self-hosted woff2.
- **No fake content.** Locations, testimonials, numbers — if it isn't
  real and verified by Kash, it doesn't ship.

---

## 2. Layout and Spacing

### 2.1 Section spacing (mobile-tightened)
```css
--spacing-section: clamp(56px, 10vw, 160px); /* between sections */
--spacing-block:   clamp(40px,  6vw,  96px); /* within sections */
--spacing-element: 24px;
--spacing-tight:    8px;
```
The mobile floor was dropped from 80px to 56px so sections don't feel
like they "slide apart" on small screens. Apply the same token when
building new pages — do not hardcode py-20 etc.

### 2.2 Hero height
```html
<section class="relative h-[100svh] min-h-[600px] w-full overflow-hidden bg-surface-container">
```
Using `100svh` (not `100vh`) stops the iOS Safari address-bar jump
when scrolling begins. `min-h-[600px]` protects short viewports.

### 2.3 Gallery frames
On desktop, images are fit-content with max-height 50vh (art-piece
framing). On mobile, every `.gallery-frame` and its `img` child spans
100% of the column — otherwise portrait photos float small with awkward
side gaps.

```css
@media (max-width: 640px) {
  .gallery-frame { width: 100%; }
  .gallery-frame img { max-height: none; width: 100%; }
}
```

### 2.4 Measure helpers (heading widths)
Inline `style="max-width: 14ch"` on headings looks great on desktop
and cramped on mobile. Replaced by three classes that apply the
constraint only at `min-width: 640px`:

```css
.measure-tight  { max-width: none; }
.measure-medium { max-width: none; }
.measure-wide   { max-width: none; }

@media (min-width: 640px) {
  .measure-tight  { max-width: 14ch; }
  .measure-medium { max-width: 18ch; }
  .measure-wide   { max-width: 44ch; }
}
```
Usage: `<h2 class="text-display-md text-on-surface measure-tight">...`

### 2.5 Paired images
When two images stack on mobile (from a `md:col-span-7` + `md:col-span-5`
pair), use `mt-3 md:mt-24` on the second one. On mobile the tight
12px gap reads as *a pair*; on desktop the 96px drop creates the
editorial staircase.

### 2.6 Row flipping on mobile
For any 2-column image+text row, decide which side the reader should
see first on mobile. Usually it is the text/CTA. Apply
`order-first md:order-none` to the text column so pricing / hook comes
before the photograph in the stacked mobile flow.

### 2.7 Gallery captions
Bumped from 12px to 13px (`0.8125rem`). On mobile, 12px uppercase
letter-spaced text is strained to read. 13px is the readable floor.

---

## 3. Animation System

The site runs a single, cohesive animation vocabulary. Do not invent
new motion per page. When building a new page, pick from this list.

### 3.1 Entrance reveals (IntersectionObserver)
Driven by `initScrollReveal` in `src/scripts/scroll-reveal.ts`. Add
`.revealed` when element crosses 10% viewport threshold.

| Class | Behaviour | Distance / Duration |
|---|---|---|
| `reveal` | Fade + translateY up | 20px / 600ms |
| `reveal-left` | Fade + slide from left | 60px / 1.2s |
| `reveal-right` | Fade + slide from right | 60px / 1.2s |
| `scale-reveal` | Fade + scale from 0.98 | — / 600ms |
| `stagger-1` … `stagger-5` | Delay modifier on any reveal | 100–500ms |

Cadence rule: heading column gets plain `reveal`, body/quote column
gets `reveal stagger-2` so the heading lands first.

### 3.2 Character reveal
`char-reveal` on display headings splits them into per-character
fades as the element scrolls into view. Reserved for the **hero H2**,
every **section H2** that uses `text-display-md`, and the
**Contact CTA H2**. Do not overuse on smaller headings.

Data attrs on the hero tagline make the first word group prefade:
```html
<h2 class="... char-reveal" data-fade-prefix-count="12" data-fade-prefix-opacity="0.4">
```

### 3.3 Eyebrow rule (hairline draw)
`eyebrow-rule` on a label paragraph draws a 40px hairline 8px below
the text when the parent `.reveal` enters the viewport. Signature
editorial detail. Use on every `text-label-md` section opener. Variant
`eyebrow-rule-center` for centred containers, `eyebrow-rule-on-dark`
for dark backgrounds.

### 3.4 Parallax
`parallax-img` on images inside a gallery frame gives them an 8%
vertical drift as they scroll through the viewport.
Desktop-only — disabled under 640px:
```css
@media (max-width: 640px) {
  .parallax-img {
    will-change: auto;
    transform: none !important;
  }
}
```

### 3.5 Hover zoom (desktop only)
`hover-zoom` on a gallery-frame slowly scales its inner `img` to 1.04
over 2.5s on hover. Mobile is a no-op. Do not try to replicate on
touch — it cheapens the feel.

### 3.6 Magnetic
`magnetic` on a CTA wrapper pulls it slightly toward the cursor.
Desktop-only visible effect, harmless on touch.

### 3.7 Scroll progression cues
- `.scroll-progress` — 2px hairline at the top of the viewport that
  fills left-to-right as the document scrolls. Updated by
  `initScrollProgress` in `src/scripts/scroll-progress.ts`, set on
  `:root` via `--scroll-progress` var.
- `.scroll-rail` + `.scroll-rail-wrap` — on the hero only: a 1px
  vertical hairline with a travelling dot, anchored above the
  safe-area-inset-bottom. Replaces the bouncy chevron that shipped
  with the original redesign.

### 3.8 Reduced motion
Everything above respects `prefers-reduced-motion: reduce`. The
reveals snap to `revealed` immediately, parallax freezes, hover-zoom
is disabled. When adding new motion, always add a reduced-motion
branch.

---

## 4. Section Breakers

The homepage's section template — eyebrow / display heading /
quote / gallery pair — is deliberately repeated across Signature
Style, Recent Work, and FAQ. After three of those in a row, the
reader's brain predicts the next entrance. We broke the pattern with
two structural interrupts.

### 4.1 Breaker 1 — dark pull quote
**Placement:** between Signature Style (section 2) and Investment
(section 3). Also usable between any two light-background sections.

**What it does:**
- Palette inversion: `bg-surface-dark` against white/dim neighbours.
- Pure typography: serif italic, no image, no eyebrow, no stagger,
  no char-reveal. Every pattern used elsewhere is intentionally absent.
- 55svh minimum height — gives the quote room to breathe and acts as
  a visual pause before the reader re-engages.

**Grammar:**
```html
<section class="breaker-quote" aria-label="...">
  <div class="breaker-quote__inner">
    <span class="breaker-rule" aria-hidden="true"></span>
    <blockquote class="breaker-quote__text">
      A wedding isn't a pose. It's the hand you didn't notice you were holding.
    </blockquote>
    <p class="breaker-quote__attribution">Kash, Toronto</p>
  </div>
</section>
```

### 4.2 Breaker 2 — horizontal marquee
**Placement:** between Recent Work (section 5) and FAQ (section 6).
Usable on any page where a list of locations, services, or tags makes
editorial sense.

**What it does:**
- Different motion axis (horizontal right-to-left) from every
  surrounding section's vertical reveal.
- Continuous, not triggered — 55s loop at constant velocity.
- Pure serif italic caps, middle-dot separators. Reads as a masthead
  callout.
- Seamless via duplicated set + `translateX(-50%)`.
- `prefers-reduced-motion` freezes the track at a static offset.

**Content rule:** only real, verified facts. A marquee full of
fabricated city names is worse than no marquee.

---

## 5. Hero Composition (mobile)

```
┌──────────────────────────────┐
│ [full-bleed photo + gradient]│
│                              │
│         AD PHOTOS            │ ← logo-mark eyebrow
│                              │
│   Moments fade.              │ ← text-display-lg + char-reveal
│   Memories don't.              │
│                              │
│   Your Toronto wedding       │ ← text-body-md H1 (SEO, informational)
│   photographer and filmmaker │
│                              │
│                              │
│                              │
│     [ Begin Your Story ]     │ ← hero-cta, absolute, above rail
│            │                 │ ← scroll-rail (1px vertical hairline)
└──────────────────────────────┘
```

Key decisions:
- H1 visually small for SEO but in the DOM *after* the large H2.
  `order-1` on H2, `order-2` on H1 so the emotional line reads first
  but the keyword-rich H1 is in proper hierarchy for crawlers.
- CTA is a ghost-outlined button (`border-on-dark/70`, transparent
  background) — loud enough to be tappable, quiet enough not to
  compete with the tagline.
- Caption ("Mehak & Manal · Kelowna, BC 2026") in bottom-left is
  desktop-only (`hidden md:block`).

---

## 6. Typography Scale

| Class | Use | Mobile → Desktop |
|---|---|---|
| `text-display-lg` | Hero tagline only | 3rem → 5.5rem |
| `text-display-md` | Every section H2 | 2.25rem → 4rem |
| `text-heading-lg` | Sub-section heading | 1.75rem → 2.5rem |
| `text-heading-md` | Card heading | 1.25rem → 1.75rem |
| `text-body-lg` | Primary body | 1.125rem, line-height 1.7 |
| `text-body-md` | Secondary body | 1rem |
| `text-quote` | Pull quote | 1.5rem → 2.25rem, italic |
| `text-label-md` | Eyebrow / nav / CTA | 0.8125rem, uppercase, 0.1em tracked |
| `text-label-sm` | Micro labels | 0.6875rem, uppercase, 0.12em tracked |

---

## 7. Interaction Upgrades on the Homepage

### 7.1 Tappable Recent Work
Each Recent Work image is an `<a>`, not a `<div>`. Tap navigates to
the portfolio album (when the couple has one) or the portfolio index
(fallback). aria-label explains the destination. This is the baseline
pattern for any image grid: if a gallery exists, the image links to it.

### 7.2 FILM badge
Editorial "FILM" chip top-left of the Meghna + Puneeth card because
the album has a video. Small, tracked caps, backdrop-blurred bg.
Reusable for any card that ships with a film.

```html
<span class="absolute top-4 left-4 md:top-6 md:left-6 z-10 inline-flex items-center gap-2 text-[0.6875rem] tracking-[0.14em] uppercase font-sans text-on-dark bg-black/40 backdrop-blur-[2px] px-3 py-1.5">
  <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor" aria-hidden="true"><path d="M1.5 0.5l7 4-7 4z" /></svg>
  Film
</span>
```

---

## 8. Applying This to Other Pages

When working on Portfolio, Services, About, Contact, or sub-pages, use
this checklist.

### 8.1 Layout
- [ ] Replace any `h-screen` hero with `h-[100svh] min-h-[600px]`.
- [ ] Any inline `style="max-width: Nch"` on a heading becomes a
      `.measure-*` class.
- [ ] Any 2-col image/text row decides its mobile order explicitly
      (`order-first md:order-none` on the text column if pricing/CTA
      should lead).
- [ ] Paired stacked images use `mt-3 md:mt-24` to read as a pair on
      mobile.
- [ ] Section spacing only uses `var(--spacing-section)` /
      `var(--spacing-block)`. No raw `py-20`.
- [ ] Gallery frames are full-width on mobile via the global rule
      (no per-page override needed unless overriding up).

### 8.2 Type
- [ ] Eyebrow labels use `text-label-md text-on-surface-muted
      eyebrow-rule mb-4`.
- [ ] Section H2s use `text-display-md ... char-reveal measure-*`.
- [ ] Quote/descriptive text uses `text-quote ... measure-wide`.
- [ ] Body uses `text-body-lg` or `text-body-md`.
- [ ] Never mix serif/sans in the same semantic role.

### 8.3 Animation
- [ ] Two-column reveal: left/heading col gets `.reveal`, right/body
      col gets `.reveal stagger-2`.
- [ ] Gallery-frame rows use `.reveal-left` / `.reveal-right` with
      `stagger-2` on the second.
- [ ] Wide landscape hero image uses `.scale-reveal`.
- [ ] Every image gets `.parallax-img` unless it's already inside a
      frame that has reveal motion.
- [ ] CTAs wrap in `.magnetic` on desktop (harmless on touch).

### 8.4 Breakers (long pages only)
Any page with 4+ repeating-structure sections needs at least one
breaker. Use Breaker 1 (dark pull quote) or Breaker 2 (horizontal
marquee) — or invent a third that is still deliberately unlike the
template sections around it (different palette, different type,
different motion axis).

### 8.5 Mobile verification
Before marking a page done:
- [ ] Test on actual mobile at 375px AND 430px viewport.
- [ ] Scroll the whole page — does any section feel like PPT?
- [ ] Are the breakers doing their job?
- [ ] Tap every image and every CTA — do they all go somewhere real?
- [ ] Does the bottom CTA or nav sit above the iOS home indicator?
- [ ] Does the hero stay put when the address bar hides?
- [ ] Are all displayed facts (locations, counts, testimonials) real?

### 8.6 Copy
- [ ] First-person singular throughout ("I", "my"), never "we / our",
      except on portfolio narratives where couple is plural.
- [ ] No em/en dashes.
- [ ] Middle dot (·) is the only approved ornamental separator.
- [ ] Every factual claim (places shot, count of weddings, years in
      business) is verified with Kash before shipping.

---

## 9. File Map

```
src/
├─ pages/index.astro                ← reference implementation of all of this
├─ styles/global.css                ← all tokens and primitive classes
├─ layouts/BaseLayout.astro         ← scroll-progress + motion script init
├─ scripts/
│  ├─ scroll-reveal.ts              ← IntersectionObserver for .reveal*
│  ├─ scroll-progress.ts            ← top hairline progress bar
│  ├─ parallax.ts                   ← .parallax-img desktop parallax
│  ├─ char-reveal.ts                ← per-character hero/H2 reveals
│  └─ magnetic.ts                   ← cursor-pull on .magnetic
└─ components/
   └─ global/
      └─ Header.astro               ← transparent-over-hero pattern
```

When you need to remember exactly how a pattern was wired on the
homepage, open `src/pages/index.astro` — it is the living reference
for every principle captured here.
