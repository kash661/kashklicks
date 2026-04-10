# KashKlicks Studios - Development Guide

## Project Overview

**Tech Stack:** Astro 5.18+ | Tailwind CSS 4.2+ | Sharp | GLightbox
**Deployment:** Static site (SSG) on Cloudflare Pages
**Fonts:** Playfair Display (headings), DM Sans (body) — self-hosted woff2 in `/public/fonts/`
**Image Pipeline:** `astro:assets` Image component + Sharp for responsive/optimized images
**Live Site:** [kashklicks.ca](https://kashklicks.ca)

---

## Brand Identity

- **Brand:** KashKlicks Studios — Akash's photography & videography brand
- **Tagline:** "Moments fade. Memories don't."
- **Location:** Toronto, serving the entire GTA (Mississauga, Brampton, Markham, Vaughan, Oakville, Burlington) + Canada-wide
- **Specialties:** Pre-wedding, wedding photography, civil ceremonies, celebrations, portraits
- **Tone:** Warm, personal, honest, cinematic — never corporate or stiff. Speak like a friend who happens to be a great photographer.

---

## Design Philosophy — Light & Airy

> The site should feel like sunlight on film — soft, luminous, inviting.

### Color Palette (Light Direction)

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#FDFBF7` | Page background — warm off-white/cream |
| Surface | `#FFFFFF` | Cards, elevated surfaces |
| Text Primary | `#2C2824` | Headings, body text — warm dark, NOT pure black |
| Text Secondary | `#7A7067` | Captions, metadata, secondary copy |
| Accent | `#c8956c` | CTAs, highlights, hover states — warm gold |
| Accent Hover | `#b8845b` | Darker gold for hover/active states |
| Border | `#E8E2DA` | Subtle warm gray dividers and borders |

### Design Principles

1. **Photography is always the hero.** UI recedes. White space is a luxury that lets images breathe.
2. **Art-piece aesthetic.** This is a creative business — the website itself should feel like art. Use asymmetric layouts, editorial typography, full-bleed images.
3. **Light and airy.** Every element should feel weightless. Generous padding, soft shadows (if any), luminous backgrounds.
4. **Warm and welcoming.** The visitor should feel like they're being invited into a beautiful space, not sold to.

### Animation Guidelines

- Subtle, purposeful animations only
- Fade-in on scroll (stagger child elements for rhythm)
- Gentle hover reveals on portfolio cards
- Parallax on hero images (subtle — max 10-15% offset)
- No jarring transitions, no bounce effects, no autoplay video

### Industry References

These are proven patterns from industry leaders — use them as inspiration:
- Flothemes (wedding photographer themes)
- Squarespace Brine template aesthetic
- ShowIt wedding themes
- All use light palettes with generous whitespace and let photos dominate

---

## Creative Guidelines

### Be Bold, Be Data-Driven

Every design decision must be **both creative AND backed by evidence**. Push the design — don't play it safe — but ground bold choices in what works.

### Proven UX Patterns to Follow

- **CTAs above the fold** convert 17% better (Nielsen Norman Group)
- **Social proof near conversion points** increases trust and booking rates
- **F-pattern scanning** for text-heavy pages (blog, services, FAQ)
- **Z-pattern scanning** for landing pages (home, portfolio landing)
- **White space increases comprehension by 20%** (Wichita State University study)
- **Image-to-text ratio:** Photography sites should be 70%+ imagery on portfolio/gallery pages
- **Three-click rule:** Any key action (book, contact, view work) should be reachable in 3 clicks or fewer

### Design Decisions Checklist

Before implementing any design change, ask:
1. Does this let the photography shine?
2. Is there data or a proven pattern supporting this choice?
3. Does this feel warm and inviting, or cold and corporate?
4. Would this feel at home in a high-end photography portfolio?
5. Is the white space generous enough?

---

## UX Best Practices

### Navigation & Wayfinding

- **Every page needs obvious next-steps** — buttons, links, visual cues for what to do next
- **Multiple CTAs per page:** "Book Now", "View My Work", "See Packages" — never make users hunt
- **Sticky header** with prominent "Book Now" CTA
- **Contact form 1 click away** from every page
- **Cross-link aggressively:** Blog <-> Location Guide <-> Services <-> Portfolio <-> Pricing
- **Breadcrumbs** on all inner pages for orientation

### Content Flow

- **Progressive disclosure:** Don't overwhelm — reveal as users scroll
- **Visual hierarchy:** One clear focal point per viewport
- **Scannable content:** Short paragraphs, clear headings, bullet points for details
- **Strong page endings:** Every page ends with a clear CTA section, never a dead end

### Mobile Experience

- **Mobile-first responsive design** — 60%+ of wedding industry traffic is mobile
- Touch targets minimum 44x44px
- Hamburger menu with full-screen overlay
- Swipeable galleries
- Tap-to-call on phone numbers

### Performance Targets

| Metric | Target | Why |
|--------|--------|-----|
| LCP | < 2s | Core Web Vital — impacts SEO ranking |
| INP | < 100ms | Core Web Vital — interaction responsiveness |
| CLS | < 0.1 | Core Web Vital — visual stability |
| Total page weight | < 3MB | Fast load on mobile networks |
| Image format | WebP/AVIF | 30-50% smaller than JPEG at same quality |

---

## SEO & Organic Growth Strategy

### Technical SEO (Every Page)

- Unique `<title>` tag (50-60 chars, keyword + brand)
- Unique `<meta name="description">` (150-160 chars, compelling + keyword-rich)
- Open Graph tags (`og:title`, `og:description`, `og:image`, `og:url`)
- Canonical URL
- JSON-LD structured data

### Schema Types to Use

- `LocalBusiness` — site-wide (Toronto photographer)
- `WebSite` — homepage with search action
- `FAQPage` — contact/FAQ section
- `ImageGallery` — portfolio pages
- `Service` + `Offer` — services and pricing pages
- `Person` — about page
- `BlogPosting` — each blog post
- `Review` — testimonials

### Target Keywords

**Primary:**
- "Toronto wedding photographer"
- "GTA wedding photography"
- "Toronto pre-wedding photography"
- "Toronto engagement photographer"

**Secondary / Long-tail:**
- "[Location] photography Toronto" (e.g., "Aga Khan Museum photography")
- "Best wedding photographer GTA"
- "Affordable wedding photography Toronto"
- "Civil ceremony photographer Toronto"
- "South Asian wedding photographer Toronto"

### Blog Content Strategy

Write content that real people search for:

| Content Type | Example Topics | Target Keywords |
|-------------|----------------|-----------------|
| Location Guides | "10 Best Pre-Wedding Photo Spots in Toronto" | "best photography locations Toronto" |
| What to Wear | "What to Wear for Your Engagement Shoot" | "what to wear pre-wedding shoot" |
| Seasonal | "Fall Engagement Photos in Toronto" | "fall engagement photos Toronto" |
| Planning Tips | "How to Plan Your Wedding Photography Timeline" | "wedding photography timeline" |
| Client Stories | "Priya & Raj's Aga Khan Museum Pre-Wedding" | Location + event type keywords |
| Behind the Scenes | "A Day in the Life of a Toronto Wedding Photographer" | Brand awareness |

### Internal Linking Rules

- Every blog post links to: Services, Portfolio, Contact
- Every location guide links to: relevant portfolio work, booking CTA
- Portfolio pages link to: related services, pricing, similar galleries
- Services links to: portfolio proof, pricing, booking

### Image SEO

- All `alt` text must be descriptive and keyword-aware
- Format: "[Subject description] — [location] [event type] photography by KashKlicks Studios"
- Example: `alt="Bride and groom first look at Aga Khan Museum — Toronto wedding photography by KashKlicks Studios"`
- Sitemap auto-generated via `@astrojs/sitemap`

---

## Packages & Transparency

### Pricing Philosophy

- **All pricing displayed openly** — no "contact for pricing" (except truly custom work)
- Transparency builds trust and filters inquiries to serious clients
- Show value clearly: what's included in each tier

### Service Categories

1. **Pre-Wedding / Engagement** — 5 tiers from basic to premium
2. **Wedding Day** — 3 tiers (photography-focused)
3. **Civil Ceremony** — dedicated packages
4. **Events & Celebrations** — flexible packages

### Contact Form Fields

Capture everything needed to qualify and respond quickly:
- Name, Email, Phone
- Event Date, Event Type
- Budget Range
- Venue (if known)
- How did you hear about us? (referral source — important for tracking growth)

### FAQ Section

Address real concerns transparently:
- Do I get raw/unedited files?
- Are travel fees included?
- What's your rescheduling/cancellation policy?
- I'm not comfortable posing — will you help?
- How long until I get my photos?
- Do you do same-day edits?

---

## Hosting Recommendation

| Feature | Cloudflare Pages | Vercel | Netlify |
|---------|-----------------|--------|---------|
| Free tier bandwidth | **Unlimited** | 100GB | 100GB |
| Free builds/month | 500 | 6000 | 300 |
| Edge CDN | Global (275+ cities) | Global | Global |
| Custom domain SSL | Free | Free | Free |
| Analytics | Free basic | Paid | Paid |
| Forms | Workers (code needed) | Serverless functions | Built-in |
| Best for | **Image-heavy static sites** | Framework deploys | JAMstack + forms |

**Recommendation: Stay with Cloudflare Pages.** Unlimited bandwidth is critical for a photography site serving high-res images. Best price/quality ratio. For forms, use Formspree or Cloudflare Workers.

---

## File & Image Conventions

### Directory Structure

```
src/
  assets/images/
    hero/           — Homepage hero images
    portfolio/      — Portfolio covers and galleries
    locations/      — Location guide photos
    about/          — Portrait/about page images
    placeholder/    — Instagram/temp placeholders
  data/             — JSON data files (site config, packages, portfolio, locations, FAQ, testimonials, nav)
  content/blog/     — Markdown blog posts (Astro content collections)
  components/
    ui/             — Reusable UI components (Button, SectionHeading, PricingCard, etc.)
    global/         — Header, Nav, MobileMenu, Footer
    seo/            — SEO, JsonLd, Breadcrumbs
    forms/          — ContactForm
    gallery/        — GalleryGrid, GalleryImage, Lightbox
  layouts/          — BaseLayout, BlogLayout
  pages/            — All routes
  styles/           — global.css
```

### Existing Components

Reuse these — do not duplicate functionality:

| Component | Path |
|-----------|------|
| Button | `src/components/ui/Button.astro` |
| SectionHeading | `src/components/ui/SectionHeading.astro` |
| PricingCard | `src/components/ui/PricingCard.astro` |
| TestimonialCard | `src/components/ui/TestimonialCard.astro` |
| LocationCard | `src/components/ui/LocationCard.astro` |
| PortfolioCard | `src/components/ui/PortfolioCard.astro` |
| ContactForm | `src/components/forms/ContactForm.astro` |
| SEO | `src/components/seo/SEO.astro` |
| JsonLd | `src/components/seo/JsonLd.astro` |
| Breadcrumbs | `src/components/seo/Breadcrumbs.astro` |
| GalleryGrid | `src/components/gallery/GalleryGrid.astro` |
| GalleryImage | `src/components/gallery/GalleryImage.astro` |
| Lightbox | `src/components/gallery/Lightbox.astro` |
| BaseLayout | `src/layouts/BaseLayout.astro` |
| BlogLayout | `src/layouts/BlogLayout.astro` |

---

## Known Issues

These need attention in future work:

- `ContactForm.astro` — Formspree ID is placeholder (`YOUR_FORMSPREE_ID`)
- `index.astro` — Instagram section uses empty placeholder divs
- `services.astro` — Service images are empty placeholder divs
- `blog/index.astro` — Blog cards show empty div instead of cover images
- `/og-default.jpg` — Referenced in SEO component but may not exist in `/public/`
- Civil ceremony and wedding day services show `startingAt: null`
- Portfolio entries only have 1 cover image each — no individual gallery pages yet
- Dark-to-light palette migration not yet done (design tokens in `global.css` need updating)

---

## Live Site Photo Inventory

84 unique photos found on the current Webflow site (kashklicks.ca), all hosted on Webflow CDN. Key breakdown:

| Page | Unique Photos | Notes |
|------|--------------|-------|
| Homepage | 23 | Hero slider, portfolio preview grid, testimonials |
| Services | 11 | Service category headers and feature images |
| Location Guide | 25 | Most image-heavy page — location-specific shots |
| Pricing | 8 | Mostly logos/icons, 1 testimonial background |
| Contact | 1 | Newsletter checkbox icon |
| Blog | 1 | Check icon |
| Footer (all pages) | 2 | Instagram grid preview images |
| Site-wide | 13 | Logos, icons, shared feature images |

**Note:** Portfolio and About pages load content dynamically via JavaScript — their images aren't in the static HTML. A headless browser crawl would be needed to capture those.

All photos use the naming convention from the camera (e.g., `XT953811.jpg`, `DSCF6054.jpg`, `Preet-146.jpeg`). When migrating to Astro, rename images descriptively for SEO (e.g., `toronto-engagement-aga-khan-museum.jpg`).
