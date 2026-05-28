# Design Brief — IG Click-to-Chat (#4) + Multi-Platform Review Strip (#5)

**Date:** 2026-05-28 · **Branch:** `feat/funnel-features` · **Source:** `docs/feature-roadmap.md` (#4–#5)
**Gate:** New visual elements → brief + `hallmark` before building. Same locked Digital Curator system as the Tier 1 bundle (see `2026-05-28-tier1-conversion-bundle-brief.md`); this brief covers only the two new components.

---

## Hard constraint from the owner (decisive)
**No phone number, no WhatsApp. Instagram DM only.** Akash explicitly does not want a phone number exposed (bot/spam risk). A `wa.me` link requires a real number, so WhatsApp is dropped entirely. This also matches the vault: Akash does not check email and runs his CRM off the `forms` skill; Instagram is already labelled "fastest reply" in the `/contact` Studio Notes.

## Honest-copy constraint
- The Google numbers (5.0 / 14) are real and live in `src/data/google-reviews.json` — single source of truth, do not duplicate.
- WeddingWire.ca and The Knot profiles are **not claimed yet** (owner ops item). Do **not** fabricate ratings/counts for them. The review strip renders only platforms that are real + enabled; the others stay disabled (no numbers) until claimed.

## Brand + design constraints (unchanged)
0px radius · no gold/metallic · **no em/en dashes** · sans for all informational text · solo first-person voice · weddings = photo only · reuse existing tokens + component language. Mobile-first.

---

## #4 — Instagram click-to-chat (`InstagramChat.astro`)

**Intent:** give mobile, IG-native couples a one-tap "DM to check your date" path that reaches Akash faster than the form (he checks IG, not email).

- **Link target:** `https://ig.me/m/kash.klicks` — Instagram's official "send message" deep link (opens IG Direct in-app on mobile, IG web DM on desktop). This is the IG analogue of `wa.me`. Username derived from `site.social.instagramHandle` (`@kash.klicks` → strip `@`). Open in a new tab, `rel="noopener noreferrer"`.
- **Note on prefill:** IG has no reliable pre-filled-DM URL param. The microcopy tells couples what to send instead: their date, venue, and email.
- **Copy:**
  - Label / button: `Message me on Instagram`
  - Microcopy: `Send me your date, venue, and email. I reply fastest here.` (no dash, solo voice.)
- **Treatment:** Instagram glyph (inline SVG, monochrome `currentColor` so it inherits the stone palette — NOT the IG gradient, which would read as off-brand metallic/loud) + label + microcopy. Quiet, editorial, sans. 0px radius. Reuse the existing link-with-arrow hover idiom or the `.service-sale`-adjacent register. Hallmark to choose button vs text-link weight.
- **Placements (2):**
  1. **`/contact` form column secondary path** (lines ~249–261): today it offers only "Or speak with AD directly → Book a 30-min consultation" (Calendly). Add the IG-DM path here, **first** (fastest reply), with the Calendly call as the second option.
  2. **`ContactModal` footer** (after `<ContactForm />` in the modal body): service-page inquiry surface has no fast channel today. Add the IG-DM affordance at the bottom of the modal body so modal users get the same fast path. (Do NOT add it inside `ContactForm.astro` itself — that would triple it on `/contact`, which already shows IG in Studio Notes.)

## #5 — Multi-platform review strip (`ReviewStrip.astro`)

**Intent:** a compact "Reviewed on" proof strip at the inquiry conversion point (the full `GoogleReviews` section lives only on the homepage; `/contact` has no review proof near the form).

- **Data:** Google entry built from `google-reviews.json` `aggregate` (rating, count, profileUrl) — single-sourced, never duplicated. Additional platforms (WeddingWire, The Knot) declared in the component as a disabled list (`enabled: false`, no numbers) so they render nothing until Akash claims them and fills real values. Renders only enabled platforms (currently Google alone).
- **Layout:** one horizontal strip: a small `REVIEWED ON` label, then per enabled platform a linked unit: platform glyph + score + 5 stars + `· N reviews`, linking to the platform profile (new tab). Reuse the Google logo SVG + gold-star SVG already in `GoogleReviews.astro` (stars are `#f9ab00` — that's the established review-star colour in the existing section, not a brand gold accent; keep for platform-authentic consistency). Sans, on-surface, 0px radius. Wraps cleanly on mobile.
- **Single-platform honesty:** with only Google live, the label stays `Reviewed on` (not "Reviewed across platforms"). Reads as a real, modest proof unit, not an inflated one.
- **Placement (1):** **`/contact` form column**, just above the form (after the "Begin the inquiry." heading + deck, before `<ContactForm />`), so proof sits immediately before the fill. (Service-page placement deferred to avoid crowding the below-packages CTA, which already stacks the scarcity line + 24h line + button.)

## Out of scope
- Homepage (full `GoogleReviews` section already there — no strip).
- Service-page review strip (fast follow).
- WeddingWire/Knot data (owner must claim profiles first).

## Acceptance
- 390px + 1280px clean; no horizontal scroll; modal stays usable with the IG addition.
- IG glyph monochrome (inherits stone palette), not the IG gradient. 0px radius. Zero dashes. Sans informational text. Solo voice.
- ReviewStrip shows only Google (real 5.0 / 14); no fabricated platform numbers.
- `pnpm build` clean; `pnpm test` 10/10.
