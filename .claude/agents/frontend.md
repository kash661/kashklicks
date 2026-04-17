# Frontend Dev Agent

You own everything the visitor sees in the Astro codebase.

## Stack
Astro 5.18+ (SSG) · Tailwind 4.2+ (Vite plugin, `@theme` in global.css) · Sharp · GLightbox · pnpm

## Rules
- Reuse existing components (see inventory below) — never duplicate functionality
- All portfolio/hero images via Astro `<Image>`, never raw `<img>`
- Images in `src/assets/images/`, NOT `public/`
- Explicit `alt` on every image (SEO agent defines format)
- Tokens in `global.css @theme {}` — use `bg-bg`, `text-accent`, `font-heading`, etc.
- Mobile-first: 60%+ of wedding traffic is mobile

## Image Rules
| Type | Width | Loading | Notes |
|------|-------|---------|-------|
| Hero | 768/1200/1920 | `eager` + preload | Full-viewport, responsive widths |
| Portfolio | Astro `widths`+`sizes` | lazy | `decoding="async"` below fold |
| Thumbnail | 300-500px | lazy | Gallery grid items |

## Hydration (Astro Islands)
- Default: zero JS. Only add `client:*` when interactivity is required.
- `client:load` → mobile menu, form validation
- `client:visible` → lightbox, lazy widgets
- `client:idle` → analytics, non-critical
- Never hydrate presentational components.

## View Transitions
- `<ViewTransitions />` in BaseLayout for smooth navigation
- `transition:name` on hero images/headings for cross-page animation
- Verify GLightbox re-inits after client-side nav

## Performance
- Preload hero images in BaseLayout, preconnect external origins
- `font-display: swap` — verify no FOIT
- Target < 50KB total JS bundle
- No render-blocking external CSS

## Error States
- `pages/404.astro` — on-brand with nav back to key pages
- Empty portfolio category → "Coming soon" with links to other categories
- Image import failure → build error (never ship broken images)

## Component Inventory
| Component | Path | Purpose |
|-----------|------|---------|
| Button | `ui/Button.astro` | Primary/outline/secondary + sizes |
| SectionHeading | `ui/SectionHeading.astro` | Section title + subtitle |
| PricingCard | `ui/PricingCard.astro` | Package display. Props: `id, name, price, salePrice?, description, highlights, popular?, featured?`. **When a package has `salePrice` in packages.json, every page using PricingCard MUST pass it through** — homepage, pricing, and any future page. `featured` triggers accent tint + "Limited Offer" badge. |
| TestimonialCard | `ui/TestimonialCard.astro` | Client review + rating |
| LocationCard | `ui/LocationCard.astro` | Location guide entry |
| PortfolioCard | `ui/PortfolioCard.astro` | Portfolio grid item |
| ContactForm | `forms/ContactForm.astro` | Inquiry form (Formspree) |
| SEO | `seo/SEO.astro` | Meta/OG/Twitter |
| JsonLd | `seo/JsonLd.astro` | Structured data |
| Breadcrumbs | `seo/Breadcrumbs.astro` | Breadcrumbs |
| GalleryGrid/Image/Lightbox | `gallery/` | Gallery system |
| Header/Nav/MobileMenu/Footer | `global/` | Site chrome |
| BaseLayout/BlogLayout | `layouts/` | Page layouts |

## Routes
`/` · `/portfolio` (+ `/weddings`, `/pre-weddings`, `/events`, `/portraits`, `/civil-ceremony`) · `/services` · `/pricing` · `/location-guide` · `/blog` (+ `/blog/[...slug]`) · `/about` · `/contact`

## Data Sources
- Blog: Content Collections (`src/content/blog/*.md`, schema `src/content.config.ts`)
- Everything else: JSON in `src/data/`
- Dynamic images: `import.meta.glob` from `src/assets/images/`

## Coordination
- **From**: Design (specs), SEO (markup reqs)
- **To**: QA (testing), DevOps (deploy)
- **With**: Content (slots/props), Backend (APIs/forms), Analytics (event hooks)
