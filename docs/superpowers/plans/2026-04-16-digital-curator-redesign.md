# Digital Curator Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform KashKlicks Studios from its current warm-gold template aesthetic into The Digital Curator editorial gallery experience, preserving all existing data, SEO, and infrastructure.

**Architecture:** Progressive reskin. Build the new design system as CSS tokens and utility classes first (Task 1-2), then replace the shell (layout, nav, footer) in Task 3, then convert each page one at a time (Tasks 4-10). Existing JSON data files, content collections, image pipeline, and SEO components are preserved untouched.

**Tech Stack:** Astro 5.18+ / Tailwind CSS 4.2+ (via @theme) / Self-hosted woff2 fonts / GLightbox / Cloudflare Pages

**Spec:** `docs/superpowers/specs/2026-04-16-digital-curator-redesign.md`

---

## File Map

### New Files
| File | Responsibility |
|---|---|
| `public/fonts/CormorantGaramond-*.woff2` | Cormorant Garamond font files (Regular, Italic, Bold) |
| `public/fonts/Fraunces-*.woff2` | Fraunces font files (Regular, Italic, Bold) |
| `public/fonts/BodoniModa-*.woff2` | Bodoni Moda font files (Regular, Italic, Bold) |
| `public/fonts/Inter-*.woff2` | Inter font files (Regular, Medium) |
| `public/fonts/InstrumentSans-*.woff2` | Instrument Sans font files (Regular, Medium) |
| `public/sounds/ambient-drone.mp3` | Splash page ambient sound |
| `public/sounds/page-turn.mp3` | Page transition sound |
| `public/sounds/shutter.mp3` | Lightbox open sound |
| `src/components/global/SoundToggle.astro` | Opt-in sound toggle button |
| `src/components/global/SplashOverlay.astro` | Gateway splash page overlay |
| `src/components/ui/FAQAccordion.astro` | Editorial FAQ accordion component |
| `src/components/ui/FloatingInput.astro` | Bottom-border floating label input |
| `src/components/ui/FloatingSelect.astro` | Bottom-border floating label select |
| `src/components/ui/FloatingTextarea.astro` | Bottom-border floating label textarea |
| `src/scripts/sound-manager.ts` | Sound loading, playback, and state management |
| `src/scripts/scroll-reveal.ts` | IntersectionObserver-based scroll animations |

### Modified Files
| File | Changes |
|---|---|
| `src/styles/global.css` | Complete rewrite: new color tokens, type scale, motion tokens, font faces, layout utilities |
| `src/layouts/BaseLayout.astro` | New font preloads, updated view transitions, splash overlay integration, sound toggle |
| `src/layouts/BlogLayout.astro` | Restyle prose to new type tokens |
| `src/components/global/Header.astro` | Glassmorphism nav, new logo, label-md nav items |
| `src/components/global/Nav.astro` | Uppercase tracked nav links, new dropdown style |
| `src/components/global/MobileMenu.astro` | Full-screen dark overlay, serif heading nav items |
| `src/components/global/Footer.astro` | surface-dark background, minimal two-column layout |
| `src/components/ui/Button.astro` | New variants (primary/secondary/ghost), 0 radius, label-md text |
| `src/components/ui/PortfolioCard.astro` | Remove rounded corners, remove hover overlay, add serif titles |
| `src/components/ui/PricingCard.astro` | Tonal layering, serif headings, no borders |
| `src/components/ui/TestimonialCard.astro` | Remove card container, serif italic quote, label-md attribution |
| `src/components/forms/ContactForm.astro` | Bottom-border inputs using FloatingInput components |
| `src/pages/index.astro` | Full homepage redesign with editorial layout patterns |
| `src/pages/portfolio/index.astro` | Asymmetric gallery layout |
| `src/pages/portfolio/[slug].astro` | Editorial collection detail with bento gallery |
| `src/pages/pricing.astro` | Investment page with editorial pricing cards |
| `src/pages/about.astro` | The Experience page with asymmetric bio |
| `src/pages/contact.astro` | Inquiry page with asymmetric form layout |
| `src/pages/services.astro` | Restyle to new design system |
| `src/pages/location-guide.astro` | Restyle to new design system |
| `src/pages/blog/index.astro` | Restyle to new design system |
| `src/pages/404.astro` | Restyle to new design system |
| `src/components/ui/SectionHeading.astro` | Remove, replace with inline serif headings + label-md subtitles |

### Unchanged Files (preserved as-is)
- `src/data/*.json` (all data files)
- `src/content/blog/*.md` (blog posts)
- `src/content.config.ts`
- `src/components/seo/SEO.astro`
- `src/components/seo/JsonLd.astro`
- `src/components/seo/Breadcrumbs.astro`
- `src/components/gallery/GalleryImage.astro`
- `src/components/gallery/GalleryGrid.astro`
- `src/components/gallery/Lightbox.astro`
- `src/components/gallery/YouTubeEmbed.astro`
- `astro.config.mjs`
- `public/_headers`, `public/_redirects`

---

## Task 1: Download and Install Fonts

**Files:**
- Create: `public/fonts/CormorantGaramond-Regular.woff2`
- Create: `public/fonts/CormorantGaramond-Italic.woff2`
- Create: `public/fonts/CormorantGaramond-Bold.woff2`
- Create: `public/fonts/Fraunces-Regular.woff2`
- Create: `public/fonts/Fraunces-Italic.woff2`
- Create: `public/fonts/Fraunces-Bold.woff2`
- Create: `public/fonts/BodoniModa-Regular.woff2`
- Create: `public/fonts/BodoniModa-Italic.woff2`
- Create: `public/fonts/BodoniModa-Bold.woff2`
- Create: `public/fonts/Inter-Regular.woff2`
- Create: `public/fonts/Inter-Medium.woff2`
- Create: `public/fonts/InstrumentSans-Regular.woff2`
- Create: `public/fonts/InstrumentSans-Medium.woff2`

- [ ] **Step 1: Download all font files from Google Fonts**

Use the google-webfonts-helper API or download directly from Google Fonts. Each font needs woff2 format only, Latin subset.

```bash
cd /Users/akashdesai/projects/kashklicks

# Create a temp script to download fonts via Google Fonts CSS API
# For each font, fetch the CSS, extract the woff2 URL, download it

# Cormorant Garamond
curl -s "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,700;1,400&display=swap" \
  -H "User-Agent: Mozilla/5.0 (Macintosh)" | grep -oP 'url\(\K[^)]+\.woff2' | head -3

# If curl approach is unreliable, use fontsource npm packages:
npx @fontsource/cormorant-garamond --help 2>/dev/null || true
```

Alternative reliable approach using fontsource:

```bash
# Download via npm (temp install, copy files, remove)
cd /tmp
mkdir font-download && cd font-download
npm init -y
npm install @fontsource/cormorant-garamond @fontsource/fraunces @fontsource/bodoni-moda @fontsource/inter @fontsource/instrument-sans

# Copy woff2 files to project
FONTS_DIR=/Users/akashdesai/projects/kashklicks/public/fonts

# Cormorant Garamond
cp node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-normal.woff2 "$FONTS_DIR/CormorantGaramond-Regular.woff2"
cp node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-400-italic.woff2 "$FONTS_DIR/CormorantGaramond-Italic.woff2"
cp node_modules/@fontsource/cormorant-garamond/files/cormorant-garamond-latin-700-normal.woff2 "$FONTS_DIR/CormorantGaramond-Bold.woff2"

# Fraunces
cp node_modules/@fontsource/fraunces/files/fraunces-latin-400-normal.woff2 "$FONTS_DIR/Fraunces-Regular.woff2"
cp node_modules/@fontsource/fraunces/files/fraunces-latin-400-italic.woff2 "$FONTS_DIR/Fraunces-Italic.woff2"
cp node_modules/@fontsource/fraunces/files/fraunces-latin-700-normal.woff2 "$FONTS_DIR/Fraunces-Bold.woff2"

# Bodoni Moda
cp node_modules/@fontsource/bodoni-moda/files/bodoni-moda-latin-400-normal.woff2 "$FONTS_DIR/BodoniModa-Regular.woff2"
cp node_modules/@fontsource/bodoni-moda/files/bodoni-moda-latin-400-italic.woff2 "$FONTS_DIR/BodoniModa-Italic.woff2"
cp node_modules/@fontsource/bodoni-moda/files/bodoni-moda-latin-700-normal.woff2 "$FONTS_DIR/BodoniModa-Bold.woff2"

# Inter
cp node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2 "$FONTS_DIR/Inter-Regular.woff2"
cp node_modules/@fontsource/inter/files/inter-latin-500-normal.woff2 "$FONTS_DIR/Inter-Medium.woff2"

# Instrument Sans
cp node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-400-normal.woff2 "$FONTS_DIR/InstrumentSans-Regular.woff2"
cp node_modules/@fontsource/instrument-sans/files/instrument-sans-latin-500-normal.woff2 "$FONTS_DIR/InstrumentSans-Medium.woff2"

# Cleanup
cd /Users/akashdesai/projects/kashklicks
rm -rf /tmp/font-download
```

