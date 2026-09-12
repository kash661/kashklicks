# Design brief: pricing configurator at /pricing/

Self-contained brief. Written before any markup, per the roadmap gate.

```
Hallmark · macrostructure: Workbench · genre: editorial
theme: locked (Digital Curator, defers to .claude/CLAUDE.md)
enrichment: none (typography only) · motion: 2 primitives
system-managed project: diversification is inverted, the page shares the system
differs from last 3 log entries: coming-soon teaser, portfolio-category, service-page
```

Audience: couples arriving from an Instagram ad or a DM link, who have asked nothing yet.
Use case: one action, book a call with a priced package already chosen.
Tone: editorial, plain spoken, quiet. The page is a tool, not a brochure.

## What this page is

A guided questionnaire that walks a couple from "what are you planning?" to a priced, customised
package and a booked call. It exists to kill the four questions every ad produces: what are your
packages, what does it cost, what are the locations, do you do video.

It is **not** a landing page. The editorial LPs stay work-first with pricing hidden. This is the
destination people arrive at when they are ready to configure, from an ad, a DM link, or the nav.

## The one number that governs every decision

75 paid Instagram sessions produced 0 leads, and the form's position on the page was the suspect.
So: **no field appears until step 5, and identity is not asked until step 7.** Steps 1 to 4 are
entirely anonymous. Every screen must feel like it is giving, not taking.

## Structure

Seven steps, one screen each, forward and back. Steps 1 to 4 free, 5 asks date and location,
6 asks one open question, 7 asks identity then hands off to Calendly.

Each step must narrow the packages or change the price. Nothing else earns a screen.

## Typography

The site rule is typography by intent, and it names pricing as informational. Two shipped components
contradict it by rendering prices in serif display italic (`InvestmentSection.astro`,
`.pricing-card__price` in `global.css:1290`).

**Resolution.** The live-updating total is a functional readout that changes under the reader's
thumb, so it is **sans, with `font-variant-numeric: tabular-nums`** so digits do not reflow as the
number moves. Existing package cards keep their serif price and are not touched. No new font
weights: the Noir et Blanc licence is still pending.

| Element | Class / treatment |
|---|---|
| The step question | `text-display-md`, serif. This is the emotional line. |
| Option labels | `text-body-lg`, sans |
| Supporting hint under a question | `text-body-md text-on-surface-variant` |
| Step marker | plain sans text, "3 of 7", sitting **beside the back link**, never as an all-caps kicker above the heading. See the eyebrow note below. |
| Package name on the recommendation | `text-heading-lg`, serif |
| Running total | sans, `tabular-nums`, weight 500, no italic |
| Add-on label + price | `text-body-md`, sans |
| Permit and pass-through notes | `text-label-sm text-on-surface-muted` |

### No eyebrows on this page

The project CLAUDE.md documents `eyebrow-rule` as a signature editorial pattern, but the standing
instruction is no eyebrow kickers and no accent bars, and the anti-slop rule is that section tags
default to off. A caps label stacked above a heading is the most recognisable templated-editorial
tell there is, and the tag-left / heading-right variant is banned outright.

So: **no eyebrows anywhere on this page.** Wayfinding is carried by a plain "3 of 7" next to the
back link and a hairline progress rule. The question itself is the only thing above the options.

## Layout, desktop (md and up)

Asymmetric, never centred. Cards never a plain 3-up grid.

- Steps 1 to 3: question and hint on columns 1 to 5, options on 7 to 12. Options are a 2-up grid
  with **uneven column widths** so it does not read as a template.
- Step 4: add-on list on columns 1 to 7, running total **sticky** on 9 to 12. This is the one place
  the layout earns its asymmetry functionally, since the total must stay in view while they choose.
- Steps 5 to 7: label column 1 to 4, field column 6 to 12.

## Layout, mobile (below md)

A **separate DOM tree** with its own `pricing-mobile__*` namespace. Never shares a responsive
utility with the desktop tree. Mobile dominates this traffic, so it is authored first.

Verified at **320, 375, 414 and 768px**, not just 375. Hard floor: no horizontal scroll, no
clickable label wrapping to two lines, `overflow-x: clip` on `html` and `body` (never `hidden`),
and long words in the question headings wrap via `overflow-wrap: anywhere; min-width: 0`.

- Single column, full-bleed tappable rows rather than cards. Minimum 44px touch target.
- Running total pinned to the bottom of the viewport as a **square-edged bar**, not a floating pill.
  It shows the total and the primary action. It must never cover the last option in the list, so the
  scroll container carries bottom padding equal to the bar height.
- The step question stays visible on scroll as a slim header; the option list scrolls under it.

