# KashKlicks Studios: "The Digital Curator" Redesign Spec

> **Status:** Approved for implementation
> **Approach:** Progressive reskin (Approach B) -- new design system first, then page-by-page conversion preserving existing data/SEO infrastructure
> **Stack:** Astro 5.18+ / Tailwind CSS 4.2+ / Cloudflare Pages / Sharp / GLightbox

---

## 1. Creative North Star

**"The Digital Curator"** -- the site should feel like walking through a hushed, sun-drenched gallery. Every design decision serves the photograph. The interface is quiet, architectural, and intentional. Typography and white space do the heavy lifting. Nothing competes with the image.

**Brand voice:** Warm, personal, honest, cinematic. Never corporate, never stiff, never "wedding template."

**Key phrase:** "Moments fade. Memories don't."

---

## 2. Color System: Tonal Atmosphere

The palette uses a warm-light spectrum. Luxury comes from stone and taupe tones, not metallic effects. Zero gold.

### 2.1 Surface Hierarchy

Depth is achieved through tonal layering, not shadows. Think of the UI as physical layers of paper stacked on each other.

| Token | Hex | Role |
|---|---|---|
| `background` | `#faf9f6` | Primary canvas. The "gallery wall." |
| `surface` | `#ffffff` | Cards, elevated containers, form backgrounds |
| `surface-dim` | `#f4f4f0` | Section alternation. Testimonial blocks, alternate rows. |
| `surface-container` | `#e4e2e1` | Image placeholders before load. Subtle gradient backgrounds. |
| `surface-dark` | `#2c2824` | Splash page, CTA sections, footer, dark hero overlays |

### 2.2 Text Hierarchy

| Token | Hex | Role |
|---|---|---|
| `on-surface` | `#1a1a18` | Primary headings and body text |
| `on-surface-variant` | `#5c605c` | Secondary text, labels, captions, nav items |
| `on-surface-muted` | `#afb3ae` | Placeholder text, disabled states, ghost borders |
| `on-dark` | `#faf9f6` | Text on dark surfaces |
| `on-dark-variant` | `#d4ccc2` | Secondary text on dark surfaces |

### 2.3 Interactive

| Token | Hex | Role |
|---|---|---|
| `primary` | `#5f5e5e` | Buttons, active nav, links |
| `primary-hover` | `#4a4948` | Button/link hover state |
| `outline-ghost` | `rgba(175, 179, 174, 0.15)` | Input borders, accessibility edges |
| `outline-focus` | `rgba(95, 94, 94, 0.5)` | Focus ring for accessibility |

### 2.4 Color Rules

- **No-Line Rule:** Never use 1px solid borders to section content. Sections are separated by surface color shifts or 64px+ vertical white space.
- **Ghost Borders:** If a boundary is required for accessibility (inputs, focus states), use `outline-ghost`. A border should be felt, not seen.
- **Tonal Layering:** A "raised" element is a lighter surface on a darker one. A card (`surface`) sits on a section (`surface-dim`).
- **Ambient Shadow:** Floating elements only (FAB, glassmorphism nav). Use `on-surface` at 4% opacity, 32px blur radius. Soft glow, not a drop shadow.
- **Signature Gradient:** For large-scale backgrounds, use subtle 45-degree linear gradient from `background` to `surface-container` to mimic gallery wall lighting.

---

## 3. Typography: Editorial Authority

Typography creates tension between a high-contrast serif (editorial authority) and a utilitarian sans-serif (modern clarity).

### 3.1 Font Mood System

Three interchangeable font pairings are defined. Switching moods is a single CSS custom property change. The active mood is set via `--font-mood` on `:root`.

| Mood | Display/Heading (Serif) | Body (Sans) | Vibe |
|---|---|---|---|
| `cormorant` | Cormorant Garamond | Inter | Classic editorial. Vogue mastheads. Gorgeous italics. |
| `fraunces` | Fraunces | Inter | Artistic, organic, quirky. Variable optical size. Most abstract. |
| `bodoni` | Bodoni Moda | Instrument Sans | High-fashion. Extreme thick/thin contrast. Art book. |