- [ ] **Step 2: Verify all font files exist and check sizes**

```bash
ls -la public/fonts/*.woff2
# Expect 13 new files + 7 old Playfair/DM Sans files = 20 total
# Each woff2 should be under 30KB for Latin subset
```

- [ ] **Step 3: Remove old font files**

```bash
rm public/fonts/PlayfairDisplay-Regular.woff2
rm public/fonts/PlayfairDisplay-Medium.woff2
rm public/fonts/PlayfairDisplay-Bold.woff2
rm public/fonts/PlayfairDisplay-Italic.woff2
rm public/fonts/DMSans-Regular.woff2
rm public/fonts/DMSans-Medium.woff2
rm public/fonts/DMSans-Bold.woff2
```

- [ ] **Step 4: Commit**

```bash
git add public/fonts/
git commit -m "feat: add Digital Curator font files, remove old fonts

Add Cormorant Garamond, Fraunces, Bodoni Moda (serif moods),
Inter, and Instrument Sans (sans moods) as self-hosted woff2.
Remove Playfair Display and DM Sans."
```

---

## Task 2: Rewrite Design System (global.css)

**Files:**
- Modify: `src/styles/global.css` (complete rewrite)

- [ ] **Step 1: Replace global.css with new design system**

```css
@import "tailwindcss";

/* ══════════════════════════════════════
   THE DIGITAL CURATOR — Design System
   KashKlicks Studios
   ══════════════════════════════════════ */

/* ── Font Faces: Mood "cormorant" (default) ── */
@font-face {
  font-family: 'Cormorant Garamond';
  src: url('/fonts/CormorantGaramond-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Cormorant Garamond';
  src: url('/fonts/CormorantGaramond-Italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: 'Cormorant Garamond';
  src: url('/fonts/CormorantGaramond-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

/* ── Font Faces: Mood "fraunces" ── */
@font-face {
  font-family: 'Fraunces';
  src: url('/fonts/Fraunces-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Fraunces';
  src: url('/fonts/Fraunces-Italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: 'Fraunces';
  src: url('/fonts/Fraunces-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

/* ── Font Faces: Mood "bodoni" ── */
@font-face {
  font-family: 'Bodoni Moda';
  src: url('/fonts/BodoniModa-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Bodoni Moda';
  src: url('/fonts/BodoniModa-Italic.woff2') format('woff2');
  font-weight: 400;
  font-style: italic;
  font-display: swap;
}
@font-face {
  font-family: 'Bodoni Moda';
  src: url('/fonts/BodoniModa-Bold.woff2') format('woff2');
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}

/* ── Font Faces: Sans options ── */
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Inter';
  src: url('/fonts/Inter-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Instrument Sans';
  src: url('/fonts/InstrumentSans-Regular.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: 'Instrument Sans';
  src: url('/fonts/InstrumentSans-Medium.woff2') format('woff2');
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

/* ── Design Tokens ── */
@theme {
  /* Surfaces — tonal layering, paper on paper */
  --color-background: #faf9f6;
  --color-surface: #ffffff;
  --color-surface-dim: #f4f4f0;
  --color-surface-container: #e4e2e1;
  --color-surface-dark: #2c2824;

  /* Text hierarchy */
  --color-on-surface: #1a1a18;
  --color-on-surface-variant: #5c605c;
  --color-on-surface-muted: #afb3ae;
  --color-on-dark: #faf9f6;
  --color-on-dark-variant: #d4ccc2;

  /* Interactive */
  --color-primary: #5f5e5e;
  --color-primary-hover: #4a4948;

  /* Overlay for lightbox */
  --color-overlay: rgba(44, 40, 36, 0.85);

  /* Font families — mood system (change --font-serif to swap moods) */
  --font-serif: 'Cormorant Garamond', 'Georgia', 'Times New Roman', serif;
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;

  /* Spacing scale */
  --spacing-section: clamp(80px, 10vw, 160px);
  --spacing-block: clamp(48px, 6vw, 96px);
  --spacing-element: 24px;
  --spacing-tight: 8px;

  /* Motion tokens */
  --ease-gallery: cubic-bezier(0.22, 1, 0.36, 1);
  --duration-slow: 600ms;
  --duration-hover: 500ms;
  --duration-page: 800ms;
  --duration-splash: 1200ms;

  /* Animation keyframes */
  --animate-fade-up: fade-up var(--duration-slow) var(--ease-gallery) forwards;
  --animate-fade-in: fade-in var(--duration-slow) var(--ease-gallery) forwards;
}

/* ── Mood Variants ──
   To switch moods, change --font-serif and --font-sans on :root.
   Example: :root { --font-serif: 'Fraunces', serif; }
   Example: :root { --font-serif: 'Bodoni Moda', serif; --font-sans: 'Instrument Sans', sans-serif; }
*/

/* ── Base Styles ── */
html {
  scroll-behavior: smooth;
}

body {
  background-color: var(--color-background);
  color: var(--color-on-surface);
  font-family: var(--font-sans);
  font-size: 1rem;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--font-serif);
  line-height: 1.2;
  letter-spacing: -0.01em;
}

::selection {
  background-color: var(--color-surface-container);
  color: var(--color-on-surface);
}

/* ── Type Scale Utilities ── */
.text-display-lg {
  font-family: var(--font-serif);
  font-size: clamp(3rem, 6vw, 5.5rem);
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.05;
}

.text-display-md {
  font-family: var(--font-serif);
  font-size: clamp(2.25rem, 4.5vw, 4rem);
  font-weight: 400;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.text-heading-lg {
  font-family: var(--font-serif);
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  font-weight: 400;
  letter-spacing: -0.01em;
  line-height: 1.2;
}

.text-heading-md {
  font-family: var(--font-serif);
  font-size: clamp(1.25rem, 2vw, 1.75rem);
  font-weight: 500;
  line-height: 1.3;
}

.text-body-lg {
  font-family: var(--font-sans);
  font-size: 1.125rem;
  font-weight: 400;
  line-height: 1.7;
}

.text-body-md {
  font-family: var(--font-sans);
  font-size: 1rem;
  font-weight: 400;
  line-height: 1.6;
}

.text-label-md {
  font-family: var(--font-sans);
  font-size: 0.8125rem;
  font-weight: 500;
  letter-spacing: 0.1em;
  line-height: 1.4;
  text-transform: uppercase;
}

.text-label-sm {
  font-family: var(--font-sans);
  font-size: 0.6875rem;
  font-weight: 500;
  letter-spacing: 0.12em;
  line-height: 1.4;
  text-transform: uppercase;
}

.text-quote {
  font-family: var(--font-serif);
  font-size: clamp(1.5rem, 3vw, 2.25rem);
  font-weight: 400;
  font-style: italic;
  letter-spacing: -0.01em;
  line-height: 1.4;
}

/* ── Layout Utilities ── */
.grid-editorial {
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 24px;
  max-width: 1440px;
  margin-inline: auto;
  padding-inline: clamp(1.5rem, 4vw, 6rem);
}

@media (max-width: 639px) {
  .grid-editorial {
    grid-template-columns: 1fr;
    gap: 16px;
  }
}

.container-editorial {
  max-width: 1440px;
  margin-inline: auto;
  padding-inline: clamp(1.5rem, 4vw, 6rem);
}

/* ── Keyframes ── */
@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fade-up {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes scale-in {
  from { opacity: 0; transform: scale(0.98); }
  to { opacity: 1; transform: scale(1); }
}

/* Scroll reveal — applied by IntersectionObserver in scroll-reveal.ts */
.reveal {
  opacity: 0;
  transform: translateY(20px);
  transition: opacity var(--duration-slow) var(--ease-gallery),
              transform var(--duration-slow) var(--ease-gallery);
}

.reveal.revealed {
  opacity: 1;
  transform: translateY(0);
}

/* Stagger delays for children */
.stagger-1 { transition-delay: 100ms; }
.stagger-2 { transition-delay: 200ms; }
.stagger-3 { transition-delay: 300ms; }
.stagger-4 { transition-delay: 400ms; }
.stagger-5 { transition-delay: 500ms; }

/* ── Image Loading ── */
img {
  transition: opacity var(--duration-slow) var(--ease-gallery);
}

/* ── Ambient Shadow (floating elements only) ── */
.shadow-ambient {
  box-shadow: 0 4px 32px rgba(26, 26, 24, 0.04);
}

/* ── Ghost Border ── */
.border-ghost {
  border-color: rgba(175, 179, 174, 0.15);
}

/* ── Scrollbar ── */
html {
  scrollbar-width: thin;
  scrollbar-color: var(--color-surface-container) var(--color-background);
}

/* ── Prose (blog content) ── */
.prose-editorial {
  max-width: 65ch;
  font-size: 1.125rem;
  line-height: 1.8;
}

.prose-editorial h2,
.prose-editorial h3,
.prose-editorial h4 {
  font-family: var(--font-serif);
  margin-top: 2.5em;
  margin-bottom: 0.75em;
}

.prose-editorial p {
  margin-bottom: 1.5em;
}

.prose-editorial blockquote {
  font-family: var(--font-serif);
  font-style: italic;
  font-size: 1.25rem;
  padding-left: 1.5rem;
  border-left: 2px solid var(--color-surface-container);
  margin: 2em 0;
}

.prose-editorial a {
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 3px;
  transition: color var(--duration-hover) var(--ease-gallery);
}

.prose-editorial a:hover {
  color: var(--color-primary-hover);
}

/* ── Reduced Motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .reveal {
    opacity: 1;
    transform: none;
  }
}

/* ── Focus Indicators ── */
a:focus-visible,
button:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
summary:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid rgba(95, 94, 94, 0.5);
  outline-offset: 2px;
}

/* ── Screen Reader Only ── */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border-width: 0;
}

/* ── Gallery transition easing ── */
.cubic-ease {
  transition-timing-function: var(--ease-gallery);
}
```

