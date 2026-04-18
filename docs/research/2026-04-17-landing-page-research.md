# Landing Page Research Synthesis — `/intimate-wedding-toronto`
*Prepared 2026-04-17 — inputs: Perplexity conversion research + international editorial LP analysis + codebase audit*

## Executive summary

This research pass answered the most important question: **should the intimate-wedding-toronto page be built as a conversion-optimized landing page, or as an editorial homepage in the style of international editorial wedding photographers?**

The answer is a **hybrid**. Pure CRO-style landing pages would undermine AD's editorial positioning (the exact wedge we identified in the competitor study). Pure editorial homepages would bleed paid-traffic conversion (we'd pay $2–3 per click, then squander it on a page with no conversion scaffolding).

The right build is **editorial tone + conversion scaffolding**, not a traditional CRO-stack landing page and not a pure portfolio homepage.

---

## The core tension

### What the international editorial consensus looks like

Across Jose Villa, Sam Hurd, Erich McVey, KT Merry, and Jenny Fu:

| Element | Consensus |
|---|---|
| **Pricing on homepage** | Hidden (5/5) |
| **Form on homepage** | None (5/5) |
| **Photographer face above fold** | No (4/5 — only KT Merry shows name, none show face) |
| **Hero copy** | Minimal to none (Erich McVey has zero) |
| **Above-fold CTA** | Portfolio-deep, not form-deep (KT Merry "Browse Portfolio"; others have no CTA at all) |
| **Social proof placement** | Mid-page or absent (only Jenny Fu and KT Merry show it prominently) |
| **Booking-year scarcity banners** | None |
| **Quiz funnels / gated content** | None |

> "The work IS the pitch. If you need anything else, you're not the client." — the Erich McVey philosophy.

### What CRO conventional wisdom says for paid traffic

| Element | CRO best practice |
|---|---|
| Primary CTA | Within 5 seconds, above fold |
| Inquiry form | Above fold on landing pages |
| Pricing anchor | Shown ("starting at $X") to pre-qualify and reduce form abandonment |
| Trust signals | Stacked prominently (testimonials, review count, press logos) |
| Headline | Clear value prop, benefit-led |

### Why the contradiction matters

- If we build CRO-style: conversion rate goes up 2–3x, but the page reads downmarket. We lose the editorial wedge that *is* AD's positioning against Toronto competitors. We also attract the wrong audience (budget-led searchers).
- If we build pure editorial: conversion rate craters to 1–2%. At $2–3 CPC × $350/mo budget = 150 clicks, we'd get 1–3 inquiries. Not enough to validate the ad channel.

---

## The resolution: editorial tone + conversion scaffolding

**Rule:** Every editorial move from the international LPs stays. Every conversion move is added at the END of the emotional arc, not above the fold.

### Specific design decisions