**Default mood:** To be determined during implementation (try all three, pick what feels right).

All three serif fonts and both sans fonts must be self-hosted as woff2 in `/public/fonts/`. No Google Fonts CDN calls.

### 3.2 Type Scale

| Token | Size | Weight | Tracking | Line Height | Usage |
|---|---|---|---|---|---|
| `display-lg` | clamp(3rem, 6vw, 5.5rem) | 400 | -0.02em | 1.05 | Splash page, hero statements |
| `display-md` | clamp(2.25rem, 4.5vw, 4rem) | 400 | -0.02em | 1.1 | Page titles ("Investment", "Portfolio") |
| `heading-lg` | clamp(1.75rem, 3vw, 2.5rem) | 400 | -0.01em | 1.2 | Section headings |
| `heading-md` | clamp(1.25rem, 2vw, 1.75rem) | 500 | 0 | 1.3 | Sub-section headings |
| `body-lg` | 1.125rem | 400 | 0 | 1.7 | Primary body text. Generous line height for airiness. |
| `body-md` | 1rem | 400 | 0 | 1.6 | Secondary body text |
| `label-md` | 0.8125rem | 500 | 0.1em | 1.4 | Navigation, labels, captions. ALL-CAPS. Architectural signage. |
| `label-sm` | 0.6875rem | 500 | 0.12em | 1.4 | Micro labels, form field labels. ALL-CAPS. |
| `quote` | clamp(1.5rem, 3vw, 2.25rem) | 400 italic | -0.01em | 1.4 | Pull quotes, testimonials. Serif italic. |

### 3.3 Typography Rules

- Display and heading tokens always use the serif font.
- Body and label tokens always use the sans font.
- Quote token uses the serif font in italic.
- Labels (`label-md`, `label-sm`) are always uppercase with wide letter-spacing to mimic architectural signage.
- No em dashes or en dashes in any copy. Use commas, periods, or sentence restructuring.
- `body-lg` paragraphs: max-width of 65ch for optimal readability.

---

## 4. Layout System: Intentional Asymmetry

The layout system breaks the standard centered grid. Content is deliberately offset, creating tension between elements and negative space.

### 4.1 Grid Foundation

Base grid: 12 columns with 24px gutters (desktop), 16px gutters (mobile).

Container max-width: `1440px` with `clamp(1.5rem, 4vw, 6rem)` horizontal padding.

### 4.2 Asymmetric Patterns

These are the repeatable layout patterns drawn from the reference design:

**Pattern: Hero Split**
- Heading spans columns 1-5, body text spans columns 7-12 (or vice versa).
- The gap (column 6) is intentional negative space.

**Pattern: Editorial Stagger**
- Large image (8 columns) on one side, small text block (3-4 columns) on the other, vertically offset so the text aligns to the image's lower third.
- Alternates sides on each row.

**Pattern: Bento Gallery**
- Mixed-size image grid. Never uniform. Typical: one 8-col image, two 4-col images below, then reverse.
- Gaps between images: 8px (tight, magazine-spread feel).

**Pattern: Centered Statement**
- Full-width centered text for quotes, philosophy sections, CTAs.
- Max-width 800px. Serif italic. Generous vertical padding (120px+).

**Pattern: Feature List**
- Left column: heading + bullet list. Right column: single large image.
- Or reversed. Always asymmetric.

### 4.3 Spacing Scale

Vertical rhythm uses large increments. Sections breathe.

| Token | Value | Usage |
|---|---|---|
| `space-section` | clamp(80px, 10vw, 160px) | Between major page sections |
| `space-block` | clamp(48px, 6vw, 96px) | Between content blocks within a section |
| `space-element` | 24px | Between related elements (heading to body) |
| `space-tight` | 8px | Gallery gaps, tight groupings |

### 4.4 Layout Rules