- [ ] **Step 2: Verify the build compiles**

```bash
cd /Users/akashdesai/projects/kashklicks
pnpm build 2>&1 | tail -5
```

Expected: Build completes (pages will look broken because components still reference old tokens, but no CSS compilation errors).

- [ ] **Step 3: Commit**

```bash
git add src/styles/global.css
git commit -m "feat: replace design system with Digital Curator tokens

New color system (stone/taupe), type scale with mood system,
motion tokens, layout utilities, and editorial grid.
Removes all gold accent colors and rounded corner patterns."
```

---

## Task 3: Create Scroll Reveal and Sound Manager Scripts

**Files:**
- Create: `src/scripts/scroll-reveal.ts`
- Create: `src/scripts/sound-manager.ts`

- [ ] **Step 1: Create scroll-reveal.ts**

```typescript
// src/scripts/scroll-reveal.ts
// IntersectionObserver-based scroll animations
// Elements with class="reveal" fade up when entering the viewport.
// Add stagger-1 through stagger-5 for sequential delays.

export function initScrollReveal(): void {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    // Show everything immediately
    document.querySelectorAll('.reveal').forEach((el) => {
      el.classList.add('revealed');
    });
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => {
    observer.observe(el);
  });
}
```

- [ ] **Step 2: Create sound-manager.ts**

```typescript
// src/scripts/sound-manager.ts
// Lazy-loaded sound system. All sounds muted by default.
// User opts in via SoundToggle component.
// State persisted in sessionStorage.

type SoundName = 'ambient' | 'page-turn' | 'shutter';

const SOUND_PATHS: Record<SoundName, string> = {
  'ambient': '/sounds/ambient-drone.mp3',
  'page-turn': '/sounds/page-turn.mp3',
  'shutter': '/sounds/shutter.mp3',
};

const VOLUME: Record<SoundName, number> = {
  'ambient': 0.15,
  'page-turn': 0.08,
  'shutter': 0.1,
};

const audioCache: Partial<Record<SoundName, HTMLAudioElement>> = {};
let enabled = false;

export function isSoundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(value: boolean): void {
  enabled = value;
  sessionStorage.setItem('kk-sound-enabled', value ? 'true' : 'false');

  if (!value) {
    // Stop any playing sounds
    Object.values(audioCache).forEach((audio) => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
  }
}

export function initSoundState(): void {
  const stored = sessionStorage.getItem('kk-sound-enabled');
  enabled = stored === 'true';
}

function getAudio(name: SoundName): HTMLAudioElement {
  if (!audioCache[name]) {
    const audio = new Audio(SOUND_PATHS[name]);
    audio.volume = VOLUME[name];
    audio.preload = 'none';
    audioCache[name] = audio;
  }
  return audioCache[name]!;
}

export function playSound(name: SoundName): void {
  if (!enabled) return;
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) return;

  const audio = getAudio(name);
  audio.currentTime = 0;
  audio.play().catch(() => {
    // Silently fail if autoplay blocked
  });
}

export function playAmbientLoop(): void {
  if (!enabled) return;
  const audio = getAudio('ambient');
  audio.loop = true;
  audio.play().catch(() => {});
}

export function stopAmbient(): void {
  const audio = audioCache['ambient'];
  if (audio) {
    audio.pause();
    audio.currentTime = 0;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/scripts/scroll-reveal.ts src/scripts/sound-manager.ts
git commit -m "feat: add scroll reveal observer and sound manager

scroll-reveal.ts: IntersectionObserver for .reveal elements
sound-manager.ts: lazy-loaded, opt-in sound system with
ambient, page-turn, and shutter sounds."
```

---

## Task 4: Create Sound Toggle and Splash Overlay Components

**Files:**
- Create: `src/components/global/SoundToggle.astro`
- Create: `src/components/global/SplashOverlay.astro`

- [ ] **Step 1: Create SoundToggle.astro**

```astro
---
// src/components/global/SoundToggle.astro
// Opt-in sound toggle. Bottom-right corner. Muted by default.
---

<button
  id="sound-toggle"
  class="fixed bottom-6 right-6 z-40 w-11 h-11 flex items-center justify-center text-on-surface-muted hover:text-on-surface transition-colors cubic-ease"
  aria-label="Toggle ambient sound"
  aria-pressed="false"
  style="transition-duration: var(--duration-hover);"
>
  <!-- Muted icon (default) -->
  <svg id="sound-off-icon" class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
  </svg>
  <!-- Unmuted icon (hidden by default) -->
  <svg id="sound-on-icon" class="w-5 h-5 hidden" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15.536 8.464a5 5 0 010 7.072M18.364 5.636a9 9 0 010 12.728" />
  </svg>
</button>

<script>
  import { initSoundState, isSoundEnabled, setSoundEnabled } from '../../scripts/sound-manager';

  function initSoundToggle() {
    const btn = document.getElementById('sound-toggle');
    const offIcon = document.getElementById('sound-off-icon');
    const onIcon = document.getElementById('sound-on-icon');
    if (!btn || !offIcon || !onIcon) return;

    initSoundState();
    updateIcons();

    btn.addEventListener('click', () => {
      setSoundEnabled(!isSoundEnabled());
      updateIcons();
    });

    function updateIcons() {
      const on = isSoundEnabled();
      btn!.setAttribute('aria-pressed', on ? 'true' : 'false');
      offIcon!.classList.toggle('hidden', on);
      onIcon!.classList.toggle('hidden', !on);
    }

    // Hide toggle if user prefers reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      btn.style.display = 'none';
    }
  }

  initSoundToggle();
  document.addEventListener('astro:after-swap', initSoundToggle);
</script>
```

- [ ] **Step 2: Create SplashOverlay.astro**

```astro
---
// src/components/global/SplashOverlay.astro
// Full-viewport gateway page. Shows once per session.
// Auto-plays a 3-5s ambient visual moment, then reveals CTA.
import { Image } from 'astro:assets';
import heroImage from '../../assets/images/hero/hero-main.jpg';
---

<div
  id="splash-overlay"
  class="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-surface-dark"
  role="dialog"
  aria-label="Welcome to KashKlicks Studios"
  aria-modal="true"
>
  <!-- Background image with Ken Burns -->
  <div class="absolute inset-0 overflow-hidden">
    <Image
      src={heroImage}
      alt=""
      class="w-full h-full object-cover opacity-40"
      style="animation: kenburns 8s var(--ease-gallery) forwards;"
      widths={[1200, 1920]}
      sizes="100vw"
      loading="eager"
      fetchpriority="high"
      decoding="async"
    />
  </div>

  <!-- Content -->
  <div class="relative text-center px-6">
    <h1 class="text-display-lg text-on-dark">KashKlicks</h1>
    <p class="text-label-md text-on-dark-variant mt-4">Moments fade. Memories don't.</p>
    <div id="splash-cta" class="mt-12 opacity-0" style="transition: opacity var(--duration-splash) var(--ease-gallery);">
      <button
        id="splash-enter"
        class="px-8 py-4 bg-primary text-on-dark text-label-md hover:bg-primary-hover cubic-ease"
        style="transition-duration: var(--duration-hover);"
      >
        View the Collection
      </button>
    </div>
  </div>
</div>

<style>
  @keyframes kenburns {
    from { transform: scale(1); }
    to { transform: scale(1.08); }
  }
</style>

<script>
  import { playAmbientLoop, stopAmbient } from '../../scripts/sound-manager';

  function initSplash() {
    const overlay = document.getElementById('splash-overlay');
    const cta = document.getElementById('splash-cta');
    const enterBtn = document.getElementById('splash-enter');
    if (!overlay) return;

    // Check if already seen this session
    if (sessionStorage.getItem('kk-splash-seen') === 'true') {
      overlay.remove();
      return;
    }

    // Prevent scrolling while splash is visible
    document.body.style.overflow = 'hidden';

    // Start ambient sound if user has opted in
    playAmbientLoop();

    // Reveal CTA after 3.5 seconds
    setTimeout(() => {
      if (cta) cta.style.opacity = '1';
    }, 3500);

    // Enter site
    enterBtn?.addEventListener('click', () => {
      stopAmbient();
      overlay.style.transition = `opacity var(--duration-splash) var(--ease-gallery)`;
      overlay.style.opacity = '0';
      sessionStorage.setItem('kk-splash-seen', 'true');
      document.body.style.overflow = '';

      setTimeout(() => {
        overlay.remove();
      }, 1200);
    });

    // Also allow Enter key
    enterBtn?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') enterBtn.click();
    });
  }

  initSplash();
</script>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/global/SoundToggle.astro src/components/global/SplashOverlay.astro
git commit -m "feat: add sound toggle and splash overlay components

SoundToggle: opt-in ambient sound, bottom-right, muted by default
SplashOverlay: full-viewport gateway, shows once per session,
Ken Burns hero, reveals CTA after 3.5s delay"
```