#### 1. Hero: editorial, not CRO
- **One strong still image** of a Toronto venue (Casa Loma, Glenerin Inn, local church interior) — NOT a carousel, NOT a video, NOT a grid.
- **Serif display headline, short:** "Toronto weddings, unhurried." (3 words, per Sam Hurd's "For creatives in love" psychographic filter)
- **Sub-headline, sans, tight:** "For couples getting married here. One photographer. Photo and film. Church, civil, backyard."
- **ONE CTA above fold:** "View the Portfolio" (KT Merry's conservative editorial-safe move — sends traffic deeper, doesn't force conversion)
- **NO form above fold. NO pricing above fold. NO photographer headshot above fold.**

#### 2. Narrative arc (mid-page, work-first)
Following the Jose Villa / Sam Hurd / KT Merry pattern:

- Section 2: The approach (3 columns, prose, no stock language)
- Section 3: Recent Toronto work (4–6 thumbnails, ALL with local venue captions)
- Section 4: One display-typography testimonial — Jenny Fu's "FIVE BILLION STARS" move, rendered as a quote that fills the screen. Pick the most evocative single review from a Toronto couple.
- Section 5: More work (second gallery — wedding-day moments specifically, not pre-wedding)
- Section 6: Press/publications (if any exist; leave it out rather than faking it)
- Section 7: FAQ (4 questions max)

#### 3. Conversion scaffolding at the END
- Section 8: Soft pricing signal — *"Collections begin at $[X] for intimate weddings. Each is scoped to the couple and the day."* Small type block, not a pricing card grid.
- Section 9: Inquiry form — the only form on the page. After the emotional arc. 5 fields max (see form spec).
- Section 10: Alternative contact (email + Instagram DM) as failsafe.

This ordering matches the editorial LPs' instincts while meeting paid-traffic conversion needs.

---

## Form specification

Based on the DocuSign +35% mobile conversion finding (field reduction) and the editorial-LP refusal of above-fold forms, the form should be **5 fields max**, single-step, at the bottom of the page.

### Fields

1. **Name** (required, single line)
2. **Email** (required, email validation)
3. **Ceremony date** (optional; month/year picker or free text — MUST be a simple input, not a full calendar widget, which kills mobile conversion)
4. **Ceremony location** (required, free text with placeholder "City or venue") — this is the single most important field because it filters overseas-wedding traffic
5. **Your story** (optional textarea, 2 lines placeholder prompt: "Tell me about your day. What does it look like?")

### What we're NOT asking
- Budget (signals downmarket, depresses conversion, can qualify at consultation)
- Guest count (friction without value at inquiry stage)
- Phone number (phone field alone is known to cost ~15% of conversion per one of the Perplexity data points)
- "How did you hear about us?" (friction without strategic value)
- Package dropdown (signals transactional; inconsistent with editorial tone)

### Submission
- Use existing `ContactForm.astro` with Formspree integration (already wired)
- Fallback copy on error: "Email info@kashklicks.ca or DM on Instagram" (already in place)
- Success state: brief warm message, not a hard redirect

---

## Mobile specification

The research was clear on one thing: **desktop converts 1.9–3x better than mobile generally**. For image-heavy editorial sites this gap widens unless deliberately closed. 60%+ of Google Ads traffic will be mobile, so we cannot let mobile degrade.

### Non-negotiables
- **Hero image:** Served as AVIF/WebP via Astro Image, explicit `<picture>` with mobile-first srcset. Target <150KB mobile, <250KB desktop.
- **Hero headline type scale:** Already responsive via `text-display-md` clamp. Verify it doesn't break on iPhone SE width (375px).
- **Gallery images:** Lazy-load everything below the fold. No layout shift — explicit aspect ratios on wrappers.
- **Form on mobile:** Floating inputs work on mobile; verify autocomplete and input modes (`inputmode="email"`, `autocomplete="email"`).
- **Page weight above fold on mobile:** <500KB total (per existing performance budget in CLAUDE.md).
- **LCP target:** <2.5s on 4G (per existing performance budget).

### Mobile-only simplifications (allowed)
- Mid-page photo grids can render as a single-column stack instead of 2 or 3 columns
- Nav collapses to hamburger (already does site-wide)
- FAQ accordion uses native `<details>` for better mobile performance (already in component)

### Mobile-only enhancements (add)
- **Sticky bottom CTA** on mobile only, starting after scroll past hero: small button "View the Portfolio" or "Start the Conversation." Hidden on desktop. This is the one conversion mechanic we borrow from CRO because mobile users don't scroll back up.

---

## Trust signal strategy

Research gap: Perplexity could not confirm a ranked hierarchy of trust signals at the luxury tier. Fallback to competitive evidence + first principles:

### What the international LPs actually use (in priority order)

1. **Named couple + venue captions on portfolio thumbnails** (all 5 sites do this or similar)
2. **Named-editor/publication testimonial** (KT Merry uses a Harper's Bazaar editor by name and title — dramatically more credible than anonymous stars)
3. **Press logo strip** (KT Merry, Jenny Fu, Jose Villa)
4. **Single display-typography testimonial as editorial pull-quote** (Jenny Fu's "FIVE BILLION STARS")
5. **No review counts, no star widgets, no "500+ couples" badges** — these read downmarket at this tier

### Application to AD's LP

- **Use:** Named couple + venue on every portfolio thumbnail. Example: "Ayushi & Parth — Royal Ontario Museum."
- **Use:** One display-typography testimonial from a Toronto couple, pulled as a magazine pull-quote.
- **Skip for now:** Press logos (none yet — don't fake it). Add when AD earns genuine editorial placements.
- **Skip:** Review count widget, star widget, "500+ couples" style claims. These contradict the editorial tone.

---

## Pricing display decision

**Decision:** Soft pricing signal near the footer, not a pricing card grid, not a dollar-amount hero banner, not fully hidden.

> *"Collections begin at $X CAD for intimate weddings. Photo and film included. Each wedding is scoped to the couple and the day — numbers are a conversation, not a menu."*

### Rationale

- All 5 international editorials hide pricing → pure hide = editorial-safe
- BUT paid traffic from Google Ads often includes "cost" and "pricing" queries (see keyword list: "wedding photographer toronto pricing" 300–500/mo searches)
- A soft starting-at number below the emotional arc qualifies inquiries (eliminates $1k–2k searchers) WITHOUT signaling downmarket
- Ten2Ten and Judy Nguyen (Toronto competitors) show pricing transparently — they're in the $2–4k tier. AD's number above theirs, shown softly, positions as premium without being evasive.

**Starting number to use:** $4,500 photo-only / $6,500 photo + film (placeholder — Akash confirms actual).

---

## Copy tone rules

Enforce across the page. Borrowed from AD's Digital Curator spec, tightened against this research.

- **Serif for emotional text. Sans for informational.** (Per existing typography-by-intent rule in CLAUDE.md.)
- **No em dashes.** (Per existing no-em-dash rule.)
- **No stock phrases:** "cinematic storytelling" (saturated per competitor analysis), "bespoke experience," "passionate about capturing," "love stories."
- **First-person singular voice.** "I shoot one wedding per weekend." NOT "We capture." Solo is the positioning; the voice must match.
- **Toronto-specific references.** Mention venues, neighborhoods, or city details at least 3 times on the page. This is a local-filter signal for both readers and SEO.
- **No pre-wedding language in hero or first 2 sections.** Pre-wedding is an upsell, not the acquisition message.
- **No "South Asian" or "Indian wedding" language.** Per the overseas-vs-local targeting memo.

---

## SEO spec

Per the existing site's SEO infrastructure (BaseLayout + SEO.astro + JsonLd.astro):

### Meta
- **Title:** `Intimate Wedding Photographer Toronto | AD Photography`
- **Description (155 chars):** `Solo editorial wedding photographer + film for Toronto couples. Church, civil, backyard, intimate ceremonies. View the portfolio and start the conversation.`
- **Canonical:** `https://kashklicks.ca/intimate-wedding-toronto`

### Structured data (via `jsonLd` prop)

Add a `Service` schema scoped to Toronto + intimate weddings:

```json
{
  "@context": "https://schema.org",
  "@type": "Service",
  "serviceType": "Intimate Wedding Photography and Videography",
  "provider": { "@type": "LocalBusiness", "name": "AD Photography" },
  "areaServed": { "@type": "City", "name": "Toronto" },
  "description": "Solo editorial wedding photography and film for intimate Toronto weddings — church, civil, backyard, and small-venue ceremonies.",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "CAD",
    "priceSpecification": {
      "@type": "PriceSpecification",
      "minPrice": "4500"
    }
  }
}
```

(Keep the existing BaseLayout LocalBusiness schema auto-injected. This Service schema layers on top.)

### Internal linking
- Link to `/portfolio/weddings` from hero CTA
- Link to `/about` from photographer section mid-page
- Link to individual location guides (`/location-guide/casa-loma`, `/location-guide/td-centre`) from portfolio captions or a dedicated mini-section

### URL + breadcrumbs
- URL: `/intimate-wedding-toronto` (clean, keyword-matching)
- Breadcrumb: `Home > Services > Intimate Wedding Photography Toronto`

---

## Data prerequisites

Before building, two data fixes needed:

1. **Add `location` field to `src/data/testimonials.json`** for each of the 5 existing testimonials. For LP, filter to only Toronto-sourced ones.
2. **If fewer than 3 Toronto testimonials exist**, need to source 1–2 more from existing clients (RC Harris, Glenerin, TD Centre, etc.) — could pull from Google reviews if written permission obtained.

---

## Success metrics

Tied to the Google Ads plan (separate doc: `2026-04-17-google-ads-campaign-plan.md`).

**Month 1 landing page targets:**
| Metric | Target |
|---|---|
| Mobile LCP | <2.5s |
| Desktop LCP | <1.8s |
| Bounce rate | <65% |
| Form conversion rate | 3–5% |
| Scroll depth 75% | >40% |
| Inquiries with "Toronto/GTA" in location field | >70% of total inquiries |
| Blended cost per qualified local inquiry | <$70 |

If bounce rate exceeds 70% on mobile, the issue is hero/load. If form conversion is <2%, the issue is form friction or copy. Each has different fixes.

---

## What this research DID NOT answer

Being honest about gaps so we can validate post-launch:

1. **Exact form-field count impact** for high-ticket creative services (research gap — not in CRO literature)
2. **Pricing display transparency A/B data** at this tier (research gap — speculate based on competitor patterns)
3. **Video hero vs still hero** conversion impact (both approaches used by the 5 international LPs; unresolved)
4. **Conversion rate benchmarks specific to Toronto wedding paid traffic** (one UK case study at 24.5% is the only data point; realistic cold paid = 3–7%)

These become A/B test candidates after the page is live with baseline data.

---

## Next step

Build `/intimate-wedding-toronto` per this spec. Estimated build time: 45–60 min. Will use the wedding.astro structure as the foundation and adapt per the build plan above.
