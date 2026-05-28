# KashKlicks — Feature Gap Roadmap

**Date:** 2026-05-28. Source: grounded gap analysis (site inventory + vault ICP/positioning/sales-flow + wedding-industry & competitor research). Branch: `feat/funnel-features`.

## The read
Acquisition, consideration, and conversion *mechanics* are mature. The funnel is **lopsided**: **retention/referral is nearly absent** (the costliest gap given the local-couple pivot — LTV + referral compounding), and there are **two conversion blind spots** — *"Is my date open?"* and *"Are you vetted by anyone but yourself?"* (only 14 Google reviews, no phone/DM path, and the owner doesn't check email).

## ⚠️ Build-time gate (project rule — do NOT skip)
Every **new section/page** below is new visual design → route through the **`hallmark` skill** (and write a self-contained **design brief** first) BEFORE building. Do not freestyle inline. Respect Digital Curator hard rules: **0px radius, no gold/metallic, no em/en dashes in copy, no 1px section borders, mobile-first**. Reuse existing components/tokens.

## Already strong — do NOT rebuild
Transparent tiered pricing (12 packages + add-ons) · low-friction inquiry form → worker → Apps Script · ContactModal w/ package prefill · Calendly · 32-location SEO hub + 7 blog posts + 22 galleries · ~28 JSON-LD schema types · GoogleReviews block (5.0/14) · films/YouTube embeds · FAQ engine · GearStrip/JourneyTimeline · 2 paid LPs · ShareButton · FloatingPackagesLink.

---

## Tier 1 — cheap, high-impact, code-buildable (reuse existing assets)
1. **Now-booking scarcity line** *(trivial)* — "Now booking 2026 & 2027 weddings. I take a limited number each year." in hero + near pricing/CTAs. On-brand truth (solo/intimate), justifies the $1,400 floor.
2. **Date-first CTA** *(small)* — reframe primary CTA to "Check if your date is open"; surface the event-date field FIRST in ContactForm/ContactModal (today it's free-text buried in optional details). Reuses the worker pipe. Microcopy: "I take a limited number of weddings each year — let's check your date first."
3. **GTA-vs-overseas qualifier field** *(trivial)* — one required select on the inquiry form: "Where will your ceremony be? (Toronto/GTA · Elsewhere in Ontario · Overseas)", passed through the hidden-field plumbing to the Inquiries sheet. This is the vault's north-star qualifier for the local pivot — without it the pivot is unmeasurable at inquiry.
4. **WhatsApp / IG-DM click-to-chat** *(small)* — mobile-first "DM to check your date" button: `wa.me` click-to-chat + IG deep-link, pre-filled to ask date+venue+email. Mobile-dominant + IG is the channel + owner doesn't check email. (No published phone line required.)
5. **Multi-platform review strip** *(small)* — "Reviewed on" strip near Inquire CTAs (Google now; WeddingWire.ca + The Knot once profiles are claimed — see ops items). Reuses the `GoogleReviews` component pattern + `google-reviews.json`.

## Tier 2 — consideration polish (medium, code-buildable)
6. **Productize photo+film wedding bundle** in `packages.json` as a buyable line item (currently buried in an FAQ; it's the defended whitespace). Reuses PricingCard/PackageAddOns.
7. **Side-by-side package comparison table** of the 3 wedding tiers (hours/images/engagement-included/second-shooter/delivery). Reuses `packages.json`.
8. **"How you'll receive your photos" block** on /services + wedding/pre-wedding — branded Pixieset gallery, 24-48h sneak peeks, downloads, sharing. Reviews already praise this; market it.
9. **Credited "Creative Team / Who I love working with" page** — planners, venues, florists, MUAs, and the referred-out videographers. Turns photo-only-weddings into a vetted-network strength; earns reciprocal local backlinks.
10. **FAQ schema on the venue/location-guide pages** *(low-effort SEO)* — apply the existing `faq.json` + `JsonLd` pattern to the 32 location guides (flagged as the biggest schema miss).

## Tier 3 — bigger / needs external setup
11. **Deposit/retainer + contract step** (Stripe link minimum) — act on the refundable $1,400 "try-me" at the consult's emotional peak.
12. **Gated Investment & Planning Guide PDF** (email opt-in; KEEP public "from $X" pricing) — captures shortlisting couples; consult leave-behind.
13. **Email nurture engine (ESP)** on every lead — instant confirmation + 3-email welcome + seasonal "now booking 2027". Protects leads the owner can't manually chase.

## Ops / off-site (not code — owner action, but they feed the on-site features)
- Claim **WeddingWire.ca + The Knot** vendor profiles (free) → feed the review strip (#5) + new lead source.
- **Post-delivery review-request flow** (timed to Pixieset hand-off) → fixes the ~2 reviews/month SEO target.
- **Anniversary / repeat-occasion loop** → recycles won weddings into engagement/anniversary/family (cross-sell `/services/celebrations`).
- **Referral program** for booked couples (print/album credit or anniversary mini).

## ❌ Do NOT build
**Live auto-updating Instagram feed embed** — hurts Core Web Vitals on the fast Astro site for near-zero conversion lift, clashes with the editorial brand. If freshness is wanted: a static curated grid or a "Follow on Instagram" link.

## Suggested build order (this branch)
Start with the **Tier 1 conversion bundle (#1–#3)** — ~1-2h, reuses everything, directly serves the local pivot — then #4–#5, then Tier 2 as appetite allows. Each new section → hallmark/design-brief first.