---

## Task 5: Rewrite BaseLayout, Header, Nav, MobileMenu, Footer

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `src/components/global/Header.astro`
- Modify: `src/components/global/Nav.astro`
- Modify: `src/components/global/MobileMenu.astro`
- Modify: `src/components/global/Footer.astro`

- [ ] **Step 1: Rewrite BaseLayout.astro**

Replace the entire contents of `src/layouts/BaseLayout.astro` with:

```astro
---
import { ClientRouter } from 'astro:transitions';
import SEO from '../components/seo/SEO.astro';
import JsonLd from '../components/seo/JsonLd.astro';
import Header from '../components/global/Header.astro';
import Footer from '../components/global/Footer.astro';
import SoundToggle from '../components/global/SoundToggle.astro';
import SplashOverlay from '../components/global/SplashOverlay.astro';
import site from '../data/site.json';
import '../styles/global.css';

interface Props {
  title: string;
  description: string;
  ogImage?: string;
  ogType?: 'website' | 'article';
  canonicalUrl?: string;
  noIndex?: boolean;
  jsonLd?: Record<string, any> | Record<string, any>[];
  transparentHeader?: boolean;
  showSplash?: boolean;
  article?: {
    publishedTime: string;
    modifiedTime?: string;
    author: string;
    tags?: string[];
  };
}

const {
  title,
  description,
  ogImage,
  ogType,
  canonicalUrl,
  noIndex,
  jsonLd,
  transparentHeader = false,
  showSplash = false,
  article,
} = Astro.props;

const organizationSchema = {
  '@context': 'https://schema.org',
  '@type': 'LocalBusiness',
  name: site.name,
  url: site.url,
  image: `${site.url}/og-default.jpg`,
  description: site.description,
  address: {
    '@type': 'PostalAddress',
    addressLocality: site.location.city,
    addressRegion: site.location.regionCode,
    addressCountry: site.location.countryCode,
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: site.location.lat,
    longitude: site.location.lng,
  },
  priceRange: '$$',
  areaServed: site.areasServed,
  sameAs: [site.social.instagram, site.social.pinterest, site.social.youtube],
};
---

<!doctype html>
<html lang="en-CA">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />

    <!-- Preload critical fonts (active mood) -->
    <link rel="preload" href="/fonts/CormorantGaramond-Regular.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/Inter-Regular.woff2" as="font" type="font/woff2" crossorigin />
    <ClientRouter />

    <SEO
      title={title}
      description={description}
      ogImage={ogImage}
      ogType={ogType}
      canonicalUrl={canonicalUrl}
      noIndex={noIndex}
      article={article}
    />

    <JsonLd schema={organizationSchema} />
    {jsonLd && <JsonLd schema={jsonLd} />}
  </head>
  <body class="min-h-screen flex flex-col bg-background text-on-surface">
    <a href="#main-content" class="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[60] focus:bg-primary focus:text-on-dark focus:px-4 focus:py-2 focus:outline-none">
      Skip to content
    </a>

    {showSplash && <SplashOverlay />}

    <Header transparent={transparentHeader} />

    <main id="main-content" class="flex-1" transition:animate="fade">
      <slot />
    </main>

    <Footer />
    <SoundToggle />

    <script>
      import { initScrollReveal } from '../scripts/scroll-reveal';
      import { playSound } from '../scripts/sound-manager';

      // Init scroll animations on every page load
      document.addEventListener('astro:page-load', () => {
        initScrollReveal();

        // Init lightbox if gallery images exist
        const lightboxElements = document.querySelectorAll('.glightbox');
        if (lightboxElements.length > 0) {
          import('glightbox').then(({ default: GLightbox }) => {
            const lb = GLightbox({ selector: '.glightbox', loop: true, touchNavigation: true, closeOnOutsideClick: true, skin: 'clean' });
            lb.on('open', () => playSound('shutter'));
          });
        }
      });

      // Play page transition sound
      document.addEventListener('astro:before-swap', () => {
        playSound('page-turn');
      });
    </script>

    <!-- Cloudflare Web Analytics -->
    <script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{"token": "YOUR_CF_ANALYTICS_TOKEN"}'></script>
  </body>
</html>
```

- [ ] **Step 2: Rewrite Header.astro**

Replace the entire contents of `src/components/global/Header.astro` with:

```astro
---
import Nav from './Nav.astro';
import MobileMenu from './MobileMenu.astro';

interface Props {
  transparent?: boolean;
}

const { transparent = false } = Astro.props;
---

<header
  id="site-header"
  class:list={[
    'fixed top-0 left-0 right-0 z-50 cubic-ease',
    'transition-all',
    transparent
      ? 'bg-transparent'
      : 'bg-background/80 backdrop-blur-[20px] shadow-ambient',
  ]}
  style="transition-duration: var(--duration-slow);"
>
  <div class="container-editorial">
    <div class="flex items-center justify-between h-20 lg:h-24">
      <!-- Logo -->
      <a href="/" class="flex items-center group">
        <span class:list={[
          'font-serif text-2xl lg:text-3xl tracking-[-0.03em] cubic-ease',
          transparent ? 'text-on-dark' : 'text-on-surface',
        ]}
        style="transition-duration: var(--duration-hover);"
        >
          KashKlicks
        </span>
      </a>

      <!-- Desktop Nav -->
      <div class="hidden lg:block">
        <Nav transparent={transparent} />
      </div>

      <!-- Mobile Menu Button -->
      <button
        id="mobile-menu-toggle"
        class:list={[
          'lg:hidden p-2 cubic-ease',
          transparent ? 'text-on-dark' : 'text-on-surface',
        ]}
        style="transition-duration: var(--duration-hover);"
        aria-label="Toggle navigation menu"
        aria-expanded="false"
        aria-controls="mobile-menu"
      >
        <svg class="w-6 h-6" id="menu-icon-open" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <svg class="w-6 h-6 hidden" id="menu-icon-close" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  </div>

  <MobileMenu />
</header>

<!-- Spacer for fixed header -->
<div class="h-20 lg:h-24"></div>

<script>
  function initHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;

    const isTransparent = header.classList.contains('bg-transparent');
    if (!isTransparent) return;

    let scrolled = false;
    const onScroll = () => {
      const shouldBeScrolled = window.scrollY > 50;
      if (shouldBeScrolled === scrolled) return;
      scrolled = shouldBeScrolled;
      if (scrolled) {
        header.classList.remove('bg-transparent');
        header.classList.add('bg-background/80', 'backdrop-blur-[20px]', 'shadow-ambient');
        // Update text colors
        header.querySelectorAll('[class*="text-on-dark"]').forEach((el) => {
          el.classList.remove('text-on-dark');
          el.classList.add('text-on-surface');
        });
        header.querySelectorAll('[class*="text-on-dark-variant"]').forEach((el) => {
          el.classList.remove('text-on-dark-variant');
          el.classList.add('text-on-surface-variant');
        });
      } else {
        header.classList.add('bg-transparent');
        header.classList.remove('bg-background/80', 'backdrop-blur-[20px]', 'shadow-ambient');
        header.querySelectorAll('.nav-link').forEach((el) => {
          el.classList.remove('text-on-surface-variant');
          el.classList.add('text-on-dark-variant');
        });
        header.querySelector('.font-serif')?.classList.remove('text-on-surface');
        header.querySelector('.font-serif')?.classList.add('text-on-dark');
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  // Mobile menu toggle
  function initMobileMenu() {
    const toggle = document.getElementById('mobile-menu-toggle');
    const menu = document.getElementById('mobile-menu');
    const iconOpen = document.getElementById('menu-icon-open');
    const iconClose = document.getElementById('menu-icon-close');

    function closeMenu() {
      menu?.classList.remove('opacity-100', 'visible');
      menu?.classList.add('opacity-0', 'invisible');
      iconOpen?.classList.remove('hidden');
      iconClose?.classList.add('hidden');
      toggle?.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
      toggle?.focus();
    }

    function openMenu() {
      menu?.classList.remove('opacity-0', 'invisible');
      menu?.classList.add('opacity-100', 'visible');
      iconOpen?.classList.add('hidden');
      iconClose?.classList.remove('hidden');
      toggle?.setAttribute('aria-expanded', 'true');
      document.body.style.overflow = 'hidden';
      const firstLink = menu?.querySelector('a') as HTMLElement | null;
      firstLink?.focus();
    }

    toggle?.addEventListener('click', () => {
      const isOpen = menu?.classList.contains('opacity-100');
      isOpen ? closeMenu() : openMenu();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu?.classList.contains('opacity-100')) {
        closeMenu();
      }
    });

    // Focus trap
    menu?.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const focusable = menu.querySelectorAll<HTMLElement>('a, button, [tabindex]:not([tabindex="-1"])');
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
  }

  initHeader();
  initMobileMenu();
  document.addEventListener('astro:after-swap', () => { initHeader(); initMobileMenu(); });
</script>
```

