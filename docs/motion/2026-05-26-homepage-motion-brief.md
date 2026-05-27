# Homepage Motion Brief — Subtle, Considered

Date: 2026-05-26
Author: emil-design-eng (analysis), to be implemented by `gsap` skill
File: `src/pages/index.astro`

## Premise

The homepage is not motion-poor. It already has:

- A choreographed first-visit GSAP entrance timeline (logo, h1, char-by-char tagline, CTA, caption, scroll-rail) that ends with "Moments fade." fading down to 0.32 opacity while "Memories don't." stays — a brilliant content-driven beat that earns its place.
- Pinned ken-burns ScrollTrigger on the hero (scale 1→1.12, copy translates and fades, scrub 1).
- Per-character ScrollTrigger reveal on every section display heading (`[data-gsap-chars]`).
- IntersectionObserver `.reveal` / `.reveal-left` / `.reveal-right` + `stagger-N` for opacity + translate.
- `parallax-img` (8vh drift), `hover-zoom` (2.5s scale 1.04), `magnetic` (3px cursor pull), `card-lift`, `eyebrow-rule` draw-in, `scroll-rail` travelling-dot, `breaker-marquee`, `scroll-progress` hairline.

So this brief is not "where can we add animation." It is **where the next layer of restraint earns its place**, and **which hover micro-states currently feel slower than the system should respond.**

Constraints (locked):
- Subtle only. Nothing infinite, nothing parallax-circus.
- Respect `prefers-reduced-motion`. Reduce to fade-only or skip motion-based reveals.
- No CLS, no LCP impact. Hero image already eager + fetchpriority high; don't touch.
- "Cinematic, calm, considered" — the gallery vocabulary set by CLAUDE.md.

---

## ADDITIONS — what to build

Five thoughtful beats. In priority order.

### A1. Plate-rule unfurl (Recent Work + Journal)

**Where:** `.recent-work__plate-rule` (28px hairline between "Plate I" and the meta-text), `.recent-work__couple-row` rules, `.journal__plate-rule`.

**What:** As each `<figcaption class="recent-work__caption">` enters the viewport, animate the small hairline from `scaleX(0)` to `scaleX(1)` with `transform-origin: left center`. Driven from the caption block's reveal — not a separate trigger.

**Why:** This is the "gallery docent hanging the wall label" beat. It tells the eye to look at the photograph first and the label second, in that order, like reading the brass nameplate after admiring the painting. Today the rule just exists; animating it gives the caption an intentional moment of arrival.

