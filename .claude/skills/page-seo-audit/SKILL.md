---
name: page-seo-audit
description: "Audit and fix SEO on any single page of the AD Photography (kashklicks) Astro site. Runs a full on-page + structured-data + content-mirror + asset pass: meta tags, heading structure, JSON-LD deduplication, LCP image optimization (AVIF + fetchpriority), public/mirrors/*.md freshness, llms.txt currency, sitemap lastmod, alt text quality, FAQ schema, preconnects. Use this skill whenever the user says 'audit this page for SEO', 'SEO audit the X page', 'run SEO on /path', 'fix SEO on this page', 'check SEO on X', or describes any SEO / meta / schema / OG / crawler concern about a specific route on this site — even if they don't explicitly say 'audit'. Also trigger if the user asks to verify indexability, rich results eligibility, or social share rendering for a page."
---

# Page SEO Audit (kashklicks)

Audit a single page on the AD Photography site, produce a findings document, then apply fixes. Works the same way the homepage audit on 2026-04-16 worked — that audit is the reference implementation (`docs/seo/homepage-audit-2026-04-16.md`).

## Input

The user will name a page by path (`/services`, `/about`, `/portfolio/weddings/`, `/blog/best-toronto-pre-wedding-locations/`). If they don't name one, ask. Resolve the path to its Astro source file:

| Path pattern | Source |
|---|---|
| `/` | `src/pages/index.astro` |
| `/about` | `src/pages/about.astro` |
| `/services`, `/services/wedding`, etc. | `src/pages/services/*.astro` |
| `/portfolio`, `/portfolio/weddings`, etc. | `src/pages/portfolio/*.astro` |
| `/portfolio/{slug}` (gallery) | `src/pages/portfolio/[slug].astro` + `src/data/portfolio.json` entry |
| `/blog/{slug}` | `src/content/blog/{slug}.md` |
| `/contact`, `/location-guide` | `src/pages/{route}.astro` |

## Why this skill exists

Akash ships design-heavy pages fast. The things that rot fastest between ships are:
1. Markdown mirrors in `public/mirrors/` drifting from the live page
2. `llms.txt` referencing routes that got deleted
3. Duplicate JSON-LD emissions when a page re-emits `LocalBusiness` that `BaseLayout.astro` already provides
4. Hero images kept at `quality={90}` WebP when the LCP budget wants AVIF around 150 KB
5. H1s that look right visually but carry no keywords (pure tagline)

Every audit should assume these problems exist until ruled out. They were all present on the homepage on 2026-04-16.

## Workflow

### 1. Gather context in parallel

Read all of these at once — they are the full context envelope:

- The page source (e.g., `src/pages/index.astro`)
- `src/layouts/BaseLayout.astro` (site-wide schema + head)
- `src/components/seo/SEO.astro` (title/description/OG/Twitter emission)
- `src/data/site.json` (brand metadata, schema inputs)
- `public/llms.txt`
- `public/mirrors/{slug}.md` if one exists (homepage is `home.md`)
- `docs/seo/keyword-map.md` (to confirm target keywords for this page)
- `dist/sitemap-0.xml` if a recent build exists (otherwise `pnpm build` first)

Also run the build and `grep` the rendered HTML — meta, JSON-LD, heading hierarchy, image formats are only truthfully observable in the built output, not the `.astro` source:

```bash
pnpm build 2>&1 | tail -20
grep -oE '<title>[^<]+|<meta name="description"[^>]+|<link rel="canonical"[^>]+|<h1[^>]*>[^<]{0,120}|<h2[^>]*>[^<]{0,120}' dist/{route}/index.html
grep -c 'LocalBusiness' dist/{route}/index.html   # expect 1, not 2
grep -oE 'fetchpriority="[^"]+"|\.(avif|webp)"' dist/{route}/index.html | head -20
```

### 2. Run the checklist

Work through every category. Record findings regardless of severity; prioritize when writing up.