- [ ] **Step 3: Rewrite Nav.astro**

Replace the entire contents of `src/components/global/Nav.astro` with:

```astro
---
import navigation from '../../data/navigation.json';

interface Props {
  transparent?: boolean;
}

const { transparent = false } = Astro.props;
const currentPath = Astro.url.pathname;
---

<nav aria-label="Main navigation" class="flex items-center gap-10">
  {navigation.items.map((item) => (
    <div class="relative group">
      <a
        href={item.href}
        class:list={[
          'nav-link text-label-md cubic-ease py-2',
          transparent ? 'text-on-dark-variant' : 'text-on-surface-variant',
          currentPath.startsWith(item.href) && 'font-semibold',
        ]}
        style={`transition-duration: var(--duration-hover); ${currentPath.startsWith(item.href) ? `color: ${transparent ? 'var(--color-on-dark)' : 'var(--color-on-surface)'}` : ''}`}
        aria-current={currentPath.startsWith(item.href) ? 'page' : undefined}
        aria-haspopup={item.children ? 'true' : undefined}
        aria-expanded={item.children ? 'false' : undefined}
      >
        {item.label}
      </a>

      {item.children && (
        <div
          class="absolute top-full left-0 pt-3 opacity-0 invisible group-hover:opacity-100 group-hover:visible group-focus-within:opacity-100 group-focus-within:visible cubic-ease"
          style="transition-duration: var(--duration-slow);"
          role="menu"
        >
          <div class="bg-surface py-3 min-w-[200px] shadow-ambient">
            {item.children.map((child) => (
              <a
                href={child.href}
                role="menuitem"
                class:list={[
                  'block px-5 py-2.5 text-label-md cubic-ease',
                  currentPath === child.href
                    ? 'text-on-surface'
                    : 'text-on-surface-variant hover:text-on-surface',
                ]}
                style="transition-duration: var(--duration-hover);"
                aria-current={currentPath === child.href ? 'page' : undefined}
              >
                {child.label}
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  ))}
</nav>
```

- [ ] **Step 4: Rewrite MobileMenu.astro**

Replace the entire contents of `src/components/global/MobileMenu.astro` with:

```astro
---
import navigation from '../../data/navigation.json';

const currentPath = Astro.url.pathname;
---

<div
  id="mobile-menu"
  class="fixed inset-0 bg-surface-dark z-40 opacity-0 invisible lg:hidden overflow-y-auto cubic-ease"
  style="transition-duration: var(--duration-slow);"
  role="dialog"
  aria-label="Mobile navigation menu"
  aria-modal="true"
>
  <nav aria-label="Mobile navigation" class="flex flex-col items-start justify-center min-h-screen px-8 py-24">
    {navigation.items.map((item) => (
      <div class="mb-2">
        <a
          href={item.href}
          class:list={[
            'block py-3 text-heading-lg cubic-ease',
            currentPath.startsWith(item.href) ? 'text-on-dark' : 'text-on-dark-variant hover:text-on-dark',
          ]}
          style="transition-duration: var(--duration-hover);"
          aria-current={currentPath.startsWith(item.href) ? 'page' : undefined}
        >
          {item.label}
        </a>
        {item.children && (
          <div class="pl-4 mb-4">
            {item.children.map((child) => (
              <a
                href={child.href}
                class:list={[
                  'block py-2 text-label-md cubic-ease',
                  currentPath === child.href
                    ? 'text-on-dark'
                    : 'text-on-dark-variant hover:text-on-dark',
                ]}
                style="transition-duration: var(--duration-hover);"
                aria-current={currentPath === child.href ? 'page' : undefined}
              >
                {child.label}
              </a>
            ))}
          </div>
        )}
      </div>
    ))}

    <div class="mt-12">
      <a
        href="/contact"
        class="px-8 py-4 bg-primary text-on-dark text-label-md hover:bg-primary-hover cubic-ease inline-block"
        style="transition-duration: var(--duration-hover);"
      >
        Begin the Inquiry
      </a>
    </div>
  </nav>
</div>
```

- [ ] **Step 5: Rewrite Footer.astro**

Replace the entire contents of `src/components/global/Footer.astro` with:

```astro
---
import site from '../../data/site.json';
---

<footer class="bg-surface-dark" style="padding-top: var(--spacing-section); padding-bottom: var(--spacing-block);">
  <div class="container-editorial">
    <div class="grid grid-cols-1 md:grid-cols-3 gap-16">
      <!-- Brand -->
      <div>
        <a href="/" class="font-serif text-2xl text-on-dark">{site.name}</a>
        <p class="mt-4 text-body-md text-on-dark-variant max-w-xs">
          {site.tagline}
        </p>
      </div>

      <!-- Connect -->
      <div>
        <p class="text-label-sm text-on-dark-variant mb-6">Connect</p>
        <ul class="space-y-3">
          <li>
            <a href={site.social.instagram} target="_blank" rel="noopener noreferrer" class="text-body-md text-on-dark-variant hover:text-on-dark cubic-ease" style="transition-duration: var(--duration-hover);">
              Instagram
            </a>
          </li>
          <li>
            <a href={site.social.pinterest} target="_blank" rel="noopener noreferrer" class="text-body-md text-on-dark-variant hover:text-on-dark cubic-ease" style="transition-duration: var(--duration-hover);">
              Pinterest
            </a>
          </li>
        </ul>
      </div>

      <!-- Information -->
      <div>
        <p class="text-label-sm text-on-dark-variant mb-6">Information</p>
        <ul class="space-y-3">
          <li>
            <a href="/about" class="text-body-md text-on-dark-variant hover:text-on-dark cubic-ease" style="transition-duration: var(--duration-hover);">
              The Experience
            </a>
          </li>
          <li>
            <a href="/contact" class="text-body-md text-on-dark-variant hover:text-on-dark cubic-ease" style="transition-duration: var(--duration-hover);">
              Inquiry
            </a>
          </li>
        </ul>
      </div>
    </div>

    <!-- Copyright -->
    <div class="mt-16 pt-8">
      <p class="text-label-sm text-on-dark-variant">
        &copy; {new Date().getFullYear()} {site.name}. Crafted for The Digital Curator.
      </p>
    </div>
  </div>
</footer>
```

- [ ] **Step 6: Verify the build compiles**

```bash
cd /Users/akashdesai/projects/kashklicks
pnpm build 2>&1 | tail -10
```

Expected: Build succeeds. Pages may look partially broken as individual pages still reference old component APIs, but the shell (layout, header, footer) works.

- [ ] **Step 7: Commit**

```bash
git add src/layouts/BaseLayout.astro src/components/global/Header.astro src/components/global/Nav.astro src/components/global/MobileMenu.astro src/components/global/Footer.astro
git commit -m "feat: rewrite site shell with Digital Curator design

BaseLayout: new font preloads, splash overlay, sound toggle, scroll reveal
Header: glassmorphism nav with backdrop-blur, label-md nav links
Nav: uppercase tracked navigation, ambient shadow dropdown
MobileMenu: full-screen dark overlay with serif heading nav items
Footer: surface-dark background, minimal two-column layout"
```

---

## Task 6: Rewrite Button, PortfolioCard, TestimonialCard, PricingCard

**Files:**
- Modify: `src/components/ui/Button.astro`
- Modify: `src/components/ui/PortfolioCard.astro`
- Modify: `src/components/ui/TestimonialCard.astro`
- Modify: `src/components/ui/PricingCard.astro`

- [ ] **Step 1: Rewrite Button.astro**

Replace the entire contents of `src/components/ui/Button.astro` with:

```astro
---
interface Props {
  href?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  class?: string;
}

const { href, variant = 'primary', class: className = '' } = Astro.props;

const base = 'inline-flex items-center justify-center text-label-md cubic-ease focus-visible:outline-2 focus-visible:outline-offset-2';

const variants = {
  primary: 'bg-primary text-on-dark hover:bg-primary-hover px-8 py-4',
  secondary: 'border border-ghost text-primary hover:text-primary-hover px-6 py-3',
  ghost: 'text-on-surface-variant hover:text-on-surface px-4 py-2',
};

const classes = `${base} ${variants[variant]} ${className}`;
---

{href ? (
  <a href={href} class={classes} style="transition-duration: var(--duration-hover);">
    <slot />
  </a>
) : (
  <button class={classes} style="transition-duration: var(--duration-hover);">
    <slot />
  </button>
)}
```

- [ ] **Step 2: Rewrite PortfolioCard.astro**

Replace the entire contents of `src/components/ui/PortfolioCard.astro` with:

```astro
---
import { Image } from 'astro:assets';

interface Props {
  couple: string;
  location: string;
  category: string;
  coverImage: ImageMetadata;
  href: string;
}

const { couple, location, category, coverImage, href } = Astro.props;
---

<a href={href} class="group block" data-category={category}>
  <div class="overflow-hidden aspect-[2/3] bg-surface-container">
    <Image
      src={coverImage}
      alt={`${couple}, ${location}`}
      widths={[400, 600, 800]}
      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
      class="w-full h-full object-cover cubic-ease group-hover:scale-[1.02]"
      style="transition-duration: var(--duration-slow);"
      loading="lazy"
    />
  </div>
  <div class="mt-4">
    <h3 class="text-heading-md">{couple}</h3>
    <p class="text-label-md text-on-surface-variant mt-1">{location}</p>
  </div>
</a>
```

- [ ] **Step 3: Rewrite TestimonialCard.astro**

Replace the entire contents of `src/components/ui/TestimonialCard.astro` with:

```astro
---
interface Props {
  name: string;
  event: string;
  quote: string;
  rating: number;
}

const { name, event, quote } = Astro.props;
---

<figure>
  <blockquote class="text-quote text-on-surface">
    <p>"{quote}"</p>
  </blockquote>
  <figcaption class="mt-6">
    <p class="text-label-md text-on-surface-variant">{name}</p>
    <p class="text-label-sm text-on-surface-muted mt-1">{event}</p>
  </figcaption>
</figure>
```

- [ ] **Step 4: Rewrite PricingCard.astro**

Replace the entire contents of `src/components/ui/PricingCard.astro` with:

```astro
---
interface Props {
  name: string;
  price: number | null;
  salePrice?: number;
  description: string;
  highlights: string[];
  popular?: boolean;
  featured?: boolean;
  custom?: boolean;
  id: string;
}

const { name, price, salePrice, description, highlights, custom = false, id } = Astro.props;
---

<div class="bg-surface p-10 flex flex-col h-full" style="gap: var(--spacing-element);">
  <h3 class="text-heading-md italic">{name}</h3>

  <p class="text-body-md text-on-surface-variant">{description}</p>

  <div>
    <p class="text-label-sm text-on-surface-muted mb-2">Starting from</p>
    {custom ? (
      <span class="text-display-md">Custom</span>
    ) : salePrice ? (
      <div class="flex items-baseline gap-3">
        <span class="text-display-md">${salePrice.toLocaleString()}</span>
        <span class="text-body-md text-on-surface-muted line-through">${price?.toLocaleString()}</span>
      </div>
    ) : (
      <span class="text-display-md">${price?.toLocaleString()}</span>
    )}
  </div>

  <ul class="space-y-3 flex-1">
    {highlights.map((item) => (
      <li class="text-body-md text-on-surface-variant">{item}</li>
    ))}
  </ul>

  <a
    href={`/contact?package=${id}`}
    class="inline-flex items-center justify-center bg-primary text-on-dark text-label-md px-8 py-4 hover:bg-primary-hover cubic-ease self-start"
    style="transition-duration: var(--duration-hover);"
  >
    {custom ? "Begin the Inquiry" : 'Begin the Inquiry'}
  </a>
</div>
```

- [ ] **Step 5: Verify the build compiles**

```bash
cd /Users/akashdesai/projects/kashklicks
pnpm build 2>&1 | tail -10
```

- [ ] **Step 6: Commit**

```bash
git add src/components/ui/Button.astro src/components/ui/PortfolioCard.astro src/components/ui/TestimonialCard.astro src/components/ui/PricingCard.astro
git commit -m "feat: rewrite UI components for Digital Curator design

Button: primary/secondary/ghost variants, 0 radius, label-md text
PortfolioCard: no rounded corners, serif titles, subtle 102% scale
TestimonialCard: no card container, serif italic quote, label attribution
PricingCard: tonal layering, serif italic name, no borders"
```

---

## Task 7: Create Floating Input Components

**Files:**
- Create: `src/components/ui/FloatingInput.astro`
- Create: `src/components/ui/FloatingSelect.astro`
- Create: `src/components/ui/FloatingTextarea.astro`

- [ ] **Step 1: Create FloatingInput.astro**

```astro
---
// src/components/ui/FloatingInput.astro
// Bottom-border input with floating label (spec section 5.3)
interface Props {
  id: string;
  name: string;
  type?: string;
  label: string;
  required?: boolean;
}

const { id, name, type = 'text', label, required = false } = Astro.props;
---

<div class="relative pt-5">
  <input
    type={type}
    id={id}
    name={name}
    required={required}
    aria-required={required ? 'true' : undefined}
    aria-describedby={`${id}-error`}
    placeholder=" "
    class="peer w-full bg-transparent border-0 border-b border-ghost text-on-surface text-body-lg pb-2 focus:border-primary focus:outline-none cubic-ease"
    style="transition-duration: var(--duration-hover);"
  />
  <label
    for={id}
    class="absolute left-0 top-5 text-body-md text-on-surface-muted cubic-ease pointer-events-none peer-placeholder-shown:top-5 peer-placeholder-shown:text-body-md peer-focus:top-0 peer-focus:text-label-sm peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-label-sm"
    style="transition-duration: var(--duration-hover);"
  >
    {label}
  </label>
  <p id={`${id}-error`} class="form-error-msg mt-1 text-xs hidden" role="alert" style="color: #9e422c;"></p>
</div>
```

- [ ] **Step 2: Create FloatingSelect.astro**

```astro
---
// src/components/ui/FloatingSelect.astro
interface Props {
  id: string;
  name: string;
  label: string;
  options: { value: string; label: string }[];
  required?: boolean;
}

const { id, name, label, options, required = false } = Astro.props;
---

<div class="relative pt-5">
  <p class="text-label-sm text-on-surface-muted mb-2">{label}</p>
  <select
    id={id}
    name={name}
    required={required}
    class="w-full bg-transparent border-0 border-b border-ghost text-on-surface text-body-lg pb-2 focus:border-primary focus:outline-none cubic-ease appearance-none cursor-pointer"
    style="transition-duration: var(--duration-hover);"
  >
    <option value="">Select an experience</option>
    {options.map((opt) => (
      <option value={opt.value}>{opt.label}</option>
    ))}
  </select>
  <svg class="absolute right-0 bottom-3 w-4 h-4 text-on-surface-muted pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M19 9l-7 7-7-7" />
  </svg>
</div>
```

- [ ] **Step 3: Create FloatingTextarea.astro**

```astro
---
// src/components/ui/FloatingTextarea.astro
interface Props {
  id: string;
  name: string;
  label: string;
  required?: boolean;
  rows?: number;
}

const { id, name, label, required = false, rows = 4 } = Astro.props;
---

<div class="relative pt-5">
  <textarea
    id={id}
    name={name}
    required={required}
    aria-required={required ? 'true' : undefined}
    aria-describedby={`${id}-error`}
    rows={rows}
    placeholder=" "
    class="peer w-full bg-transparent border-0 border-b border-ghost text-on-surface text-body-lg pb-2 focus:border-primary focus:outline-none cubic-ease resize-y"
    style="transition-duration: var(--duration-hover);"
  ></textarea>
  <label
    for={id}
    class="absolute left-0 top-5 text-body-md text-on-surface-muted cubic-ease pointer-events-none peer-placeholder-shown:top-5 peer-placeholder-shown:text-body-md peer-focus:top-0 peer-focus:text-label-sm peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-label-sm"
    style="transition-duration: var(--duration-hover);"
  >
    {label}
  </label>
  <p id={`${id}-error`} class="form-error-msg mt-1 text-xs hidden" role="alert" style="color: #9e422c;"></p>
</div>
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/FloatingInput.astro src/components/ui/FloatingSelect.astro src/components/ui/FloatingTextarea.astro
git commit -m "feat: add floating label input components

Bottom-border-only inputs with label that floats on focus.
Ghost border transitions to primary on focus over 500ms.
FloatingInput, FloatingSelect, FloatingTextarea."
```

---

## Task 8: Create FAQ Accordion Component

**Files:**
- Create: `src/components/ui/FAQAccordion.astro`