**Spec:**
- Duration: 600ms
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)` (var(--ease-gallery) — the site's gallery curve)
- Trigger: ScrollTrigger `start: 'top 78%'`, `once: true`
- Stagger across siblings: 80ms between plate-rule and couple-row rule (if both present)
- Reduced motion: skip — render at scaleX(1).

### A2. Image clip-path entrance reveal (Signature Style pair, Recent Work plates, Journal posts)

**Where:** `.gallery-frame.hover-zoom` wrappers around the editorial photograph blocks (lines 272, 286, 353, 388, 417 in `index.astro`), and `.journal__frame` (line 753 area).

**What:** On first scroll into view, reveal each image via `clip-path: inset(0 0 100% 0)` → `inset(0 0 0 0)`. The image is unveiled bottom-edge-up like a curtain rising.

**Why:** These photographs are the site's emotional payload. Right now they appear via the same opacity+translateY treatment used on every paragraph. A clip-path reveal differentiates them as "the work" vs "the words around the work" — a structural distinction that Aman and Loewe both use. Bottom-up (vs top-down) feels like a print developing on the page, which fits the photographer/film-grain brand.

**Spec:**
- Duration: 900ms (slower than UI; this is content-grade)
- Easing: `cubic-bezier(0.77, 0, 0.175, 1)` (strong ease-in-out — natural unveil)
- Trigger: ScrollTrigger `start: 'top 85%'`, `once: true`
- Replaces the .reveal opacity/translate on these specific elements (not adds — replaces, to avoid double-animation)
- Pair with a sibling `transform: scale(1.04) → scale(1.0)` on the inner `<img>` over the same 900ms to give the reveal subtle depth (so the image isn't a flat wipe — it settles)
- Reduced motion: skip clip-path; render fully visible.

### A3. Eyebrow → label → rule choreography

**Where:** Every `<p class="text-label-md ... eyebrow-rule">` above an H2 (Quiet moments, Recent Work, Questions, The Journal sections).

**What:** Today the eyebrow text and its 40px underline rule appear simultaneously when `.reveal` fires. Stage them: eyebrow text fades up first (0ms), 80ms later the rule draws from `width: 0` to `40px`, then the H2's char-reveal kicks off.

**Why:** Order conveys hierarchy. "Recent Work" is the category, the rule is the punctuation that ends the category, then "Stories from the last few months." is the statement. Reading order is also viewing order. This is a 200ms total elaboration — a barely-conscious cue that says "this section is starting now."

**Spec:**
- Eyebrow label: 500ms fade+translateY(6px → 0), ease-out, t=0
- Rule: 400ms width 0 → 40px, var(--ease-gallery), t=+0.08s
- H2 char-reveal: already wired via `[data-gsap-chars]`, fires at its own ScrollTrigger threshold (top 82%). No change.
- Reduced motion: skip; render fully visible.

### A4. Contact CTA "rule → link → rule" reveal

**Where:** `.contact-cta__actions` — the hairline-wrapped "Get in touch" anchor at the cinematic close.

**What:** Right now the entire `.contact-cta__actions` block reveals as one `.reveal`. Choreograph it: left rule draws in from center, "Get in touch" types in (or fades in with a 6px translateY), right rule draws in from center. Total ~900ms.

**Why:** This is the closing title card. It deserves its own beat. A bracketed reveal (rules expanding from the link outward) gives it the cadence of a film end-card — which is exactly the metaphor CLAUDE.md frames the section with ("cinematic close, reads as a closing title card").

**Spec:**
- Left rule: 600ms scaleX(0) → scaleX(1), transform-origin: right, t=0
- Link "Get in touch": 500ms opacity 0 → 1 + translateY(6px → 0), ease-out, t=0.15s
- Right rule: 600ms scaleX(0) → scaleX(1), transform-origin: left, t=0.3s
- Trigger: ScrollTrigger `start: 'top 75%'`, `once: true`
- Easing: var(--ease-gallery) on rules
- Reduced motion: 400ms opacity-only fade on whole block.

### A5. Video grade lift on contact-cta enter

**Where:** `<video data-autoplay>` background on the contact-cta section.

**What:** When the contact-cta section enters the viewport, transition the video's CSS `filter` from `saturate(0.75) brightness(0.92)` → `saturate(1) brightness(1)` over 1.4s. Like a film roll warming into color.

**Why:** The video is the primary visual mood of the closing section. Right now it just plays. Letting it "come into color" as the user scrolls down sells the cinematic-close framing without any motion — just tonal arrival. This is the kind of detail nobody notices consciously, which is exactly the point.

**Spec:**
- Duration: 1400ms
- Easing: `ease-out`
- Trigger: ScrollTrigger `start: 'top 80%'`, `once: true`
- GPU-cheap (filter on a single element). Don't add blur — Safari pays for that.
- Reduced motion: skip — render at saturate(1) immediately.

---

## REFINEMENTS — existing animations to tighten

Per Emil's "fast where the system is responding" rule. Today several hover micro-states use `var(--duration-hover) = 500ms`. That works for the slow gallery-walk feel of image hover-zooms (intentionally slow — leave alone). But arrow translates and color shifts on text links should feel like the system is *responding*, not posing.

| Before | After | Why |
| --- | --- | --- |
| `.recent-work__view:hover span { transition: transform var(--duration-hover) }` (500ms) | `transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1)` | Arrow nudge on a text link is feedback, not atmosphere. 500ms feels sluggish; 220ms feels responsive without breaking the gallery vibe. |
| `.recent-work__view:hover { color: ... transition: color var(--duration-hover) }` (500ms) | `transition: color 220ms ease-out` | Same — color shift on hover is response, not mood. |
| `.recent-work__runfoot-link:hover span` (500ms translateX) | `transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1)` | Same rule. |
| `.contact-cta__link:hover span` (500ms translateX) | `transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1)` | Same rule. |
| `.journal__cta:hover span` (500ms translateX) | `transition: transform 220ms cubic-bezier(0.22, 1, 0.36, 1)` | Same rule. |
| Hero "Contact me" button has no `:active` state | Add `transform: scale(0.97)` on `:active`, `transition: transform 140ms ease-out` | Buttons must feel pressed. Emil's #1 button rule. The hover bg-invert is fine; press-down is missing. |
| `.magnetic` uses CSS `transition: transform 0.6s` driven from mousemove events | Replace transition with `gsap.quickTo(el, 'x', { duration: 0.4, ease: 'power3.out' })` and same for y | Mouse-tracking with a CSS transition lags one frame; `quickTo` interpolates per frame for smoother momentum. Subtle but visible on the hero CTA. |
| `.journal__img` `transition: transform 2.5s var(--ease-gallery)` on hover scale(1.02) | Leave as-is | This is content-grade hover (the photograph). Slow is on-brand. Confirmed not a refinement target. |
| `.gallery-frame.hover-zoom` 2.5s scale(1.04) | Leave as-is | Same — slow is intentional per CLAUDE.md "Slow everything down." |
| `.scroll-rail::after` `rail-fall` 2.8s linear-ish infinite | Leave as-is | Earns its keep as the scroll cue. Already calm. |
| `.breaker-marquee__track` 55s linear infinite | Leave as-is | Different axis, different rhythm, already restrained. Optional polish: pause on hover (220ms ease-out to zero velocity) so a curious reader can stop and read a destination name. Defer to A6 if Akash wants it. |

### A6 (optional) Marquee hover-pause

**Where:** `.breaker-marquee__track`

**What:** On hover of the section, smoothly ease the animation-play-state to paused (or use a transform-rate variable that gsap eases from 1 → 0). On mouseleave, ease back to 1.

**Why:** Lets a reader who notices a destination name actually stop and read it. Subtle invitation to interaction without changing the marquee's normal rhythm. Skip if it complicates implementation — this is the lowest-priority item.

---

## DO NOT TOUCH

These are deliberately slow / deliberately present and are part of the brand:

- 2.5s `hover-zoom` on photographs — gallery pacing.
- Char-by-char hero tagline entrance — earns its place via the "Moments fade." → fades → "Memories don't." stays content beat.
- Pinned ken-burns hero scrub — already calm at scale 1.12.
- 600ms `.reveal` baseline opacity+translate — works as the page's default cadence.
- `eyebrow-rule` 40px hairline — keep, but stage it (see A3).

---

## REDUCED MOTION

`@media (prefers-reduced-motion: reduce)` must:

- Skip A2 clip-path reveal → render images visible.
- Skip A1 plate-rule unfurl → render at scaleX(1).
- Skip A4 contact-CTA bracket reveal → 400ms opacity fade only.
- Skip A5 video grade lift → render at saturate(1) immediately.
- A3 eyebrow choreography → render label + rule at final state without stagger.
- Leave all `.reveal` IntersectionObserver behavior alone (already handled by `scroll-reveal.ts:8-13`).

---

## PERFORMANCE NOTES

- All five A-items use only `transform`, `opacity`, `clip-path`, and `filter`. No layout properties.
- All five fire **once** per element via ScrollTrigger `{ once: true }` — no scrubbed timelines, no continuous listeners.
- A2's clip-path is more expensive than opacity but well within budget for one-shot reveals. Don't apply it to lists (e.g., don't put clip-path on every journal post — only the two `.journal__frame` items, which is fine).
- A5's filter transition on `<video>` is GPU-cheap but Safari can be flaky with filter on video elements — test in Safari before shipping; if regressed, fall back to opacity 0.92 → 1.

---

## HANDOFF TO `gsap` SKILL

When the implementer picks this up:

1. **Read this brief in full** before writing any code.
2. **Site uses GSAP 3 + ScrollTrigger already** — `src/scripts/journey-timeline.ts` is the pattern reference for `gsap.matchMedia` + ScrollTrigger + Astro view-transition cleanup. Mirror that file's structure.
3. **All new motion goes in `src/scripts/homepage-motion.ts`**, imported once in `index.astro`'s existing `<script>` block at the bottom (don't create a parallel script tag). Wire into the existing `astro:page-load` / `astro:before-preparation` cleanup pattern at line 1234-1247.
4. **Use the site's existing CSS variables**: `--ease-gallery`, `--duration-hover`, `--duration-page`. Don't hard-code new easing tokens unless one of the five A-items truly needs `cubic-bezier(0.77, 0, 0.175, 1)` (only A2 does).
5. **Test order**: A1 (low risk) → A3 (low risk) → A4 (low risk) → A5 (Safari watch) → A2 (highest visual impact, replaces existing .reveal on some elements — most invasive). Ship in commits, not one mega-commit, so any regression is bisectable.
6. **Reduced-motion test**: Toggle `prefers-reduced-motion` in Chrome DevTools (Rendering panel) and verify every A-item degrades correctly.
7. **Mobile-first**: All five A-items should work or no-op gracefully on mobile. None should depend on desktop-only hover.
