# AD Photography — The Digital Curator

## Project Overview
Photography & videography portfolio/business website for AD Photography (Akash).
Built with Astro, deployed on Cloudflare Pages. Live at kashklicks.ca.

**Creative North Star:** "The Digital Curator" — the site should feel like walking through a hushed, sun-drenched gallery. Every design decision serves the photograph. The interface is quiet, architectural, and intentional.

Primary objectives:
1. Showcase work through an editorial gallery experience
2. Convert visitors into booked clients via transparent pricing and clear CTAs
3. Grow organically through SEO, blog content, location guides, and social proof

**Design Spec:** `docs/superpowers/specs/2026-04-16-digital-curator-redesign.md`
**Implementation Plan:** `docs/superpowers/plans/2026-04-16-digital-curator-redesign.md`

## Tech Stack
- **Framework**: Astro 5.18+ (SSG)
- **Styling**: Tailwind CSS 4.2+ (via Vite plugin) + custom design tokens in `@theme`
- **Image Pipeline**: `astro:assets` Image component + Sharp
- **Lightbox**: GLightbox
- **Sitemap**: @astrojs/sitemap
- **Fonts**: 3 serif moods + 2 sans options, self-hosted woff2 (see Typography below)
- **Package Manager**: pnpm
- **Deployment**: Cloudflare Pages
- **CMS**: Astro Content Collections (blog) + JSON data files

## Brand Identity
- **Name**: AD Photography (logo text: "AD")
- **Tagline**: "Moments fade. Memories don't."
- **Location**: Toronto, GTA + Canada-wide
- **Specialties**: Pre-wedding, wedding, civil ceremony, celebrations, portraits — photo AND video/film
- **Tone**: Warm, personal, honest, cinematic — never corporate, never stiff, never "wedding template"

## Design System: The Digital Curator

### Color Palette (Stone/Taupe — Zero Gold)

| Token | Hex | Usage |
|---|---|---|
| `background` | `#faf9f6` | Primary canvas ("gallery wall") |
| `surface` | `#ffffff` | Cards, elevated containers |
| `surface-dim` | `#f4f4f0` | Section alternation, alternate rows |
| `surface-container` | `#e4e2e1` | Image placeholders, gradients |
| `surface-dark` | `#2c2824` | Splash, CTA sections, footer |
| `on-surface` | `#1a1a18` | Primary text |
| `on-surface-variant` | `#5c605c` | Secondary text, labels |
| `on-surface-muted` | `#afb3ae` | Placeholder, disabled |
| `on-dark` | `#faf9f6` | Text on dark surfaces |
| `on-dark-variant` | `#d4ccc2` | Secondary text on dark |
| `primary` | `#5f5e5e` | Buttons, links |
| `primary-hover` | `#4a4948` | Hover state |

### Typography — Font Mood System

Three swappable serif + sans pairings. Switch by changing `--font-serif` and `--font-sans` in global.css `@theme`.

| Mood | Serif (Headings) | Sans (Body) |
|---|---|---|
| `cormorant` (default) | Cormorant Garamond | Inter |
| `fraunces` | Fraunces | Inter |
| `bodoni` | Bodoni Moda | Instrument Sans |

**Type scale classes** (defined in global.css, use these instead of raw Tailwind text sizes):
- `text-display-lg` — Splash page, hero statements (clamp 3rem-5.5rem, serif)
- `text-display-md` — Page titles (clamp 2.25rem-4rem, serif)
- `text-heading-lg` — Section headings (clamp 1.75rem-2.5rem, serif)
- `text-heading-md` — Sub-section headings (clamp 1.25rem-1.75rem, serif)
- `text-body-lg` — Primary body (1.125rem, sans, line-height 1.7)
- `text-body-md` — Secondary body (1rem, sans)
- `text-label-md` — Nav, labels, captions (0.8125rem, sans, ALL-CAPS, tracking 0.1em)
- `text-label-sm` — Micro labels (0.6875rem, sans, ALL-CAPS, tracking 0.12em)
- `text-quote` — Pull quotes, testimonials (clamp 1.5rem-2.25rem, serif italic)

### Layout System

- **Grid**: `grid-editorial` — 12-column grid, 24px gutters, 1440px max, responsive padding
- **Container**: `container-editorial` — 1440px max, responsive padding (no grid)
- **Asymmetry is the rule**: headings on cols 1-5, body on cols 7-12 (or reversed). Never center everything.
- **Spacing tokens**: `--spacing-section` (80-160px), `--spacing-block` (48-96px), `--spacing-element` (24px), `--spacing-tight` (8px)

### Motion

