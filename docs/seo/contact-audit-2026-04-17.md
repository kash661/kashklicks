# Contact Page SEO Audit — 2026-04-17

**Scope:** `/contact` (`src/pages/contact.astro`)
**Auditor:** Claude
**Status:** Findings + fixes applied

---

## TL;DR

Contact page scaffolding is healthy: single `LocalBusiness` from `BaseLayout`, clean `FAQPage` + `ContactPage` + `BreadcrumbList`, AVIF hero with `fetchpriority="high"`. The rot lives in three places: (1) title + H1 carry zero target keywords, so Google has no signal this page ranks for "book wedding photographer Toronto"; (2) every content mirror still says `hello@kashklicks.ca` after the email switch to `info@`; (3) there's no `public/mirrors/contact.md` at all, so AI crawlers see nothing. Also: `font-lab.astro` is leaking into the sitemap.

---

## P0 — Fix before next deploy

### P0-1 · Title ignores primary keyword

- **File:** `src/pages/contact.astro:56`
- **Current:** `title="Inquiry"` → renders as `Inquiry | AD Photography` (34 chars)
- **Keyword target (from `docs/seo/keyword-map.md`):** `book wedding photographer Toronto`
- **Fix:** `title="Book a Toronto Wedding Photographer"` → `Book a Toronto Wedding Photographer | AD Photography` (~52 chars, within 50-65 window)

### P0-2 · H1 has zero keyword weight

- **File:** `src/pages/contact.astro:73-75`
- **Current:** `<h1>Let's capture the <em>fleeting moments.</em></h1>` — pure tagline.
- **Problem:** Primary keyword nowhere in H1. Google's heuristic for `/contact` ranking starves.
- **Fix:** Keep the tagline as the visually dominant serif display, demote it to `<p>`-like role, promote the eyebrow to semantic H1 with keyword. Rewrite as:
  - Eyebrow stays visually as "Inquiry" label-md
  - Replace the `<h1>` with a keyword phrase ("Book a Toronto Wedding Photographer.") styled `text-display-md char-reveal`, with the tagline sitting below it as a serif italic `<p>` pull-line in the same cadence.
  - Alternative kept-tagline approach: combine into single H1 "Book a Toronto wedding photographer. Let's capture the fleeting moments." — but that's too long for the visual space. Prefer the split above.

### P0-3 · Description too long + keyword-weak

- **File:** `src/pages/contact.astro:57`
- **Current (174 chars):** `Get in touch with AD Photography for wedding, pre-wedding, and event photography in Toronto. Free consultation included. We respond within 24 hours.`
- **Target:** 140-170 chars, include primary keyword and transactional signal.
- **Fix:** `Book a Toronto wedding photographer. Pre-wedding, wedding, and civil ceremony coverage across the GTA. Free consultation, 24-hour reply.` (~139 chars) — leans on primary keyword, lists services, promises response time.

### P0-4 · Stale `hello@` across llms.txt and 3 mirrors

- **Files:**
  - `public/llms.txt:15` → `Contact: hello@kashklicks.ca`
  - `public/mirrors/home.md` (has `hello@`)
  - `public/mirrors/about.md` (has `hello@`)
  - `public/mirrors/services.md` (has `hello@`)
- **Current state:** Live site + `site.json` now use `info@kashklicks.ca`; mirrors + llms.txt still reference the retired address.
- **Fix:** Global replace `hello@kashklicks.ca` → `info@kashklicks.ca` in all four files. Bonus on llms.txt: update the `/contact` description line to reflect Instagram DM as the fastest-reply channel.

### P0-5 · No `public/mirrors/contact.md`

- **Current state:** `ls public/mirrors/` shows `about, blog, home, location-guide, services, services-*` — contact is missing.
- **Problem:** AI/LLM crawlers (who look for `/mirrors/{page}.md` per `llms.txt` convention) get nothing for contact. Broken retrieval loop.
- **Fix:** Create `public/mirrors/contact.md` with the new title, description, H1, FAQ summary, both contact methods (email + IG as fastest), and a note about 24-hour reply.

---

## P1 — Next iteration

### P1-1 · Breadcrumb URL missing trailing slash

- **File:** `src/pages/contact.astro:62-64` (the Breadcrumbs prop)
- **Current built schema:** `"item":"https://kashklicks.ca/contact"` (no trailing slash)
- **Canonical:** `https://kashklicks.ca/contact/` (trailing slash)
- **Impact:** Minor consistency gap, can cause duplicate URL interpretation in search.
- **Fix:** Change breadcrumb item href from `/contact` → `/contact/` in the props passed to `<Breadcrumbs>`.

