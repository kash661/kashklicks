# Design Brief — Tier 1 Conversion Bundle (KashKlicks / AD Photography)

**Date:** 2026-05-28 · **Branch:** `feat/funnel-features` · **Source:** `docs/feature-roadmap.md` (#1–#3)
**Gate:** This brief exists to satisfy the build-time rule — new visual design routes through `hallmark` + a written brief BEFORE building. Read this, then run hallmark on it.

---

## 1. What we're building (and why)

Three changes to close the two conversion blind spots the funnel analysis surfaced — *"Is my date open?"* and *"is this a local job I can actually take?"* — without adding friction or breaking the Digital Curator aesthetic.

1. **Now-booking scarcity line** — a quiet, truthful line ("Now booking 2026 and 2027 weddings. I take a limited number each year.") in the homepage hero, the homepage Investment block, and near service-page pricing CTAs. It is *true* (solo photographer, finite capacity), it justifies the $1,400 floor, and it nudges shortlisting couples to inquire now.
2. **Date-first reframe** — surface the `event_date` field FIRST in the inquiry form (today it is buried, optional, inside a collapsed "Add more details" section) and frame the inquiry around checking the date. The owner does not reliably check email and there is a known `/forms` empty-inbox bug, so the *first* thing we want captured is the date + intent.
3. **GTA-vs-overseas qualifier** — one required select on the inquiry form capturing where the day will take place. This is the north-star metric for the business's local-intimate pivot: without it, "how many inquiries are local vs destination?" is unmeasurable at the point of inquiry.

## 2. Non-negotiable brand + design constraints

From `.claude/CLAUDE.md` (Digital Curator) and the vault Brand Voice / Positioning:

- **No em dashes or en dashes anywhere in copy.** Commas, periods, or restructure. (Instant AI tell + hard brand rule.)
- **Solo, first-person voice.** One photographer (Akash). "I take a limited number." Never imply a team.
- **Weddings = photo only.** Never "photo + film" in wedding copy. (Film is pre-wedding only.)
- **Typography by intent.** Scarcity line + form labels + microcopy are INFORMATIONAL → sans (`text-label-sm` / `text-label-md` / `text-body-md`). Never serif. Serif is reserved for emotional headings/quotes.
- **0px radius everywhere. No gold/metallic. No 1px solid section borders. Mobile-first.** No Google Fonts CDN. No `SectionHeading` component.
- **Embrace the void.** The hero is deliberately spare. Anything added there must earn its place and stay visually subordinate to the photograph and the tagline.
- Reuse existing tokens/components. Don't invent a new visual language.

## 3. Existing assets to reuse (do NOT rebuild)

- **`.service-sale-tag` + `.service-sale-dot`** (`global.css:410`): the established scarcity-adjacent micro-treatment — sans, 0.6875rem, 600 weight, 0.2em tracking, ALL-CAPS, `on-surface` color + a 5px square dot. Already used for "Limited Offer" on the homepage Investment mobile rows. The new scarcity line should live in the SAME typographic family so nothing feels bolted on.
- **`ContactForm.astro`** (`src/components/forms/`) — the single inquiry form. `ContactModal.astro` wraps it and `/contact` renders it inline, so ONE edit covers the modal (on `/services/*`) and the standalone page. Required-field pattern: `.form-field` > `.form-field__label` + `.form-field__select` / `.form-field__input` + `.form-error-msg`. The JS validates every `[required]` field generically, so a new required select needs no JS changes.
- **`worker.ts`** forwards the ENTIRE `FormData` to Apps Script (no field whitelist) — any new named field rides through to the Inquiries sheet automatically.
- **Hidden context fields** `package_id` / `package_name` / `source_page` are reset+set by ContactModal's `setField` on open; the new visible qualifier is a normal user field and needs no prefill plumbing.
- Type scale, `eyebrow-rule`, `reveal`/`stagger`, `magnetic`, `cubic-ease` motion primitives.

## 4. Proposed treatment (for hallmark to pressure-test)

### 4a. Scarcity line — `BookingNote.astro` micro-component
A single tiny reusable component so the line stays consistent and DRY across surfaces. Props: `tone: 'dark' | 'light'` (hero overlay vs cream surface), optional `text` override.
- **Default copy:** `Now booking 2026 and 2027. I take a limited number of weddings each year.`
- **Type:** sans, label-scale, ALL-CAPS micro-label OR sentence-case body-sm — hallmark to choose which reads quieter. Lead with a small square dot (reusing `.service-sale-dot`) for a calm "live" signal, NOT a pulsing badge.
- **Placements:**
  - **Hero:** one quiet line above the existing "Contact me" CTA, `on-dark`, visually subordinate to the H1/H2 tagline. *Tension to resolve:* the hero is intentionally spare ("embrace the void"). Option A: short hero variant `Now booking 2026 and 2027` only; reserve the full sentence for the pricing surfaces. Option B: omit from hero entirely, keep it at pricing only. Hallmark decides whether the hero can hold it without clutter.
  - **Homepage Investment block** (`InvestmentSection.astro`): near "Starting at $1,400", desktop + mobile trees.
  - **Service-page pricing CTA** (`services/wedding.astro` below-packages CTA block, line ~282): above the "Contact Me" button, replacing/joining the existing "Have questions? I'll get back within 24 hours" microcopy.

### 4b. Date-first reframe (inside `ContactForm.astro`)
- Move `event_date` OUT of the collapsed `<details>` optional block and make it the FIRST field in the required stack. **Keep it free-text** (`type="text"`) — iOS `type=date` commits today's date on a stray "Done" tap (known gotcha); a text field lets "tentative" / "not sure yet" be meaningful.
- **Keep it optional** (not `required`) so "we're just exploring, no date yet" couples are never blocked — but make it visually prominent and first. Placeholder accommodates uncertainty: `e.g. June 14 2027, a season, or "not sure yet"`.
- **Intro microcopy** above the field (sans, on-surface-variant): `I only take a limited number of weddings each year, so let's start with your date.` (no dash; restructured from the roadmap's dashed version.)
- **CTA framing:** the form/modal can lead with the date promise. ContactModal title stays serif/emotional ("Tell me about your day."); the new microcopy carries the date-first functional message. Submit button copy: keep "Send Inquiry" (changing it risks implying an instant calendar check we can't deliver). Hallmark to confirm.

### 4c. GTA/overseas qualifier (inside `ContactForm.astro`)
- New **required** `<select name="event_region">` using the exact `.form-field__select` pattern (matches `referral` / `event_type`).
- **Label:** `Where will it take place?` (neutral across wedding / pre-wedding / civil / celebration; clearly geographic).
- **Options** (geographic ladder, better data than a binary): `Toronto / GTA` · `Elsewhere in Ontario` · `Elsewhere in Canada` · `Outside Canada`. (Roadmap baseline was 3; the 4th separates destination-Canada from overseas, which matters for the travel/cost story behind the local pivot.)
- **Placement in the required stack:** date (first, optional) → name → email → **Where will it take place?** → what I'm capturing → how did you find me → message.

## 5. Field order (final)
1. Event date — *optional, free-text, prominent, first*
2. Your Name — required
3. Email — required
4. Where will it take place? — **required (new)**
5. What I'm Capturing (event_type) — required
6. How Did You Find Me? (referral) — required
7. Tell Me About Your Day (message) — required
8. Optional `<details>`: Partner's Name, Phone, Approx. Guest Count, Venue or Location (event_date removed from here; venue stays)

## 6. Out of scope (this branch)
- LP forms (`EngagementOfferForm.astro`) — separate funnel; qualifier there is a fast-follow.
- WhatsApp/IG click-to-chat (#4) and multi-platform review strip (#5) — next, after #1–#3.
- Apps Script column mapping — owner-side; worker already forwards the field.

## 7. Acceptance
- Renders correctly at 390px and 1280px; no CLS, no layout shift in the hero.
- Zero em/en dashes in any new copy. 0px radius. Sans for all new text. Solo voice. No "photo + film" in wedding copy.
- `pnpm build` clean (84 pages), `pnpm test` 10/10.
- New `event_region` value reaches the worker (visible in network POST body).
