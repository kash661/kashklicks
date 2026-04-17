# Homepage Redesign: Gallery Walk + Magazine Spread

## Overview
Redesign the homepage as an image-forward scroll experience. A visitor scrolls through a curated selection of the best photos across all shoots, with text moments, CTAs, and a review woven in naturally. The page should feel like walking through a gallery that also answers every question a potential client might have.

## Logo Behavior
- AD logo click always navigates to `/` (homepage). Already correct.
- Splash overlay remains: shows once per first site visit via sessionStorage. Logo clicks never re-trigger it.

## Section Layout (scroll order)

### 1. Hero
- Full viewport height (100vh)
- Single fixed image, edge-to-edge
- Small gallery-style caption, bottom-left:
  - **Couple name** (e.g., "Ayushi & Parth")
  - **Location, Year** (e.g., "Toronto, 2025")
- No buttons, no tagline, no overlay text. Just the photo and its label.
- Caption styled like a museum placard: `text-label-md` or smaller, light on dark gradient

### 2. Photo Pair + Text Moment
- Two images side by side, asymmetric widths (7-col + 5-col on grid-editorial)
- Short editorial text below or beside the images
- Different couples/shoots represented

### 3. Full-Bleed Single Image
- One standout shot, full width, no text
- Maximum breathing room (generous vertical padding)

### 4. Investment CTA
- On gallery-wall background (`background` token), not a dark block
- Short text moment + Button linking to `/investment`
- Understated, part of the scroll rhythm

### 5. Two More Photos (Magazine Spread)
- Different layout from section 2: one large (8-col) + one small (4-col) stacked vertically beside it
- Creates visual variety and magazine-spread feel

### 6. Review
- Single testimonial, serif italic (`text-quote`)
- Reviewer name + event type below
- Centered, max-width constrained
- Pulled from `testimonials.json`

### 7. Contact CTA
- Dark surface block (`bg-surface-dark`)
- Heading + Button linking to `/contact`
- Clear, final conversion point

### 8. Final Image
- One last photo as a closing statement
- Full width or near-full
- The "last piece on the gallery wall before you leave"
- No text needed

## Scroll Interactions (all five, layered)

### Scroll-Triggered Reveals
- Images fade up and slide in as they enter viewport
- Direction varies by grid position: left-aligned images reveal from left, right-aligned from right
- Uses existing `reveal` class system, extended with directional variants (`reveal-left`, `reveal-right`)

### Subtle Parallax
- Images move slightly slower than scroll speed (5-10% offset)
- Creates floating depth effect
- CSS `transform: translateY()` driven by scroll position via lightweight JS
- Performance: use `will-change: transform` and `requestAnimationFrame`

### Gentle Scale on Scroll
- Images enter at 98% scale, ease to 100% as they become fully visible
- Tied to IntersectionObserver ratio, not a fixed animation
- Uses `var(--ease-gallery)` cubic-bezier

### Hover: Quiet Zoom (desktop only)
- On hover, image zooms in 2-3% with 600ms ease (`var(--duration-slow)`)
- `overflow: hidden` on container to clip the zoom
- No hover-dependent functionality, just enhancement

### Staggered Entrance
- Side-by-side images: left reveals ~150ms before right
- Uses existing `stagger-1` through `stagger-5` system
- Creates a visual rhythm/heartbeat as you scroll

## Images
- All images served via `astro:assets` Image component (AVIF/WebP)
- Hero image: manually chosen, imported directly
- Gallery images: curated best-of selection, imported directly (not from portfolio.json)
- Placeholder background: `surface-container` (#e4e2e1) during load

## What's Removed from Current Homepage
- "Intro / The Approach" two-column text section
- "Curated Collections" portfolio card grid
- "Approach Pillars" (Intimate, Candid, Calm)
- Current testimonial section (replaced by new Review section)
- Current CTA section (replaced by split Investment + Contact CTAs)

## What's Preserved
- BaseLayout with `showSplash={true}` on homepage
- JSON-LD structured data (WebSite + Review schemas)
- SEO meta tags via SEO component
- Scroll reveal system (extended, not replaced)
- Sound system integration
- View transitions

## Design Constraints (from CLAUDE.md)
- No rounded corners (0px radius everywhere)
- No gold or metallic effects
- No 1px solid borders for sections
- No standard 3-column card grids
- No em dashes or en dashes in copy
- No hover-dependent functionality
- Asymmetric layouts preferred
- 600ms minimum transitions
- Use design token classes, not raw Tailwind sizes