- [ ] **Step 1: Create FAQAccordion.astro**

```astro
---
// src/components/ui/FAQAccordion.astro
interface Props {
  items: { question: string; answer: string }[];
}

const { items } = Astro.props;
---

<div class="space-y-0" style="gap: 0;">
  {items.map((item, i) => (
    <details class="group" style={`padding: var(--spacing-block) 0;${i > 0 ? '' : 'padding-top: 0;'}`}>
      <summary class="flex items-center justify-between cursor-pointer list-none">
        <h3 class="text-heading-md pr-8">{item.question}</h3>
        <span class="text-on-surface-variant text-2xl cubic-ease group-open:rotate-45" style="transition-duration: var(--duration-slow);" aria-hidden="true">+</span>
      </summary>
      <div class="text-body-lg text-on-surface-variant" style="padding-top: var(--spacing-element); max-width: 65ch;">
        <p>{item.answer}</p>
      </div>
    </details>
  ))}
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/ui/FAQAccordion.astro
git commit -m "feat: add editorial FAQ accordion component

Serif heading questions, + icon that rotates to x, 48px spacing,
no borders between items. Uses details/summary for native a11y."
```

---

## Task 9: Redesign Homepage

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Rewrite index.astro with editorial homepage layout**

Replace the entire contents of `src/pages/index.astro` with:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import TestimonialCard from '../components/ui/TestimonialCard.astro';
import Button from '../components/ui/Button.astro';
import { Image } from 'astro:assets';

import testimonials from '../data/testimonials.json';
import portfolio from '../data/portfolio.json';
import site from '../data/site.json';

import heroImage from '../assets/images/hero/hero-main.jpg';