- No standard "3-column card row." If showing 3 items, use varied column widths (e.g., 5-col, 3-col, 4-col).
- Embrace the void. If a section feels empty, it's correct. Negative space is a luxury signal.
- Cards and list items separated by 48-64px white space, never divider lines.
- All images are rectangular, no rounded corners, no border-radius anywhere.

---

## 5. Components: Understated Interaction

### 5.1 Buttons

| Variant | Background | Text | Border | Usage |
|---|---|---|---|---|
| Primary | `primary` | `on-dark` | none | Main CTAs ("Begin the Inquiry", "View Portfolio") |
| Secondary | transparent | `primary` | `outline-ghost` | Secondary actions ("Download Portfolio") |
| Ghost | transparent | `on-surface-variant` | none | Tertiary actions, nav links |

All buttons: square edges (0 radius), no icons unless necessary, uppercase `label-md` text. Hover: 500ms fade to `primary-hover`. Padding: 16px 32px (primary), 12px 24px (secondary).

### 5.2 Cards

No divider lines. No borders. Separation via white space (48-64px vertical).

- **Portfolio Card:** Image fills container, title below in `heading-md` serif, subtitle in `label-md` sans uppercase. No overlay on hover; instead, image scales subtly (102%) over 600ms.
- **Pricing Card:** `surface` background on `surface-dim` section. Package name in `heading-md` serif italic. Price in `display-md` serif. Details in `body-md` sans. CTA button at bottom.
- **Testimonial Card:** No card container. Quote in `quote` token (serif italic), attribution in `label-md` sans uppercase below.

### 5.3 Input Fields

- Bottom-border only, using `outline-ghost`.
- On focus: border transitions to `primary` at 100% opacity over 500ms.
- Label starts as placeholder (`body-md`), floats up to `label-sm` above the line on focus.
- No background color, no box, no rounded corners.

### 5.4 Navigation (Glassmorphism)

**Desktop:**
- Fixed position, floating above content.
- Background: `background` at 80% opacity with 20px backdrop-blur.
- Logo left (serif display font, stylized "KK" or full "KashKlicks").
- Nav items center/right in `label-md` (uppercase, tracked).
- Active page indicator: subtle underline or font weight shift, not a background highlight.
- On scroll: slight shadow appears (ambient glow, 4% opacity).

**Mobile:**
- Hamburger icon left, centered logo, CTA icon right.
- Menu slides in as full-screen overlay with `surface-dark` background.
- Nav items stacked, `heading-md` serif, generous spacing.
- Close button: simple X, top-right.

### 5.5 Footer

Minimal. `surface-dark` background with `on-dark` text.
- Brand name + one-line description (serif).
- Two columns: Connect (Instagram, Pinterest) and Information (links).
- Copyright line at bottom in `label-sm`.
- No decorative elements. Pure architecture.

### 5.6 FAQ Accordion

- Question in `heading-md` serif.
- Expand/collapse icon: simple `+` that rotates to `x` over 600ms.
- No borders between items. 48px vertical spacing.
- Answer in `body-lg` sans with 24px top padding when expanded.

---

## 6. Elevation & Depth: Tonal Layering

No material design shadows. No drop shadows. Depth is physical: lighter surfaces on darker ones.

### 6.1 Layering Principle

```
Page background (#faf9f6)
  -> Section background (#f4f4f0)
    -> Card surface (#ffffff)
```

Each layer is a sheet of paper. Moving "up" means moving lighter.

### 6.2 Ambient Shadow

Only for floating elements (nav bar, scroll-to-top FAB if added):
- Color: `on-surface` at 4% opacity
- Blur: 32px
- Spread: 0
- Offset: 0 4px

### 6.3 Ghost Border

When accessibility requires a visible boundary:
- Color: `outline-ghost` (afb3ae at 15% opacity)
- Width: 1px
- Applied to: input fields (bottom only), focus rings, keyboard navigation indicators

---

## 7. Motion & Soul

The interface feels heavy and intentional. Nothing snaps. Everything flows like wind in slow motion.

### 7.1 Easing & Duration