### P1-2 · `/font-lab/` leaking into sitemap

- **File:** `src/pages/font-lab.astro` (out of audit scope but visible in the `dist/sitemap-0.xml` output)
- **Impact:** Dev specimen page getting indexed. Not a contact-page issue directly, but it's in the sitemap that Google crawls based on changes to this page.
- **Fix:** Add `noIndex={true}` to the `BaseLayout` call inside `font-lab.astro`, or exclude the route via `filter` in `astro.config.mjs` sitemap config. Latter is cleaner.

### P1-3 · Breadcrumb label reads "Inquiry"

- **File:** `src/pages/contact.astro:63`
- **Current:** `{ label: 'Inquiry', href: '/contact' }`
- **Consideration:** Nav CTA was renamed to "Contact Us" this cycle. Breadcrumb still says "Inquiry" — fine editorially, but the footer + nav use "Contact Us". Pick one and stay consistent.
- **Recommendation:** Keep breadcrumb label aligned with page title ("Contact") for search snippet clarity. Leave body copy eyebrow as "Inquiry" for editorial voice.

---

## P2 — Nice-to-haves

### P2-1 · FAQ label copy references "Before You Book"

- The FAQ section eyebrow reads "Before You Book" which is editorial and good, but the H2 is "Frequently Asked Questions" — generic. Consider tightening to "Frequently Asked · Toronto Wedding Photography" for a keyword assist. Optional, slight gain.

### P2-2 · Contact modal has H2 (`#contact-modal-title`)

- `<h2 id="contact-modal-title">Tell us about your day.</h2>` is inside the `<dialog>`. Present in the static HTML, so crawlers see it. Not a problem, just noting — the page has 3 visible H2s + 1 modal H2, all fine.

### P2-3 · OG image is site-default

- `og-default.jpg` is used. For `/contact`, a subtle contact-specific OG (text over a soft portrait) could lift CTR when the page is shared. Not urgent.

---

## What's already good (don't regress)

- Single `LocalBusiness` emission (`grep -c 'LocalBusiness' dist/contact/index.html` = 1).
- `FAQPage`, `ContactPage`, `BreadcrumbList` all present, 1 each.
- Hero uses `.avif`, `loading="eager"`, `fetchpriority="high"`. LCP target met.
- Canonical URL correct: `https://kashklicks.ca/contact/`.
- Form is inside `<dialog>` but form copy still renders in static HTML — crawlers see the three numbered sections and all labels.
- Instagram + email both linked from the Studio Notes colophon with proper `rel="noopener noreferrer"` on IG.
- Sitemap includes `/contact/` with `<lastmod>`.
- `Breadcrumbs` are `sr-only` for design but the schema still emits — best-of-both.

---

## Needs input from Akash (not auto-fixable)

- **Formspree ID** — `ContactForm.astro:6` still says `YOUR_FORMSPREE_ID`. The form action URL resolves to `https://formspree.io/f/YOUR_FORMSPREE_ID` — submissions will 404.
- **Cloudflare Analytics token** — `BaseLayout.astro` still has `YOUR_CF_ANALYTICS_TOKEN`. Pageview data not collecting.
- **Custom OG image for contact (optional)** — P2-3.

---

## Priority punch list (copyable)

- [x] P0-1 · Strengthen `title` in `src/pages/contact.astro` to include primary keyword
- [x] P0-2 · Rewrite H1 so it contains "Toronto wedding photographer"; keep tagline as italic pull-line
- [x] P0-3 · Tighten description to 140-170 chars with keyword + 24hr reply
- [x] P0-4 · Replace `hello@kashklicks.ca` with `info@kashklicks.ca` in `public/llms.txt`, `public/mirrors/{home,about,services}.md`
- [x] P0-5 · Create `public/mirrors/contact.md`
- [x] P1-1 · Fix breadcrumb URL trailing slash (`/contact` → `/contact/`)
- [x] P1-2 · Exclude `font-lab.astro` from sitemap (via `astro.config.mjs` filter)
- [ ] P1-3 · (optional) Rename breadcrumb label from "Inquiry" → "Contact"
- [ ] P2-1 · (optional) Retitle FAQ H2 for keyword assist
- [ ] Needs Akash: Formspree ID + CF Analytics token