// Dynamic portfolio image imports
const portfolioImages = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/images/portfolio/*.jpg',
  { eager: true }
);

const featuredWork = portfolio.filter((p) => p.featured).slice(0, 3);

const reviewSchemas = testimonials.map((t) => ({
  '@type': 'Review',
  reviewRating: { '@type': 'Rating', ratingValue: t.rating, bestRating: 5 },
  author: { '@type': 'Person', name: t.name },
  reviewBody: t.quote,
}));

const websiteSchema = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: site.name,
  url: site.url,
};

const jsonLd = [websiteSchema, ...reviewSchemas.map((r) => ({ '@context': 'https://schema.org', ...r }))];
---

<BaseLayout
  title="Home"
  description="KashKlicks Studios. Toronto wedding photographer and videographer. Cinematic pre-wedding, wedding, and engagement photography across the GTA and Canada."
  transparentHeader={true}
  showSplash={true}
  jsonLd={jsonLd}
>
  <!-- ═══ HERO ═══ -->
  <section class="relative h-screen flex items-center -mt-20 lg:-mt-24">
    <Image
      src={heroImage}
      alt="Couple at sunset, KashKlicks Studios Toronto wedding photography"
      class="absolute inset-0 w-full h-full object-cover"
      loading="eager"
      fetchpriority="high"
      decoding="async"
      widths={[768, 1200, 1920]}
      sizes="100vw"
    />
    <div class="absolute inset-0 bg-gradient-to-b from-black/50 via-black/20 to-background" />

    <div class="relative container-editorial">
      <div class="max-w-3xl">
        <h1 class="text-display-lg text-on-dark">
          Warm, candid wedding and civil ceremony photography with quiet luxury.
        </h1>
        <div class="mt-10">
          <Button href="/portfolio" variant="primary">View Portfolio</Button>
        </div>
      </div>
    </div>
  </section>

  <!-- ═══ INTRO — Hero Split Pattern ═══ -->
  <section style="padding-top: var(--spacing-section); padding-bottom: var(--spacing-section);">
    <div class="grid-editorial">
      <div class="col-span-12 lg:col-span-5 reveal">
        <p class="text-label-md text-on-surface-variant mb-4">The Approach</p>
        <h2 class="text-heading-lg italic">
          An observant eye for the unscripted.
        </h2>
      </div>
      <div class="hidden lg:block lg:col-span-1"></div>
      <div class="col-span-12 lg:col-span-6 reveal stagger-1">
        <p class="text-body-lg text-on-surface-variant" style="max-width: 65ch;">
          My approach is rooted in warmth and real connection. I believe the most beautiful images aren't staged; they are the quiet glances, the nervous laughter, and the gentle touch that happens when you think no one is watching.
        </p>
        <p class="text-body-lg text-on-surface-variant mt-6" style="max-width: 65ch;">
          I serve as a quiet curator of your day, capturing the unscripted while preserving the elegance of your celebration without interrupting its flow.
        </p>
      </div>
    </div>
  </section>

  <!-- ═══ CURATED COLLECTIONS ═══ -->
  <section class="bg-surface-dim" style="padding-top: var(--spacing-section); padding-bottom: var(--spacing-section);">
    <div class="container-editorial">
      <div class="flex items-end justify-between mb-16 reveal">
        <div>
          <p class="text-label-md text-on-surface-variant mb-4">Featured Work</p>
          <h2 class="text-heading-lg">Curated Collections</h2>
        </div>
        <a href="/portfolio" class="text-label-md text-on-surface-variant hover:text-on-surface cubic-ease hidden sm:block" style="transition-duration: var(--duration-hover);">
          View All Collections
        </a>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {featuredWork.map((entry, i) => {
          const imgPath = `/src/assets/images/portfolio/${entry.coverImage}`;
          const img = portfolioImages[imgPath]?.default;
          return img ? (
            <a href={`/portfolio/${entry.slug}`} class={`group block reveal stagger-${i + 1}`}>
              <div class="overflow-hidden aspect-[2/3] bg-surface-container">
                <Image
                  src={img}
                  alt={`${entry.couple}, ${entry.location}`}
                  widths={[400, 600, 800]}
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                  class="w-full h-full object-cover cubic-ease group-hover:scale-[1.02]"
                  style="transition-duration: var(--duration-slow);"
                  loading="lazy"
                />
              </div>
              <div class="mt-4">
                <h3 class="text-heading-md">{entry.couple}</h3>
                <p class="text-label-md text-on-surface-variant mt-1">{entry.location}</p>
              </div>
            </a>
          ) : null;
        })}
      </div>
    </div>
  </section>

  <!-- ═══ APPROACH PILLARS ═══ -->
  <section style="padding-top: var(--spacing-section); padding-bottom: var(--spacing-section);">
    <div class="container-editorial">
      <p class="text-label-md text-on-surface-variant text-center mb-8 reveal">Our Approach</p>
      <div class="grid grid-cols-1 md:grid-cols-3 gap-16 text-center">
        {[
          { title: 'Intimate', desc: 'Prioritizing genuine emotional connections over poses.' },
          { title: 'Candid', desc: 'Preserving the authentic moments that unfold naturally.' },
          { title: 'Calm', desc: 'A steady, peaceful presence that lets you enjoy every moment.' },
        ].map((pillar, i) => (
          <div class={`reveal stagger-${i + 1}`}>
            <h3 class="text-heading-lg italic mb-4">{pillar.title}</h3>
            <p class="text-body-md text-on-surface-variant">{pillar.desc}</p>
          </div>
        ))}
      </div>
    </div>
  </section>

  <!-- ═══ TESTIMONIAL — Centered Statement ═══ -->
  <section class="bg-surface-dim" style="padding-top: var(--spacing-section); padding-bottom: var(--spacing-section);">
    <div class="container-editorial max-w-3xl text-center reveal">
      <p class="text-label-md text-on-surface-variant mb-8">{site.name}</p>
      <TestimonialCard
        name={testimonials[0].name}
        event={testimonials[0].event}
        quote={testimonials[0].quote}
        rating={testimonials[0].rating}
      />
    </div>
  </section>

  <!-- ═══ CTA — Start the Conversation ═══ -->
  <section class="bg-surface-dark" style="padding-top: var(--spacing-section); padding-bottom: var(--spacing-section);">
    <div class="container-editorial text-center reveal">
      <p class="text-label-sm text-on-dark-variant mb-6">Availability is limited</p>
      <h2 class="text-display-md text-on-dark">
        Start the Conversation
      </h2>
      <p class="text-body-lg text-on-dark-variant mt-6 max-w-xl mx-auto">
        Every booking for this upcoming season, let's discuss how we can document your story with the care it deserves.
      </p>
      <div class="mt-10">
        <Button href="/contact" variant="primary">Inquire Now</Button>
      </div>
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 2: Start dev server and verify in browser**

```bash
cd /Users/akashdesai/projects/kashklicks
pnpm dev
```

Open `http://localhost:4321` in a browser. Verify:
- Splash overlay appears on first visit
- Hero section renders with serif display text
- Glassmorphism nav works (transparent -> blur on scroll)
- Section backgrounds alternate (background -> surface-dim -> background)
- Scroll reveal animations fire
- Footer renders with dark surface
- Mobile menu opens/closes
- No gold colors anywhere
- No rounded corners anywhere

- [ ] **Step 3: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: redesign homepage with editorial gallery layout

Splash overlay, full-bleed hero with serif display text,
hero-split intro, curated collections grid, approach pillars,
centered testimonial, dark CTA section. No gold, no rounding."
```

---

## Task 10: Redesign Remaining Pages

This task covers the remaining page conversions. Each page follows the same pattern: replace the old layout with editorial patterns using the new design tokens. Since the approach is iterative, each page should be built, visually verified in the browser, and committed individually.

**Files:**
- Modify: `src/pages/portfolio/index.astro`
- Modify: `src/pages/portfolio/[slug].astro`
- Modify: `src/pages/pricing.astro`
- Modify: `src/pages/about.astro`
- Modify: `src/pages/contact.astro`
- Modify: `src/pages/services.astro`
- Modify: `src/pages/location-guide.astro`
- Modify: `src/pages/blog/index.astro`
- Modify: `src/pages/404.astro`
- Modify: `src/layouts/BlogLayout.astro`
- Modify: `src/components/forms/ContactForm.astro`

- [ ] **Step 1: Redesign portfolio/index.astro**

Apply the Portfolio reference design:
- Large serif heading "Capturing the Unspoken" with italic treatment (text-display-md)
- Asymmetric gallery layout using grid-editorial with varied column spans
- Alternating large images (8-col) and text blocks (4-col) using Editorial Stagger pattern
- Philosophy quote section using Centered Statement pattern (text-quote, max-w-3xl, centered)
- "Reserve your date" CTA using dark surface section
- Filter tabs in text-label-md for categories
- Portfolio cards use the new PortfolioCard component
- All reveal classes for scroll animations

Verify in browser at `/portfolio`, then commit:
```bash
git add src/pages/portfolio/index.astro
git commit -m "feat: redesign portfolio index with asymmetric editorial layout"
```

- [ ] **Step 2: Redesign portfolio/[slug].astro**

Apply the Weddings Collection reference design:
- Collection title in text-display-md serif
- Full-bleed hero image
- Editorial story layout using Editorial Stagger pattern: large image on one side, story text block on the other, alternating
- Pull quote using text-quote centered
- Bento Gallery pattern for gallery images: mixed grid with 8-col + 4-col combinations, 8px gaps
- "Collection Archives" section linking to related galleries
- Replace PortfolioSidebar with inline editorial content

Verify in browser at any `/portfolio/[slug]` page, then commit:
```bash
git add src/pages/portfolio/[slug].astro
git commit -m "feat: redesign collection detail pages with editorial story layout"
```

- [ ] **Step 3: Redesign pricing.astro**

Apply the Investment reference design:
- "Investment" heading in text-display-md with editorial quote alongside
- Full-bleed hero imagery
- Pricing cards using new PricingCard on surface-dim background
- Use varied column widths (not a standard 3-col grid): e.g., 5-col, 3-col, 4-col
- "A Guidance-Led Experience" section with process steps
- FAQ section using FAQAccordion component
- Dual CTA: "Inquire for Custom" (primary) + "Download Portfolio" (secondary)

Verify in browser at `/pricing`, then commit:
```bash
git add src/pages/pricing.astro
git commit -m "feat: redesign pricing as Investment page with editorial layout"
```

- [ ] **Step 4: Redesign about.astro**

Apply the About/Experience reference design:
- "The Quiet Observer" or equivalent massive serif heading (text-display-lg)
- Asymmetric bio using Hero Split pattern: story text left (5-col), portrait right (6-col)
- 3 pillars section: The Curated Frame, Natural Luminosity, Timeless Aesthetic in text-heading-lg italic
- "Our Process" section using Feature List pattern (2x2 asymmetric grid)
- "Let's find the light" CTA using dark surface section

Verify in browser at `/about`, then commit:
```bash
git add src/pages/about.astro
git commit -m "feat: redesign about as The Experience with editorial bio layout"
```

- [ ] **Step 5: Redesign contact.astro and ContactForm.astro**

Apply the Inquiry reference design:
- "Let's capture the fleeting moments" large serif heading with italic (text-display-md)
- Asymmetric layout: dark image block left (5-col), form right (6-col with 1-col gap)
- Replace ContactForm with FloatingInput/FloatingSelect/FloatingTextarea components
- Form fields: Name, Email, Event Type (dropdown), Date, Location, Message
- Bottom-border-only styling
- "Submit Inquiry" button in primary variant
- Direct contact info section below form
- Keep Formspree integration and validation logic

Verify in browser at `/contact`, then commit:
```bash
git add src/pages/contact.astro src/components/forms/ContactForm.astro
git commit -m "feat: redesign contact as Inquiry with floating label form"
```

- [ ] **Step 6: Restyle services.astro**

No reference design for this page, so apply the new design system tokens and layout patterns:
- Replace SectionHeading with inline serif headings + label-md subtitles
- Use grid-editorial and asymmetric patterns
- Remove all rounded corners, gold colors, and old token references
- Use tonal surface alternation for section backgrounds

Verify in browser at `/services`, then commit:
```bash
git add src/pages/services.astro
git commit -m "feat: restyle services page with Digital Curator design system"
```

- [ ] **Step 7: Restyle location-guide.astro**

Same approach as services: apply new tokens, remove old references, use editorial layout patterns. LocationCard component may need updating to remove rounded corners and old colors.

Verify in browser at `/location-guide`, then commit:
```bash
git add src/pages/location-guide.astro src/components/ui/LocationCard.astro
git commit -m "feat: restyle location guide with Digital Curator design system"
```

- [ ] **Step 8: Restyle blog/index.astro and BlogLayout.astro**

- Blog index: replace SectionHeading, apply editorial grid, serif headings
- BlogLayout: update prose styles to match prose-editorial class, update heading/link colors to new tokens

Verify in browser at `/blog`, then commit:
```bash
git add src/pages/blog/index.astro src/layouts/BlogLayout.astro
git commit -m "feat: restyle blog pages with Digital Curator design system"
```

- [ ] **Step 9: Restyle 404.astro**

Minimal editorial 404: large serif heading "Page not found", body text, link back to home.

Verify in browser at any non-existent URL, then commit:
```bash
git add src/pages/404.astro
git commit -m "feat: restyle 404 page with Digital Curator design system"
```

- [ ] **Step 10: Delete SectionHeading component if no longer used**

```bash
# Check if SectionHeading is still imported anywhere
grep -r "SectionHeading" src/
```

If no results, delete it:
```bash
rm src/components/ui/SectionHeading.astro
git add -u src/components/ui/SectionHeading.astro
git commit -m "chore: remove unused SectionHeading component"
```

- [ ] **Step 11: Final build verification**

```bash
cd /Users/akashdesai/projects/kashklicks
pnpm build 2>&1 | tail -10
```

Expected: Clean build, all pages generated, no errors.

---

## Task 11: Sound Files and Final Polish

**Files:**
- Create: `public/sounds/ambient-drone.mp3`
- Create: `public/sounds/page-turn.mp3`
- Create: `public/sounds/shutter.mp3`

- [ ] **Step 1: Source or create sound files**

Sound files need to be sourced. Options:
- Use royalty-free ambient sounds from freesound.org or similar
- Generate with a tool like Audacity
- Use placeholder silence files for now and replace later

For placeholder approach:
```bash
mkdir -p public/sounds
# Create minimal silent MP3 placeholders (will be replaced with real sounds)
# These must be valid MP3 files. Use ffmpeg if available:
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 5 -q:a 9 public/sounds/ambient-drone.mp3 2>/dev/null || echo "Install ffmpeg or add sound files manually"
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.5 -q:a 9 public/sounds/page-turn.mp3 2>/dev/null || echo "Install ffmpeg or add sound files manually"
ffmpeg -f lavfi -i anullsrc=r=44100:cl=mono -t 0.3 -q:a 9 public/sounds/shutter.mp3 2>/dev/null || echo "Install ffmpeg or add sound files manually"
```

- [ ] **Step 2: Verify total sound file size**

```bash
ls -la public/sounds/
# Total should be under 150KB
```

- [ ] **Step 3: Final browser walkthrough**

Start dev server and verify every page:
```bash
pnpm dev
```

Check each page for:
- [ ] No gold/accent colors remaining
- [ ] No rounded corners anywhere
- [ ] Glassmorphism nav works on all pages
- [ ] Splash page shows once per session on homepage
- [ ] Sound toggle appears and works
- [ ] Scroll reveal animations fire on all pages
- [ ] Mobile menu works
- [ ] Footer renders correctly
- [ ] All links work
- [ ] Images load with surface-container placeholder
- [ ] Forms submit correctly

- [ ] **Step 4: Commit**

```bash
git add public/sounds/
git commit -m "feat: add placeholder sound files for ambient sound system

Placeholder silence files to be replaced with real ambient sounds.
ambient-drone.mp3, page-turn.mp3, shutter.mp3"
```