| Token | Value | Usage |
|---|---|---|
| `ease-gallery` | `cubic-bezier(0.22, 1, 0.36, 1)` | All standard transitions |
| `duration-slow` | `600ms` | Default transition duration |
| `duration-hover` | `500ms` | Hover state changes |
| `duration-page` | `800ms` | Page transitions |
| `duration-splash` | `1200ms` | Splash page entrance/exit |

### 7.2 Page Transitions

When navigating between pages:
1. Current content fades to `surface-dim` opacity over `duration-page`.
2. New content enters at 98% scale, fading in and scaling to 100% over `duration-page`.
3. Uses Astro View Transitions API.

### 7.3 Scroll Animations

- Elements enter viewport with a subtle fade-up (20px translate-y to 0, opacity 0 to 1) over `duration-slow`.
- Stagger children: each subsequent element delays by 100ms.
- Use `IntersectionObserver`, not scroll-linked animations (performance).
- Respect `prefers-reduced-motion`: disable all animations, show content immediately.

### 7.4 Hover States

- Buttons: background color fade over `duration-hover`.
- Portfolio images: scale to 102% over `duration-slow`.
- Links: no underline by default; underline fades in from left over `duration-hover`.
- Cards: no movement. Stillness is the default; only the image within breathes. Exception: `PricingCard` lifts 4px + soft shadow on hover (`card-lift`).

### 7.5 Service Page Micro-interactions

These primitives are standard on every service sub-page (pre-wedding, wedding, civil-ceremony, celebrations). They respect `prefers-reduced-motion`.