#### On-page meta
- Title tag length (50–65 chars) and includes primary keyword.
- Meta description length (140–170 chars) and includes keyword + value prop + geo.
- Canonical present and points to correct URL.
- `robots` meta not accidentally set to noindex.
- OG: title, description, image, image:width (1200), image:height (630), image:alt, url, type, locale, site_name.
- Twitter: card, title, description, image. (The site doesn't use `twitter:site` handle — OK to leave unless an Instagram-equivalent handle is added.)

#### Heading hierarchy
- Exactly one `<h1>` per page. If `showSplash` is true, check the built HTML for a second `<h1>` inside `#splash-overlay` — demote to `<p>` with `aria-hidden="true"` if found.
- H1 must contain the page's primary keyword. If the visual design uses a tagline as the big serif headline, swap semantic roles (h1 ↔ h2) while preserving the visual classes — use Tailwind `order-*` on a flex container if needed.
- H2/H3 cadence should read like a table of contents for the page.

#### Structured data
- Exactly one `LocalBusiness` emitted site-wide from `BaseLayout.astro`. Never re-emit it on a child page. If you find a duplicate in a page, delete it — keep only page-specific schemas (`WebSite`, `FAQPage`, `Service`, `ImageGallery`, `BlogPosting`, `BreadcrumbList`, `VideoObject`).
- Confirm `@id` is on the `LocalBusiness` so other schemas can reference it.
- `BreadcrumbList` on non-home pages (home doesn't need one).
- `ImageGallery` on portfolio gallery pages.
- `BlogPosting` on blog posts (already handled in `BlogLayout` — verify).
- `Service` on each `/services/*` page.
- `FAQPage` wherever questions are surfaced visually — if the page shows FAQs but emits no `FAQPage`, add it. If the page emits `FAQPage` but no questions render, remove the schema.

#### Images
- Hero / above-the-fold LCP image: `format="avif"`, `quality={75}` (range 70–80 for gradient-overlaid heroes), `loading="eager"`, `fetchpriority="high"`. Target around 100 KB at the 1280w srcset variant.
- Gallery images below the fold: `loading="lazy"`, `quality={90}`, WebP/AVIF autoselected.
- Every `<Image>` has descriptive `alt` in the pattern `[subject/couple], [event type], [location]`. Flag generic alts like "Wedding photography session in Toronto" or "Ayushi and Parth, candid wedding moment" (missing location).
- `width` and `height` baked in (Astro `Image` handles this — flag if raw `<img>` tags appear).

#### Content mirror (`public/mirrors/{slug}.md`)
- Exists for key pages: home, services, portfolio, about, contact, pricing-equivalent.
- Title + description match live meta tags exactly.
- Hero section reflects current featured content (check for stale couple names / dates).
- Every CTA link inside the mirror hits a live route — no references to deleted pages.
- Add new mirrors as the user ships new pages; don't leave this dangling.

#### llms.txt
- URL entries all 200. Grep for `/pricing/` or any route that was deleted recently (`git status | grep '^ D src/pages/'`).
- Package prices match `src/data/packages.json`.
- Blog index stays in sync with `src/content/blog/*.md`.
- Keep the positioning paragraph ("solo photographer, not a South Asian wedding specialist") accurate — see `project_positioning_solo.md` in memory.

#### Sitemap & robots
- `astro.config.mjs` sitemap integration has `lastmod` configured, else Google won't know the page changed.
- `robots.txt.ts` allows indexing for this route.
- After build, verify the route appears in `dist/sitemap-0.xml` and that deleted routes don't.

#### Head-level performance (SEO via CWV)
- `<link rel="preconnect" href="https://kashklicks.b-cdn.net" crossorigin>` — required whenever a page uses the video CDN.
- Critical fonts preloaded (site does this globally).
- No external stylesheets that block render.
- `meta theme-color` and `meta author` present (site-wide in `BaseLayout`).

#### Analytics & tokens
- Flag but don't fix: `YOUR_CF_ANALYTICS_TOKEN` placeholder, `YOUR_FORMSPREE_ID` placeholder. Those need real values from Akash.

### 3. Write the findings doc

Path: `docs/seo/{page-slug}-audit-{YYYY-MM-DD}.md`. Slug is the route with `/` turned into `-` (`/services/wedding` → `services-wedding`), homepage is `homepage`.

Use this structure — it matches what the homepage audit produced and is the template going forward:

```markdown
# {Page name} SEO Audit — {YYYY-MM-DD}

**Scope:** {route} ({source file path})
**Auditor:** Claude
**Status:** {Findings only | Findings + fixes applied}

---

## TL;DR
{2–4 sentences: scaffolding state + top 3 issue buckets.}

---

## P0 — Fix before next deploy
Items that break something user-visible or crawler-visible. Number them. For each: file:line reference + current state + fix.

## P1 — Next iteration
Items that weaken SEO but aren't broken. Same format.

## P2 — Nice-to-haves
Polish and future-proofing.

---

## What's already good (don't regress)
Positive list so the user knows the baseline.

---

## Priority punch list (copyable)
- [ ] P0 — ...
- [ ] P1 — ...
- [ ] P2 — ...
```

Every P0/P1 item must include enough detail for the user to fix it even if the skill never runs again — file path, line number, before/after code snippet when useful. No vague recommendations.

### 4. Apply fixes

After writing the doc, work the punch list from P0 down. Use `TaskCreate` to track each item — helpful because some fixes touch multiple files (schema changes hit `BaseLayout.astro` + the page + `site.json`). Mark each task `in_progress` when you start, `completed` when verified in the built HTML.

**Never fix without a findings doc.** The doc is the contract with the user — if you skip it, they can't see what changed or why.

**Fixes that require human input** (don't attempt): real OG image assets, real phone number for `site.json`, real Cloudflare Analytics token, real Formspree ID. Flag these in the doc under a "Needs input from Akash" heading and skip them.

### 5. Verify

```bash
pnpm build 2>&1 | tail -30
```

Then re-grep the route's `dist/{route}/index.html` for every P0 that was fixed:
- `grep -c 'LocalBusiness' dist/{route}/index.html` → 1
- `grep -oE '<h1[^>]*>[^<]{0,100}' dist/{route}/index.html` → single keyword-rich H1
- `grep -oE 'hero[^"]*\.avif"' dist/{route}/index.html` → hero renders AVIF
- `grep -oE 'fetchpriority="high"' dist/{route}/index.html` → at least one
- `grep 'FAQPage' dist/{route}/index.html` → present if FAQ section exists
- Sitemap has `<lastmod>` on every `<url>`

If any fix didn't land in the built output, investigate before declaring done.

## Page-type shortcuts

Different page types have different P0 risks. Glance at the appropriate list first — don't re-discover these from scratch each time.

**Homepage (`/`)**
- Splash overlay adds a second `<h1>` if not demoted.
- Hero image is the LCP — AVIF + `fetchpriority="high"` is non-negotiable.
- Page historically re-emits `LocalBusiness`; now consolidated in `BaseLayout`. Verify it stayed that way.

**Service page (`/services` or `/services/{slug}`)**
- Should emit `Service` schema referencing `LocalBusiness` via `@id`.
- Pricing in copy must match `packages.json`.
- FAQ block exists — needs matching `FAQPage` schema.

**Portfolio index and subcategories**
- Should emit `CollectionPage` or `ImageGallery`.
- Each cover image's alt text should name the couple + location + event type.

**Portfolio gallery page (`/portfolio/{slug}`)**
- `ImageGallery` schema with each photo as `ImageObject`.
- `BreadcrumbList`.
- `datePublished` in schema from `portfolio.json` metadata.
- LCP is the cover image.

**Blog post**
- Handled mostly by `BlogLayout`. Verify `BlogPosting` schema includes `author`, `datePublished`, `image`, `wordCount` where available.
- Internal links to related galleries / location guides.

**About page**
- Should emit `Person` schema for Akash + `LocalBusiness` reference.
- Hero portrait LCP optimization.

**Contact page**
- Should emit `ContactPage` + confirm LocalBusiness address/email render in copy.
- Formspree ID placeholder is a known issue; don't try to fix it.

## Failure modes to avoid

1. **Auditing the `.astro` source instead of the built HTML.** Astro transforms a lot — `<Image>` → `<img>` with srcsets, component slots resolve, JSON-LD minifies. Always grep `dist/` for truthful state.
2. **Fixing without building afterward.** A "fix" that doesn't appear in `dist/` is not a fix.
3. **Over-emitting schema.** Two `LocalBusiness` blocks are worse than one. Ditto two `Organization`, two `WebSite`.
4. **Keyword-stuffing H1s.** One natural-reading keyword phrase beats three awkward ones.
5. **Touching `public/og-default.jpg` with AI-generated content.** That's a real brand asset — flag the placeholder, don't try to replace it yourself.
6. **Skipping the findings doc.** The doc is the audit trail — code fixes without it leave Akash blind.

## Memory references

When running this skill, these memories from `~/.claude/projects/-Users-akashdesai-projects-kashklicks/memory/` are load-bearing:

- `project_positioning_solo.md` — "AD Photography is a solo, intimate-wedding photographer, not a South Asian wedding specialist." Drives copy in llms.txt + mirror files.
- `feedback_no_em_dashes.md` — never use em/en dashes in copy. Includes llms.txt and mirror files.
- `reference_image_optimization_specs.md` — hero target is ~150 KB AVIF, covers 20 KB, thumbnails 40 KB.
- `reference_service_page_template.md` — `services/wedding.astro` is the golden template for schema and section structure.