## Measure

Question text uses `.measure-tight`. Body and hints cap at 46ch. Add-on rows may run wider since
they are scannable list items, not prose.

## Two package cases the layout must handle

- **Make It Yours** (`custom-package`, `price: null`). No number to show and nothing to total.
  It renders as a "let us build it together" row that skips the add-on step and goes straight to
  the questions box. It must always stay reachable, as the escape hatch for anyone the branch
  fails.
- **The Hourly** (`celebrations-hourly`, `priceIsRate: true`). Its 100 is a rate, not a total.
  It reads "from $100 per hour" and asks how many hours, then totals from that. It must never
  render as a $100 package.

## Colour and surfaces

Tokens only, from `global.css` `@theme`. Adjacent sections must not share a background, and the
footer is `surface-dark`, so the last section of this page cannot be. Sequence:
`background` → `surface-dim` → `background` → `surface` → `background`.

Selected state is a **surface shift plus a filled marker**, never a coloured border, because 1px
borders are banned for separating content and colour alone fails contrast checks.

## Motion

**Two primitives, no more.** `--ease-gallery`, 600ms minimum.

1. Step change: the existing `reveal` / `stagger-*` primitives.
2. Total change: opacity only. No rise, no bounce, no count-up.

Hover and focus are states, not primitives. Everything is disabled under
`prefers-reduced-motion: reduce`, including the total. Only `transform` and `opacity` animate.

## State ladder, every interactive element

Specified in full because hover is enhancement only and must never carry function.

| Element | Rest | Hover | Focus visible | Pressed | Selected | Disabled |
|---|---|---|---|---|---|---|
| Category card | `surface`, label + hairline | background lifts to `surface-dim` | 2px `on-surface` outline, 2px offset | background `surface-container`, no transform | `surface-container` + filled square marker + label weight 500 | n/a |
| Add-on toggle row | transparent | `surface-dim` | 2px outline, offset 2 | `surface-container` | filled square marker, price emphasised | muted text, marker hollow, `aria-disabled` |
| Stepper minus / plus | square, `on-surface` glyph | glyph to `primary-hover` | 2px outline | glyph shifts 1px | n/a | 30% opacity, not focusable at bounds |
| Primary action | `surface-dark` bg, `on-dark` text | background `on-surface` | 2px outline, offset 2 | 1px downward shift | n/a | 40% opacity, `aria-disabled`, cursor default |
| Text input | `surface`, bottom hairline | hairline darkens | 2px outline, offset 2 | n/a | n/a | muted |
| Back link | `on-surface-variant` | `on-surface` | 2px outline | n/a | n/a | hidden on step 1 |

**The two states the first draft of this brief missed.** Every interactive element ships all eight.

| Element | Loading | Error | Success |
|---|---|---|---|
| Primary action | label becomes "Sending", `aria-busy`, disabled | label returns, message below names the problem | step advances, no celebratory toast |
| Email field | n/a | hairline and helper text shift to `--color-error`, message says what to fix, focus moves to the field | hairline returns to rest, no green tick |
| Date field | n/a | same as email | same as email |
| Final submit | as primary action | copy points them at Instagram, matching the existing engagement form's failure path | the Calendly step, which is the success state |

Silent success throughout. No toasts, no checkmark animations. Errors name the fix, never blame.

## Accessibility

- The whole flow is operable by keyboard alone. Options are real `<button>` or `<input>` elements,
  never divs with click handlers.
- Each step is a `<fieldset>` with a `<legend>` carrying the question.
- Step changes move focus to the new step heading and announce via a polite live region.
- The running total is an `aria-live="polite"` region so a change is announced once, not per keystroke.
- Contrast: every selected state carries a non-colour cue.

## No JavaScript

The page must not be a blank state. With scripts off it renders, in plain order: all six categories,
every package with its price and inclusions, the full add-on list with prices, and a link to
`/contact/`. The steps are just stacked sections. This is the progressive-enhancement baseline and
it doubles as the SEO and AI-crawler surface for cost queries.

## Copy rules

No dashes or hyphens anywhere in customer-facing text. No eyebrow kicker above the page title and no
accent bars. Weddings never read "photo and film": every listed wedding price is photography, and
film is quoted separately with no number. Prices ending in `.25` are deliberate; computed totals
will not end in `.25` and that is correct.

## What the page must never do

- Round a corner.
- Use gold or any metallic.
- Put a price in serif on the running total.
- Ask for identity before step 7.
- Show `celebrations-hourly`'s $100 as a package total. It is a rate.
- Put a number next to wedding film.
- Add a JS framework. This stays vanilla script like the rest of the site.