| Class | What it does | Where to use it |
|---|---|---|
| `parallax-img` | 8%-of-viewport vertical drift on scroll | Applied to `<Image>` itself on hero, service-detail, editorial interlude, CTA portraits |
| `image-caption` + `data-caption="..."` | Label-sm caption fades in bottom-left on hover | Wrapper div of feature portraits |
| `eyebrow-rule` (+ `eyebrow-rule-center`, + `eyebrow-rule-on-dark`) | 40px hairline draws under the eyebrow label in 800ms when parent `.reveal` enters viewport | Every `text-label-md text-on-surface-muted` eyebrow. Centered variant inside `text-center` containers; `-on-dark` modifier swaps the rule to `on-dark-variant` for legibility on `bg-surface-dark` sections |
| `card-lift` | 4px rise + soft shadow on hover over 600ms | Pricing cards (already baked in) |
| `char-reveal` | Per-character fade on scroll | Service description `text-display-md` title only (don't overuse) |
| `magnetic` | Cursor-magnetism pull | CTA buttons |
| `hover-zoom` | 2.5s scale(1.04) on image hover | Wrapper div that contains a child `<img>` (won't work if applied to `<Image>` directly, since `<Image>` renders as a single `<img>`) |

**Where the accent line lives:** On the eyebrow label (the muted all-caps label above a serif title), NOT on the serif title itself. The editorial rhythm is: muted label + hairline → serif headline → body.

---

## 8. Sound System

Sound is a first-class design element, not an afterthought. Muted by default. Opt-in only.

### 8.1 Sound Toggle

- Small, elegant icon in the bottom-right corner of the viewport (or integrated into the nav).
- Icon: abstract sound wave or minimal speaker icon in `on-surface-muted`.
- Default state: muted. No sound plays until the user explicitly clicks the toggle.
- State persisted in `sessionStorage` (respects the "once per session" splash page pattern).

### 8.2 Sound Design

| Trigger | Sound | Character |
|---|---|---|
| Splash page ambient | Low, warm drone + soft vinyl crackle | 5-8 seconds, loops subtly |
| Page transition | Soft "whoosh" or paper-turn | < 1 second, barely perceptible |
| Image lightbox open | Gentle shutter click | < 0.5 seconds |
| Hover on portfolio (optional) | Faint tonal shift | < 0.3 seconds, extremely subtle |

### 8.3 Sound Rules

- All sounds are compressed, tiny files (< 50KB each). Web-optimized MP3 or OGG.
- No music. No melody. Only ambient texture and micro-interactions.
- Volume: low. The user should question whether they heard it.
- Sounds load lazily, never block page render or affect Core Web Vitals.
- If `prefers-reduced-motion` is set, sound toggle is hidden entirely.

---

## 9. Splash Page (Gateway)

A full-viewport cover page. The book's cover before you open it.

### 9.1 Behavior

- Shows once per session (`sessionStorage` flag).
- Returning visitors (within same session) or direct navigation to inner pages bypass it.
- Auto-plays a 3-5 second ambient moment (visual only, sound only if toggled on).
- After the ambient moment, a CTA fades in to enter the site.

### 9.2 Layout

- Full viewport height and width. No scroll.
- Background: full-bleed hero image or slow Ken Burns pan on a signature photo.
- Center: KashKlicks logo in display serif, large.
- Below logo: tagline "Moments fade. Memories don't." in `label-md` uppercase tracked.
- After delay: "Enter" or "View the Collection" CTA button fades in from opacity 0 over `duration-splash`.
- Optional: subtle particle or light-leak overlay animation for atmospheric depth.

### 9.3 Transition to Homepage

- On CTA click: splash page fades to `surface-dark` over `duration-splash`.
- Homepage content fades in at 98% scale, scaling to 100%.
- Splash page element is removed from DOM after transition.
- `sessionStorage.setItem('kk-splash-seen', 'true')` prevents re-showing.

---

## 10. Responsive Strategy

Mobile is not a degraded desktop. It's the same gallery experience, recomposed for a smaller frame.

### 10.1 Breakpoints

| Token | Value | Context |
|---|---|---|
| `mobile` | 0-639px | Single column, stacked layouts |
| `tablet` | 640-1023px | 2-column where appropriate |
| `desktop` | 1024px+ | Full 12-column grid, asymmetric layouts |

### 10.2 Mobile Adaptations

- Asymmetric layouts collapse to single-column stacks.
- Display type sizes scale down via `clamp()` (already built into type scale).
- Section spacing reduces proportionally via `clamp()`.
- Gallery grids: 2-column on mobile, bento on desktop.
- Navigation: hamburger + full-screen overlay menu.
- Splash page: same behavior, optimized image, potentially shorter ambient delay.

### 10.3 Touch Considerations

- No hover-dependent interactions. All hover effects are enhancements, not requirements.
- Tap targets minimum 44x44px.
- Swipe gestures for gallery lightbox (GLightbox handles this).

---

## 11. Accessibility

Luxury does not compromise accessibility. WCAG 2.1 AA compliance is non-negotiable.

### 11.1 Color Contrast

- `on-surface` (#1a1a18) on `background` (#faf9f6): ratio ~16:1 (passes AAA).
- `on-surface-variant` (#5c605c) on `background` (#faf9f6): ratio ~5.5:1 (passes AA).
- `on-dark` (#faf9f6) on `surface-dark` (#2c2824): ratio ~14:1 (passes AAA).
- `on-surface-muted` (#afb3ae) used only for decorative/placeholder text, never for essential content.

### 11.2 Focus Management

- All interactive elements have visible focus indicators using `outline-focus`.
- Focus ring: 2px solid `outline-focus`, 2px offset.
- Skip-to-content link retained.
- Focus trap on mobile menu overlay and lightbox.

### 11.3 Motion & Sound

- `prefers-reduced-motion`: all animations disabled, content shown immediately, sound toggle hidden.
- Sound is always opt-in, never auto-play audio.
- Page transitions degrade gracefully to instant navigation.

### 11.4 Semantic HTML

- Proper heading hierarchy (h1-h6) maintained on every page.
- Landmark regions (nav, main, footer, aside).
- ARIA labels on interactive elements without visible text.
- Alt text on all images (existing portfolio data already includes this context).

---

## 12. Performance Budget

Photography sites live and die by load speed. The editorial aesthetic cannot come at the cost of Core Web Vitals.

### 12.1 Targets

| Metric | Target |
|---|---|
| LCP | < 2.5s |
| FID/INP | < 100ms |
| CLS | < 0.1 |
| Total page weight (above fold) | < 500KB |
| Font files total | < 200KB (subset to Latin characters) |
| Sound files total | < 150KB (all sounds combined) |

### 12.2 Image Strategy

Existing Astro image pipeline is preserved:
- Source images: 2560px, quality 90, sRGB.
- Astro generates AVIF/WebP at serve time.
- Hero images: target 150KB AVIF.
- Thumbnails: target 40KB.
- Cover images: target 20KB.
- Lazy loading on all images below the fold.
- `surface-container` (#e4e2e1) as placeholder background during load.

### 12.3 Font Loading

- Self-hosted woff2 only. No external CDN.
- `font-display: swap` for all fonts.
- Preload the active mood's serif regular + sans regular (critical fonts).
- Other weights/styles load on demand.

### 12.4 Sound Loading

- Sound files lazy-loaded only after user opts in.
- Never in critical render path.
- Loaded via `Audio()` constructor, not `<audio>` tags in HTML.

---

## 13. SEO Preservation

All existing SEO infrastructure is preserved and enhanced during the redesign:

- Schema.org structured data (LocalBusiness, ImageGallery, BlogPosting, Service, etc.)
- OpenGraph and Twitter Card meta tags
- Canonical URLs and sitemap
- Breadcrumb navigation with schema
- Blog content collections (Markdown)
- All existing URLs maintained (no broken links)

---

## 14. Page Inventory

All existing pages are kept. Pages with reference design equivalents get a full editorial redesign. Pages without a reference equivalent get restyled to match the new design system.

| Page | Treatment | Reference Equivalent |
|---|---|---|
| Splash (NEW) | New page | Gateway/cover |
| Homepage | Full redesign | Homepage reference |
| Portfolio index | Full redesign | Portfolio reference |
| Portfolio [slug] | Full redesign | Weddings Collection reference |
| Portfolio category pages | Full redesign | Derived from portfolio reference |
| About | Full redesign | About/Experience reference |
| Pricing | Full redesign | Investment reference |
| Contact | Full redesign | Inquiry reference |
| Services | Restyle | No reference (editorial restyle) |
| Location Guide | Restyle | No reference (editorial restyle) |
| Blog index | Restyle | No reference (editorial restyle) |
| Blog posts | Restyle | No reference (editorial restyle) |
| Films | Restyle | No reference (editorial restyle) |
| 404 | Restyle | No reference (editorial restyle) |

Content mapping (what content goes on which page) is deferred to implementation phase. The spec defines the design system; page content is composed during build.

---

## 15. Implementation Order

Progressive reskin, foundation first:

1. **Design system foundation** -- global.css tokens, font loading, motion utilities, Tailwind theme
2. **Splash page** -- new page, standalone, tests the full motion/sound system
3. **BaseLayout + Nav + Footer** -- glassmorphism nav, new footer, page transitions
4. **Homepage** -- flagship page, tests all layout patterns and components
5. **Portfolio index** -- asymmetric gallery grid
6. **Portfolio [slug]** -- editorial collection detail pages
7. **Pricing/Investment** -- pricing cards, FAQ accordion
8. **About/Experience** -- editorial bio, process section
9. **Contact/Inquiry** -- form redesign, bottom-border inputs
10. **Services, Location Guide, Blog, Films, 404** -- restyle pass

Each step is a discrete, shippable increment.

---

## 16. Do's and Don'ts (Quick Reference)

### Do:
- Use asymmetry. Offset headings from body text across the grid.
- Embrace the void. If it feels empty, it's correct.
- Slow everything down. 600ms minimum for any transition.
- Let the photograph be the hero. Interface elements are supporting architecture.
- Use tonal layering for depth. Paper on paper.

### Don't:
- No rounded corners. 0px radius everywhere. Non-negotiable.
- No gold, no metallic effects, no "wedding" cliches.
- No 1px solid borders to section content.
- No standard 3-column card grids. Vary the column widths.
- No em dashes or en dashes in copy.
- No auto-playing sound. Always muted by default.
- No hover-dependent functionality. Hover is enhancement only.