- **Easing**: `cubic-ease` class or `var(--ease-gallery)` — `cubic-bezier(0.22, 1, 0.36, 1)`
- **Durations**: `--duration-slow` (600ms), `--duration-hover` (500ms), `--duration-page` (800ms), `--duration-splash` (1200ms)
- **Scroll reveal**: Add `reveal` / `reveal-left` / `reveal-right` to elements. Add `stagger-1` through `stagger-5` for sequential delays. IntersectionObserver in `src/scripts/scroll-reveal.ts`.
- **Char reveal**: `char-reveal` on serif display headings splits them into per-character fades on scroll. Script: `char-reveal.ts`.
- **Parallax**: `parallax-img` on an `<Image>` gives it an 8%-of-viewport-offset drift on scroll. Script: `parallax.ts`, initialized in `BaseLayout`. Compose with `hover-zoom` — they share the same transform variable.
- **Hover zoom**: `hover-zoom` on an image wrapper (with a child `<img>`) does a 2.5s ease scale(1.04) on hover.
- **Magnetic**: `magnetic` on a button or wrapper pulls toward the cursor (script: `magnetic.ts`).
- **Card lift**: `card-lift` raises an element 4px with a soft shadow on hover, 600ms. `PricingCard` already applies this.
- **Image caption reveal** (`image-caption` + `data-caption="..."` on an image wrapper): a label-sm caption fades in bottom-left on hover. Editorial label for hero/CTA portraits.
- **Eyebrow rule** (`eyebrow-rule` on a `text-label-md text-on-surface-muted` paragraph, plus `eyebrow-rule-center` in `text-center` containers): draws a 40px hairline accent under the eyebrow label when its parent `.reveal` enters the viewport. Signature editorial flourish on all service pages.
- **Page transitions**: Astro View Transitions (fade). Sound plays on transition if enabled.

All motion primitives respect `prefers-reduced-motion: reduce`.

### Sound System

Opt-in ambient sound. Muted by default. Toggle in bottom-right corner.
- `src/scripts/sound-manager.ts` — lazy audio loading, sessionStorage state
- `src/components/global/SoundToggle.astro` — toggle button
- Sound files in `public/sounds/` (currently placeholders)

### Splash Page

- `src/components/global/SplashOverlay.astro`
- Full-viewport gateway, shows once per session (sessionStorage)
- Hidden by default (`display: none`), JS reveals on first visit only
- Ken Burns background, CTA reveals after 3.5s delay
- Only loaded on homepage via `showSplash={true}` prop on BaseLayout

## Hard Rules — Do's and Don'ts

### Typography by Intent (Non-negotiable)

Every text element must follow this rule based on its PURPOSE:

| Intent | Font | Classes | Examples |
|---|---|---|---|
| Emotional / artistic | Serif, serif italic | `text-display-lg`, `text-heading-lg`, `text-quote` | Taglines, titles, quotes, testimonials, poetic statements, section names that evoke feeling |
| Informational / functional | Sans, clean | `text-body-lg`, `text-body-md`, `text-label-md`, `text-label-sm` | Pricing, descriptions, body copy, labels, captions, CTAs, SEO text, navigation |

**Before adding ANY text element, ask:** "Is this emotional or informational?" The answer determines the font. Never add elements without deliberate design intent.

### DO:
- Use asymmetry. Offset headings from body text across the grid.
- Embrace the void. If it feels empty, it's correct. Negative space is luxury.
- Slow everything down. 600ms minimum transitions.
- Let photographs be the hero. Interface is supporting architecture.
- Use tonal layering for depth (lighter surfaces on darker ones).
- Separate sections with surface color shifts or 64px+ white space.
- Think before adding. Every element needs a reason to exist. Don't add things to fill space.

### DON'T:
- **No rounded corners.** 0px radius everywhere. Non-negotiable.
- **No gold, no metallic effects.** Zero. Not even subtle warm accents.
- **No 1px solid borders** to section content. Use space or color shifts.
- **No standard 3-column card grids.** Vary column widths.
- **No em dashes or en dashes** in any copy. Use commas, periods, or restructure.
- **No auto-playing sound.** Always muted by default.
- **No hover-dependent functionality.** Hover is enhancement only.
- **No Google Fonts CDN calls.** All fonts self-hosted as woff2.
- **No SectionHeading component.** Use inline serif headings + label-md subtitles.

## Homepage Image Locations

Reference these IDs when swapping images on the homepage (`src/pages/index.astro`):

| Location ID | Section | Aspect | Current Source |
|---|---|---|---|
| `hero` | Full-screen hero banner with tagline | Free (object-cover) | `hero/hero-main.jpg` |
| `gallery-left` | Photo pair section, left (larger image) | 50vh max | `portfolio/ayushi-parth/03.jpg` |
| `gallery-right` | Photo pair section, right (offset down) | 50vh max | `portfolio/alex-aziz/05.jpg` |
| `investment-image` | Investment CTA, left of pricing text | 50vh max | `portfolio/shuba-rob/02.jpg` |
| `bottom-landscape` | Gallery section, wide image on top | 16:9 crop | `portfolio/meghna-puneeth/06.jpg` |
| `bottom-portrait-left` | Gallery section, left portrait | 3:4 crop | `portfolio/priyanka-saurav/03.jpg` |
| `bottom-portrait-right` | Gallery section, right portrait (offset) | 3:4 crop | `portfolio/natalie-shavar/13.jpg` |

