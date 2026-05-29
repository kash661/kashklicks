# Design Brief — Wedding Package Comparison Table (Tier 2 #7)

**Date:** 2026-05-28 · **Branch:** `feat/funnel-features` · **Source:** `docs/feature-roadmap.md` #7
**Gate:** New visual section → brief + `hallmark` before building. Same locked Digital Curator system (stone/taupe, Cormorant + Inter, 0px radius, no gold/metallic, no em/en dashes, sans for informational text, solo voice, weddings = photo only).

## Intent
Three wedding tiers (`The Essentials` $1,400 · `The Full Day` $2,500/$2,300 · `The Complete Story` $3,800) are presented today as three separate `PricingCard`s. Couples comparing tiers have to scan three cards and mentally diff them. A compact side-by-side **comparison table** makes the upgrade logic legible at a glance and supports the booking decision. This is consideration-stage polish, not a new pricing source.

## Honest data (from packages.json — do NOT invent)
All values are real structured fields already in `packages.json`:

| Row | The Essentials | The Full Day | The Complete Story |
|---|---|---|---|
| Coverage | Up to 6 hours | Up to 10 hours | Up to 14 hours |
| Edited photos | Unlimited (200+) | Unlimited (400+) | Unlimited (600+) |
| Engagement session | Included | Included | Included |
| Starting price | $1,400 | $2,300 (was $2,500) | $3,800 |

- **No "film" row.** All three tiers are `film: false` — weddings are photo only (brand rule). Do not add a film/video row.
- `The Full Day` is `popular: true` — mark it as the recommended column.
- Engagement session is included on all three (a genuine shared value, not a differentiator — still worth showing because couples ask).
- Add-ons (second photographer +$100/hr, instax, priority delivery) are shared add-ons, NOT tier differentiators → keep them in the existing `PackageAddOns` block, not the comparison table.

## Constraints / reuse
- Pull all values from `packages.json` (single source). Do not hardcode.
- Sans for all table text (informational). Tier names may use the serif if they read as headings, but keep restrained.
- 0px radius, no 1px box-borders around the whole table (use hairline row rules + space, per Digital Curator "no 1px solid borders to section content" — row separators via `color-mix` hairlines like the existing `.investment-mobile__list` pattern are fine).
- Mobile-first: a 3-column table must NOT cause horizontal scroll at 320px. Decide the mobile pattern (stacked per-tier, or a horizontally-scannable compact grid, or row-labels + 3 value columns that shrink). Hallmark to choose the mobile collapse.
- Reuse the `service-sale`/eyebrow type registers; align with the existing wedding page rhythm.

## Placement
On `/services/wedding` (`services/wedding.astro`), inside the `#packages` section, **above the existing `pricing-grid`** (table as the at-a-glance overview, then the detailed cards below) OR directly below the cards as a "compare tiers" summary — hallmark to choose which order reads better. Must not disrupt the existing `BookingNote` scarcity line or the below-packages CTA.

## Open questions for hallmark
1. Mobile collapse pattern for a 3-tier table at 320px (no horizontal scroll).
2. Table above the cards (overview-first) vs below (compare-after-detail)?
3. How to mark `The Full Day` as recommended without a loud badge (editorial restraint).
4. Whether engagement-session "Included × 3" earns a row or reads as filler.

## Acceptance
- Values match packages.json exactly; no fabricated rows; no film row.
- 320/390/768/1280 clean, no horizontal scroll. 0px radius, no full-box border, sans, no dashes.
- `pnpm build` clean; `pnpm test` 10/10.
