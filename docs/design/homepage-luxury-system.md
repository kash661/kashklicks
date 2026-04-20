# Homepage Luxury System — Handoff

Short doc covering the quiet-luxury design pass applied to `src/pages/index.astro` and its section components. Use this to resume work or explain decisions to a new collaborator.

## Branches & status

- **`main`** — contains the Recent Work redesign (PR #3, commit `84fd5bd`). Cream background, gallery-plaque hairline under each photo.
- **`claude/homepage-luxury-pass`** — open feature branch, commit `f43e493`. Extends the same system to The Kit (desktop + mobile), Journal, Contact CTA, and Investment. **Not yet merged to main.** Build is green.

To preview locally:
```bash
git fetch origin
git checkout claude/homepage-luxury-pass
pnpm dev
```

## Design vocabulary ("the system")

Applied consistently across every section touched. Treat this as the contract for future homepage edits.

### Palette — already in brand tokens, do not change
- Background: `var(--color-surface-dim)` (`#f4f4f0`) for section insets, `var(--color-background)` (`#faf9f6`) for body cream.
- Text: `var(--color-on-surface)` primary, `var(--color-on-surface-variant)` secondary, `var(--color-on-surface-muted)` tertiary.
- Accent hairline: `color-mix(in srgb, var(--color-on-surface-variant) 42–55%, transparent)` — warm champagne tone on cream.
- Reserved: `var(--color-surface-dark)` used only in the Hero and Contact CTA (tonal bookends), not inside the cream body.

### Typography
- Display / emotional: serif (`var(--font-serif)`), italic for expressive moments (decks, section titles on dark, couple names' ampersand).
- Meta / labels: sans-serif, `0.6875rem`, letter-spacing `0.22em`, uppercase.
- "Plate" mark: italic serif, `1rem`, mixed-case — small but recognizable.

### The "gallery plaque" pattern (reuse this verbatim)
Every photograph in a section follows this:

1. Photograph, flush-rendered — **no shadow, no border, no rounded corners**, no overlay chrome.
2. Caption block `margin-top: 1.5rem; padding-top: 1.25rem; border-top: 1px solid <hairline>;` — one hairline only.
3. First row inside the caption: "plate line" — `<italic serif plate label>` + 1.75rem hairline rule + sans-caps meta text.
4. Second row: the story's own payload (couple name, role heading, post title).

Section-level hairlines: a single soft horizontal fade at `::before` (top) and `::after` (bottom) of each section, gradient-masked at both ends so they don't touch the section corners.

### What not to do (design anti-patterns to reject on future PRs)
- No drop shadows on images. Ever. Luxury photo sites are flat. Shadows turn photos into "cards."
- No oversized outlined or stroked display numerals (`01`, `02`). The previous `recent-work__numeral` and `gear-row__num` were stripped for this reason.
- No decorative grid background lines, corner crop-ticks, Roman folio numbers, ornament glyphs (✦ ❖), or running-head / running-foot chrome.
- No stacked hairlines (a `border-top` plus a `::before` pseudo-rule immediately above). One hairline per job.
- No infinite pulse / breath animations on meta dots. Static at reduced opacity is the move.
- No solid-block CTA buttons on image backgrounds. Use hairline-flanked or underlined links.

## Sections — current state

| # | Section | File | State |
|---|---|---|---|
| 1 | Hero | `src/pages/index.astro` | Untouched. Video hero with dark overlay — intentional dramatic opener, the one cinematic moment. |
| 2 | Signature Style pair | `src/pages/index.astro` | Already matched the system before this pass. No edits. |
| — | The Kit (desktop) | `src/components/global/GearBreaker.astro` | **Reworked** on `claude/homepage-luxury-pass`. Cream stock, plaque hairline, numerals retired. |
| — | The Kit (mobile) | `src/components/global/MobileGearBreaker.astro` | **Reworked** on same branch. Sticky-card stack preserved; cream + plaque applied. |
| 3 | Investment | `src/components/global/InvestmentSection.astro` | **Polished**: pulse animation on `.service-sale-dot` retired (changed in `src/styles/global.css`). |
| 4 | Testimonial | `src/pages/index.astro` | Untouched. Already minimal. |
| 5 | Recent Work | `src/pages/index.astro` | **Merged to main** (PR #3). Reference implementation of the system. |
| — | "Where I've Shot" marquee | `src/pages/index.astro` | Untouched. Already minimal. |
| 6 | FAQ | `src/pages/index.astro` | Untouched. Already minimal. |
| 7 | Journal | `src/pages/index.astro` | **Reworked** on `claude/homepage-luxury-pass`. Cards flattened, 2-col layout, plaque hairline under each cover, `Journal · {Month Year}` meta line. |
| 8 | Contact CTA | `src/pages/index.astro` | **Reworked** on same branch. Video kept as tonal bookend; overlay softened to 28–40% graduated scrim; solid white button replaced with hairline-flanked "Get in touch →" link; title now italic serif. |

## Known follow-ups / ideas parked

- If the photographs want even more elevation, the agreed-upon "print mat inset" (12–20px cream padding around each image before the hairline) was discussed but not implemented. It would give a matboard-behind-framed-print feel. Scoped for a future pass.
- The Hero's dark overlay wasn't touched — worth revisiting once the body pass is live, because the hero might feel disproportionately dramatic compared to the newly quieter middle of the page.
- No changes were made to portfolio subpages (`/portfolio/*`) or the services journey. Apply this system there before cross-linking if the goal is full-site consistency.

## Rationale shorthand for future decisions

> Restraint is the accent. Photographs are the hero. Lines frame, don't decorate. Warmth comes from palette + serif italic + generous breathing room — not from ornament or drama.

Referenced sites for the vocabulary: Aman Resorts, Loewe, The Row, Hermès editorial, Kinfolk, Magnum Photos, Jose Villa, Erich McVey, KT Merry.