## File Structure

```
src/
  assets/images/          — All images (processed by Astro image pipeline)
    hero/, portfolio/, locations/, about/, placeholder/
  data/                   — JSON data files
    site.json, packages.json, portfolio.json, locations.json,
    testimonials.json, faq.json, navigation.json
  content/blog/           — Markdown blog posts (Astro content collections)
  content.config.ts       — Blog collection schema (at src/ root)
  scripts/
    scroll-reveal.ts      — IntersectionObserver for .reveal elements
    sound-manager.ts      — Lazy audio system, sessionStorage state
  components/
    ui/                   — Button, PricingCard, TestimonialCard, LocationCard,
                            PortfolioCard, FAQAccordion, FloatingInput,
                            FloatingSelect, FloatingTextarea
    global/               — Header, Nav, MobileMenu, Footer, SoundToggle, SplashOverlay
    seo/                  — SEO, JsonLd, Breadcrumbs
    forms/                — ContactForm (uses Floating* components)
    gallery/              — GalleryGrid, GalleryImage, Lightbox, YouTubeEmbed
    portfolio/            — RelatedGalleries
  layouts/                — BaseLayout, BlogLayout
  pages/                  — All routes
  styles/global.css       — Design tokens (@theme), type scale, layout utilities, animations
public/
  fonts/                  — Self-hosted woff2 (13 files: 3 serif families + 2 sans)
  sounds/                 — Ambient sound files (placeholder)
  _headers, _redirects    — Cloudflare Pages config
  favicon.svg, og-default.jpg
```

## Component API Quick Reference

### Button.astro
```
Props: href?, variant ('primary'|'secondary'|'ghost'), class?
```

### PortfolioCard.astro
```
Props: couple, location, category, coverImage (ImageMetadata), href
```

### PricingCard.astro
```
Props: name, price (number|null), salePrice?, description, highlights (string[]),
       popular?, featured?, custom?, id
```

### TestimonialCard.astro
```
Props: name, event, quote, rating
Renders: serif italic quote, label-md attribution. No card container.
```

### FAQAccordion.astro
```
Props: items ({question, answer}[])
Renders: details/summary accordion, serif headings, rotating + icon
```

### FloatingInput.astro / FloatingTextarea.astro
```
Props: id, name, label, type? ('text'), required?, rows? (textarea only)
Renders: bottom-border input with floating label
```

### FloatingSelect.astro
```
Props: id, name, label, options ({value, label}[]), required?
```

### BaseLayout.astro
```
Props: title, description, ogImage?, ogType?, canonicalUrl?, noIndex?,
       jsonLd?, transparentHeader? (false), showSplash? (false), article?
```

## Data Architecture
- **Blog**: Astro Content Collections (Markdown in `src/content/blog/`, schema in `src/content.config.ts`)
- **Portfolio, Packages, Testimonials, Locations, FAQ, Nav**: JSON files in `src/data/`
- **Site Config**: `src/data/site.json` (name, URL, location, social links, areas served)

## SEO Infrastructure (Preserve Always)
- Schema.org structured data: LocalBusiness, ImageGallery, BlogPosting, Service, OfferCatalog, Review, VideoObject, FAQPage
- OpenGraph and Twitter Card meta tags on every page
- Canonical URLs and sitemap generation (@astrojs/sitemap)
- Breadcrumb navigation with schema markup
- All existing URLs must be maintained (no broken links on redesign)

## Performance Budget

| Metric | Target |
|---|---|
| LCP | < 2.5s |
| FID/INP | < 100ms |
| CLS | < 0.1 |
| Above-fold page weight | < 500KB |
| Font files (active mood) | < 80KB |
| Sound files (all) | < 150KB |

Image targets: Hero 150KB AVIF, thumbnail 40KB, cover 20KB. Astro generates AVIF/WebP at serve time. Use `surface-container` (#e4e2e1) as placeholder background during load.

## Known Issues
- ContactForm: Formspree ID is placeholder (`YOUR_FORMSPREE_ID`)
- Sound files: silent placeholders, need real ambient sounds
- Cloudflare Analytics: token is placeholder (`YOUR_CF_ANALYTICS_TOKEN`)
- /og-default.jpg: may need updating for new brand
- Some portfolio entries have `startingAt: null` for pricing
- Old "KashKlicks" references may remain in blog content, docs, and .claude/ config files

## Priority Stack
1. Core Web Vitals / page speed (photography = image-heavy, perf is existential)
2. SEO fundamentals (organic growth is the primary acquisition channel)
3. Visual quality (editorial gallery aesthetic — the site IS the portfolio)
4. Conversion paths (transparent pricing, clear CTAs, inquiry flow)
5. Content velocity (blog cadence, portfolio updates, location guides)
