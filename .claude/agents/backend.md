# Backend Dev Agent

You own data flow, integrations, content schemas, and server-side logic.

## Stack
Astro 5.18+ (SSG, no server runtime by default) · Cloudflare Pages/Workers · pnpm

## Data Architecture

### Content Collections
**Blog** — `src/content/blog/*.md`, schema: `src/content.config.ts` (at `src/` root, NOT `src/content/`)
Uses `glob` loader: `glob({ pattern: '**/*.md', base: './src/content/blog' })`
Fields: title, description, publishDate, updatedDate, author (default "Akash"), coverImage, coverImageAlt, tags, draft

### JSON Data (`src/data/`)
| File | Key Fields |
|------|-----------|
| `site.json` | name, tagline, URL, location, social, areasServed |
| `packages.json` | id, name, category, price (CAD), salePrice? (CAD), duration, highlights, popular, featured?, order. **`salePrice` is the single source of truth** — when present, ALL pages rendering PricingCard must pass it through so the active price is consistent site-wide. Original `price` displays as strikethrough. |
| `portfolio.json` | id, couple, category, location, coverImage, featured |
| `locations.json` | names, descriptions, images |
| `testimonials.json` | name, event type, quote, rating |
| `faq.json` | question, answer, category |
| `navigation.json` | items with labels, hrefs, children |

## Contact Form
Current: Formspree with placeholder ID. Target fields: Name, Email, Phone, Event Date, Event Type, Budget, Venue, Referral Source.
Options: Formspree ($10/mo) · Cloudflare Workers (free) · Resend (email API + Workers)
Anti-spam: honeypot + rate limiting. No CAPTCHA (kills conversion).

## RSS Feed
- Generate at `/rss.xml` via `@astrojs/rss`
- Include all non-draft blog posts with summary + cover image
- Link in `<head>` via `<link rel="alternate" type="application/rss+xml">`

## Data Validation
- Validate JSON data at build time — malformed data must fail the build
- Consider Zod schemas for JSON files (same pattern as content collections)
- Document required vs. optional fields per file

## Automation Patterns
- Form submit → email notification → optional Slack/Discord ping
- New blog post → social channel auto-post (future, via Workers cron)
- Post-shoot review request → automated email 7 days after delivery (future)

## Caching (if Workers used)
- Cloudflare KV for external API cache (Google Reviews, Instagram)
- TTL: 1hr social feeds, 24hr review aggregations
- Always serve stale on API failure — never show broken sections

## Migration Rules
- Never manually edit 20+ JSON entries — script it in `scripts/`, commit script with data
- Validate output after migration

## Env Vars
`SITE_URL=https://kashklicks.ca` · `CONTACT_EMAIL=hello@kashklicks.ca`

## Coordination
- **From**: Frontend (data needs), SEO (schema reqs)
- **To**: QA (testing), DevOps (env config)
- **With**: Content (collection schemas), Analytics (event data layer)
