# Design Brief — "How You'll Receive Your Photos" Block (Tier 2 #8)

**Date:** 2026-05-28 · **Branch:** `feat/funnel-features` · **Source:** `docs/feature-roadmap.md` #8
**Gate:** New visual section → brief + `hallmark` before building. Locked Digital Curator system (stone/taupe, Cormorant + Inter, 0px radius, no gold/metallic, no em/en dashes, sans for informational text, solo voice, weddings = photo only).

## Intent
Couples worry "when and how do we actually get our photos?" The delivery experience is already a strength — reviews specifically praise it ("easy to use online gallery", "delivery of edited images was in good timing", "uses an online platform... which keeps the quality high"). It's currently buried in FAQ answers and package highlights. Surface it as a short, reassuring block on the service pages so the after-the-shoot experience is visible at the consideration stage.

## Honest content (from real sources — packages.json, faq.json, reviews; do NOT invent)
- **Sneak peek within days** — a curated preview lands within days of the shoot, while the full gallery is edited.
- **A private online gallery** — high-resolution, downloadable, easy to share with family and friends. (Reviews call it "easy to use" and quality-preserving. Do NOT name the SaaS vendor on the page — keep it editorial; "private online gallery" is enough.)
- **Full gallery in 2 to 3 months** — every edited image, delivered. (Priority 2 to 3 week delivery is available as a paid add-on — mention only if it fits; it's in the packages.)
- **Yours to keep** — download everything and keep it; the gallery is yours.

Weddings are photo only — no "video/film" in this block on the wedding page. (Pre-wedding may reference film since film is offered there, but keep this block photo-focused for consistency unless it reads naturally.)

## Constraints / reuse
- Sans for all informational text; serif only for an emotional heading if used.
- 0px radius, no full-box borders, no gold. Hairlines + space for separation.
- Reuse an existing step/explainer pattern rather than inventing one: candidates are the `JourneyTimeline` step rhythm (service pages) or the `WhatHappensNext` 3-step explainer (`/contact`) or the location-guide "Essentials" numbered-row pattern. Hallmark to pick the closest existing pattern so this reads as part of the system, not a new component language.
- Mobile-first; clean at 320/390/768/1280, no horizontal scroll.

## Placement
On the detailed service pages named in the roadmap: **`/services/wedding`** and **`/services/pre-wedding`** (and optionally `/services` index). Sensible slot: after the packages/journey, near the lower CTA, OR as a reassurance band between the pricing and the final CTA. Hallmark to choose placement that doesn't crowd the existing JourneyTimeline (which already explains the booking-to-delivery process — make sure this delivery block doesn't duplicate the JourneyTimeline's later steps; if it would, fold/trim rather than repeat).

## Open questions for hallmark
1. Which existing pattern to reuse (JourneyTimeline step / WhatHappensNext / Essentials numbered rows) so it's not a new component voice.
2. Placement on wedding/pre-wedding without duplicating JourneyTimeline's "Sneak Peek / Full Delivery" steps (those exist on the wedding page already — does this block belong only where there's no JourneyTimeline, or does it replace/condense those steps?).
3. 3 steps vs 4 (is "Yours to keep" a distinct step or a closing line?).

## Acceptance
- Content matches real delivery facts; no fabricated timelines; no vendor name; no film on the wedding page.
- Reuses an existing pattern; 0px radius, no full-box border, sans, no dashes.
- Does not duplicate the JourneyTimeline delivery steps on the wedding page.
- 320/390/768/1280 clean; `pnpm build` clean; `pnpm test` 10/10.
