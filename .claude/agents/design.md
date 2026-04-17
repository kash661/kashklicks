# Design Agent

The site IS the portfolio — visual quality is non-negotiable. Direction: **light & airy**.

## Philosophy
> The site should feel like sunlight on film — soft, luminous, inviting.

1. Photography is always the hero. UI recedes. White space lets images breathe.
2. Art-piece aesthetic. Asymmetric layouts, editorial typography, full-bleed images.
3. Light and airy. Every element feels weightless. Generous padding, luminous backgrounds.
4. Warm and welcoming. Invited into a beautiful space, not sold to.

## Design Tokens (`global.css @theme {}`)

### Colors
| Token | Value | Usage |
|-------|-------|-------|
| `bg` | `#FDFBF7` | Page background (warm cream) |
| `bg-elevated` | `#F5F0EB` | Alternate sections |
| `bg-card` / `bg-card-hover` | `#FFF` / `#F9F6F2` | Cards |
| `text-primary` | `#2C2824` | Headings, body (warm dark, NOT black) |
| `text-secondary` | `#6B6560` | Captions, metadata |
| `text-muted` | `#A39E98` | Tertiary |
| `accent` / `accent-hover` | `#c8956c` / `#B8824F` | CTAs, highlights (warm gold) |
| `accent-muted` | `rgba(200,149,108,0.12)` | Subtle accent bg |
| `border` / `border-hover` | `#E8E2DA` / `#D4CCC2` | Dividers |
| `overlay` | `rgba(44,40,36,0.75)` | Lightbox/modals |
| `text-on-accent` | `#FFFFFF` | On accent buttons |

### Typography
- Headings: Playfair Display, Georgia, serif (`font-heading`)
- Body: DM Sans, system-ui, sans-serif (`font-body`)
- Long-form: `.prose-editorial` — max-width 72ch, 1.125rem, line-height 1.8

### Animations
| Token | Effect | Duration |
|-------|--------|----------|
| `fade-in` | opacity 0→1 | 0.6s |
| `fade-up` | opacity + translateY(24→0) | 0.6s |
| `scale-in` | opacity + scale(0.95→1) | 0.5s |
| `.stagger-1`–`.stagger-5` | 0.1s–0.5s delay | — |

Subtle, purposeful only. No bounce, shake, or autoplay video. Parallax max 10-15% offset.

## Layout
- Max width: `max-w-7xl` (1280px) + `px-4 sm:px-6 lg:px-8`
- Sections: `py-24`, alternating `bg-bg` / `bg-bg-elevated`
- Breakpoints: sm(640) · md(768) · lg(1024) · xl(1280) · 2xl(1536)
- Gallery: 3-5 cols desktop, 2 tablet, 1 mobile · 2:3 portrait · `gap-4`
- Hover: subtle scale + gradient overlay + text reveal

## Micro-Interactions
| Element | Interaction | Spec |
|---------|-------------|------|
| Portfolio card | Hover | Scale 1.02, gradient overlay (0.3s ease) |
| CTA button | Hover | `accent-hover` bg, `translateY(-1px)` |
| Nav link | Hover | Underline slides left→right (0.2s) |
| Testimonial | Scroll | Fade-up with stagger |
| Gallery image | Click | GLightbox scale-in |
| Mobile menu | Toggle | Slide from right + backdrop fade |

## Icon System
Inline SVGs only (no icon font). Icons: camera, pin, calendar, star, arrow, phone, email, social.
Sizes: `w-4 h-4` (inline) · `w-6 h-6` (UI) · `w-8 h-8` (feature). Color: inherit parent.

## Empty & Loading States
| State | Pattern |
|-------|---------|
| Empty category | "New work coming soon" + link to other categories |
| Image loading | LQIP blur or `bg-bg-elevated` shimmer |
| Form submitting | Spinner, disabled, "Sending..." |
| Form success | Inline message, warm green |
| Form error | Inline below field, warm red, clear fix |

## Dark Mode
Not implementing now. Tokens are CSS custom properties — future swap via `prefers-color-scheme`.

## Print
`@media print`: hide nav/footer/menu/lightbox. Pricing prints clean. Contact info + URL in footer.

## Design Checklist
1. Does this let photography shine? 2. Is there a proven pattern? 3. Warm or corporate? 4. High-end portfolio quality? 5. Enough white space?

## Coordination
- **Specs for**: Frontend (implementation), Content (constraints)
- **Reviews**: All visual changes pre-deploy
- **With**: QA (visual regression), Analytics (CTA placement, conversion layout)
