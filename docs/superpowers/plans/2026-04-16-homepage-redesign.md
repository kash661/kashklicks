# Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the homepage as an image-forward gallery walk with scroll interactions, CTAs for investment and contact, and a testimonial section.

**Architecture:** Single-page rewrite of `src/pages/index.astro` with new CSS classes in `global.css` for parallax, directional reveals, and hover zoom. A new `src/scripts/parallax.ts` script handles scroll-driven parallax and scale effects. Images are hand-picked from existing portfolio galleries.

**Tech Stack:** Astro 5, Tailwind CSS 4, vanilla JS (IntersectionObserver + requestAnimationFrame)

**Spec:** `docs/superpowers/specs/2026-04-16-homepage-redesign.md`

---

### Task 1: Add scroll interaction CSS classes to global.css

**Files:**
- Modify: `src/styles/global.css`

- [ ] **Step 1: Add directional reveal variants after the existing `.stagger-5` rule (after line ~307)**

```css
/* Directional reveal variants */
.reveal-left {
  opacity: 0;
  transform: translateX(-40px);
  transition: opacity var(--duration-slow) var(--ease-gallery),
              transform var(--duration-slow) var(--ease-gallery);
}

.reveal-right {
  opacity: 0;
  transform: translateX(40px);
  transition: opacity var(--duration-slow) var(--ease-gallery),
              transform var(--duration-slow) var(--ease-gallery);
}

.reveal-left.revealed,
.reveal-right.revealed {
  opacity: 1;
  transform: translateX(0);
}
```

- [ ] **Step 2: Add parallax and hover-zoom utility classes**

```css
/* Parallax container */
.parallax-img {
  will-change: transform;
  transition: transform 0.1s linear;
}

/* Hover zoom for gallery images (desktop only) */
.hover-zoom {
  overflow: hidden;
}

.hover-zoom img {
  transition: transform var(--duration-slow) var(--ease-gallery);
}

.hover-zoom:hover img {
  transform: scale(1.03);
}

/* Scale-on-scroll: starts slightly smaller, JS adds .scaled */
.scale-reveal {
  opacity: 0;
  transform: scale(0.98);
  transition: opacity var(--duration-slow) var(--ease-gallery),
              transform var(--duration-slow) var(--ease-gallery);
}

.scale-reveal.revealed {
  opacity: 1;
  transform: scale(1);
}
```

- [ ] **Step 3: Add gallery caption style**

```css
/* Gallery placard caption */
.gallery-caption {
  font-family: var(--font-sans);
  font-size: 0.75rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  line-height: 1.6;
}
```

- [ ] **Step 4: Add reduced-motion overrides for new classes inside the existing `@media (prefers-reduced-motion: reduce)` block**

```css
  .reveal-left,
  .reveal-right,
  .scale-reveal {
    opacity: 1;
    transform: none;
    transition: none;
  }

  .parallax-img {
    will-change: auto;
    transform: none !important;
  }

  .hover-zoom:hover img {
    transform: none;
  }
```

- [ ] **Step 5: Verify build**

Run: `cd /Users/akashdesai/projects/kashklicks && pnpm build`
Expected: Build succeeds with no CSS errors.

- [ ] **Step 6: Commit**

```bash
git add src/styles/global.css
git commit -m "feat: add directional reveals, parallax, hover-zoom, and gallery caption CSS"
```

---

### Task 2: Create parallax scroll script

**Files:**
- Create: `src/scripts/parallax.ts`

- [ ] **Step 1: Create the parallax script**

```typescript
// src/scripts/parallax.ts
// Scroll-driven parallax and scale-on-enter effects.
// Elements with class="parallax-img" get subtle vertical offset on scroll.
// Elements with class="scale-reveal" scale from 0.98 to 1 on viewport entry.

export function initParallax(): void {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (prefersReducedMotion) {
    document.querySelectorAll('.scale-reveal').forEach((el) => {
      el.classList.add('revealed');
    });
    return;
  }

  // Parallax: subtle vertical offset based on scroll position
  const parallaxElements = document.querySelectorAll<HTMLElement>('.parallax-img');

  if (parallaxElements.length > 0) {
    let ticking = false;

    function updateParallax() {
      const scrollY = window.scrollY;
      parallaxElements.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const elementCenter = rect.top + rect.height / 2;
        const viewportCenter = window.innerHeight / 2;
        const offset = (elementCenter - viewportCenter) * 0.08;
        el.style.transform = `translateY(${offset}px)`;
      });
      ticking = false;
    }

    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(updateParallax);
        ticking = true;
      }
    }, { passive: true });
  }

  // Scale reveal: observe elements and add .revealed class
  const scaleObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('revealed');
          scaleObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15, rootMargin: '0px 0px -20px 0px' }
  );

  document.querySelectorAll('.scale-reveal').forEach((el) => {
    scaleObserver.observe(el);
  });
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/akashdesai/projects/kashklicks && pnpm build`
Expected: Build succeeds. Script not yet imported anywhere, so no runtime effect yet.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/parallax.ts
git commit -m "feat: add parallax scroll and scale-reveal script"
```

---

### Task 3: Update scroll-reveal.ts to handle directional reveals

**Files:**
- Modify: `src/scripts/scroll-reveal.ts`

- [ ] **Step 1: Update initScrollReveal to also observe `.reveal-left` and `.reveal-right` elements**

Replace the entire file content with:

```typescript
// src/scripts/scroll-reveal.ts
// IntersectionObserver-based scroll animations
// Elements with class="reveal" fade up when entering the viewport.
// Elements with class="reveal-left" or "reveal-right" slide in from their direction.
// Add stagger-1 through stagger-5 for sequential delays.

export function initScrollReveal(): void {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const allRevealElements = document.querySelectorAll('.reveal, .reveal-left, .reveal-right');

  if (prefersReducedMotion) {
    allRevealElements.forEach((el) => {
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

  allRevealElements.forEach((el) => {
    observer.observe(el);
  });
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/akashdesai/projects/kashklicks && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/scroll-reveal.ts
git commit -m "feat: extend scroll-reveal to handle directional reveal variants"
```

---

### Task 4: Wire parallax script into BaseLayout

**Files:**
- Modify: `src/layouts/BaseLayout.astro`

- [ ] **Step 1: Import and initialize parallax alongside existing scroll-reveal**

Find the existing script block in BaseLayout.astro that imports and calls `initScrollReveal()`. Add the parallax import and call right after it:

```typescript
import { initParallax } from '../scripts/parallax';
```

And in the initialization block (the `<script>` tag or `document.addEventListener`), add:

```typescript
initParallax();
```

The parallax init should be called in the same lifecycle spot as `initScrollReveal()` (e.g., inside the same DOMContentLoaded handler or inline script). Also re-initialize on Astro view transition navigation by adding it to the existing `astro:after-swap` or `astro:page-load` event listener.

- [ ] **Step 2: Verify build**

Run: `cd /Users/akashdesai/projects/kashklicks && pnpm build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/BaseLayout.astro
git commit -m "feat: wire parallax script into BaseLayout"
```

---

### Task 5: Rewrite the homepage

**Files:**
- Modify: `src/pages/index.astro`

This is the main task. The homepage is rewritten from scratch with 8 sections.

- [ ] **Step 1: Rewrite `src/pages/index.astro`**

Replace the entire file with the following. Images are chosen from existing portfolio galleries. The hero uses `hero-main.jpg`. Gallery images use a curated mix from different couples' folders.

```astro
---
import { Image } from 'astro:assets';
import BaseLayout from '../layouts/BaseLayout.astro';
import Button from '../components/ui/Button.astro';
import testimonials from '../data/testimonials.json';

// Hero image
import heroImage from '../assets/images/hero/hero-main.jpg';

// Curated gallery images (best-of across shoots)
import gallery1 from '../assets/images/portfolio/ayushi-parth/03.jpg';
import gallery2 from '../assets/images/portfolio/alex-aziz/05.jpg';
import gallery3 from '../assets/images/portfolio/shuba-rob/02.jpg';
import gallery4 from '../assets/images/portfolio/meghna-puneeth/04.jpg';
import gallery5 from '../assets/images/portfolio/priyanka-saurav/03.jpg';
import gallery6 from '../assets/images/portfolio/anushka-anthony/01.jpg';
import gallery7 from '../assets/images/portfolio/mania-hitesh/02.jpg';

// Pick one testimonial
const testimonial = testimonials[0];

// JSON-LD structured data
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: 'AD Photography',
  url: 'https://kashklicks.ca',
  description: 'Warm, candid wedding and civil ceremony photography in Toronto and across Canada.',
};
---

<BaseLayout
  title="AD Photography"
  description="Warm, candid wedding and civil ceremony photography in Toronto and across Canada."
  transparentHeader={true}
  showSplash={true}
  jsonLd={jsonLd}
>
  <!-- ═══ 1. HERO ═══ -->
  <section class="relative h-screen w-full overflow-hidden bg-surface-container">
    <Image
      src={heroImage}
      alt="Wedding photography by AD Photography"
      class="absolute inset-0 w-full h-full object-cover"
      widths={[768, 1280, 1920]}
      sizes="100vw"
      quality={85}
      loading="eager"
    />
    <div class="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
    <div class="absolute bottom-12 left-8 md:left-16 gallery-caption text-on-dark/90">
      <p class="font-medium">Ayushi & Parth</p>
      <p class="text-on-dark/60">Toronto, 2025</p>
    </div>
  </section>

  <!-- ═══ 2. PHOTO PAIR + TEXT MOMENT ═══ -->
  <section class="py-[var(--spacing-section)]">
    <div class="grid-editorial">
      <div class="col-span-12 md:col-span-7 hover-zoom reveal-left">
        <Image
          src={gallery1}
          alt="Candid wedding moment"
          class="w-full h-auto parallax-img"
          widths={[640, 960, 1280]}
          sizes="(max-width: 768px) 100vw, 58vw"
          quality={80}
        />
      </div>
      <div class="col-span-12 md:col-span-5 md:mt-24 hover-zoom reveal-right stagger-2">
        <Image
          src={gallery2}
          alt="Intimate pre-wedding portrait"
          class="w-full h-auto parallax-img"
          widths={[640, 960]}
          sizes="(max-width: 768px) 100vw, 42vw"
          quality={80}
        />
      </div>
    </div>
    <div class="container-editorial mt-16 max-w-2xl">
      <p class="text-body-lg text-on-surface-variant reveal stagger-1">
        Quiet moments, real connection. No posing, no pretending.
      </p>
    </div>
  </section>

  <!-- ═══ 3. FULL-BLEED SINGLE IMAGE ═══ -->
  <section class="py-[var(--spacing-section)]">
    <div class="w-full hover-zoom scale-reveal">
      <Image
        src={gallery3}
        alt="Wedding celebration"
        class="w-full h-auto parallax-img"
        widths={[960, 1440, 1920]}
        sizes="100vw"
        quality={80}
      />
    </div>
  </section>

  <!-- ═══ 4. INVESTMENT CTA ═══ -->
  <section class="py-[var(--spacing-section)] bg-background">
    <div class="container-editorial text-center reveal">
      <p class="text-label-md text-on-surface-variant mb-6">Investment</p>
      <h2 class="text-heading-lg text-on-surface mb-8">Collections start at $500</h2>
      <Button href="/investment" variant="primary">View Collections</Button>
    </div>
  </section>

  <!-- ═══ 5. TWO MORE PHOTOS (MAGAZINE SPREAD) ═══ -->
  <section class="py-[var(--spacing-section)]">
    <div class="grid-editorial">
      <div class="col-span-12 md:col-span-8 hover-zoom reveal-left">
        <Image
          src={gallery4}
          alt="Candid moment during ceremony"
          class="w-full h-auto parallax-img"
          widths={[640, 960, 1280]}
          sizes="(max-width: 768px) 100vw, 66vw"
          quality={80}
        />
      </div>
      <div class="col-span-12 md:col-span-4 flex flex-col gap-6 reveal-right stagger-2">
        <div class="hover-zoom">
          <Image
            src={gallery5}
            alt="Pre-wedding portrait"
            class="w-full h-auto parallax-img"
            widths={[480, 640]}
            sizes="(max-width: 768px) 100vw, 33vw"
            quality={80}
          />
        </div>
        <div class="hover-zoom stagger-3">
          <Image
            src={gallery6}
            alt="Couple portrait"
            class="w-full h-auto parallax-img"
            widths={[480, 640]}
            sizes="(max-width: 768px) 100vw, 33vw"
            quality={80}
          />
        </div>
      </div>
    </div>
  </section>

  <!-- ═══ 6. REVIEW ═══ -->
  <section class="py-[var(--spacing-section)] bg-surface-dim">
    <div class="container-editorial text-center max-w-3xl reveal">
      <blockquote class="text-quote text-on-surface mb-8">
        "{testimonial.quote}"
      </blockquote>
      <p class="text-label-md text-on-surface-variant">
        {testimonial.name} &middot; {testimonial.event}
      </p>
    </div>
  </section>

  <!-- ═══ 7. CONTACT CTA ═══ -->
  <section class="py-[var(--spacing-section)] bg-surface-dark">
    <div class="container-editorial text-center reveal">
      <h2 class="text-heading-lg text-on-dark mb-4">Start the Conversation</h2>
      <p class="text-body-lg text-on-dark-variant mb-10">
        Let's talk about your day. No obligations, just a conversation.
      </p>
      <Button href="/contact" variant="secondary">Get in Touch</Button>
    </div>
  </section>

  <!-- ═══ 8. FINAL IMAGE ═══ -->
  <section class="py-[var(--spacing-section)]">
    <div class="container-editorial">
      <div class="hover-zoom scale-reveal">
        <Image
          src={gallery7}
          alt="Wedding moment"
          class="w-full h-auto parallax-img"
          widths={[960, 1440, 1920]}
          sizes="(max-width: 768px) 100vw, 90vw"
          quality={80}
        />
      </div>
    </div>
  </section>
</BaseLayout>
```

- [ ] **Step 2: Verify the dev server renders correctly**

Run: `cd /Users/akashdesai/projects/kashklicks && pnpm dev`
Open `http://localhost:4321` in a browser. Check:
- Hero is full viewport with caption bottom-left
- Photos reveal as you scroll (fade up, slide from left/right)
- Parallax effect is visible on scroll
- Hover zoom works on desktop
- Both CTAs are visible and link correctly
- Testimonial displays properly
- Page ends with a final image

- [ ] **Step 3: Verify production build**

Run: `cd /Users/akashdesai/projects/kashklicks && pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: redesign homepage as gallery walk with scroll interactions"
```

---

### Task 6: Verify and polish

**Files:**
- Possibly modify: `src/pages/index.astro`, `src/styles/global.css`

- [ ] **Step 1: Test on mobile viewport**

Open dev tools, set viewport to 375px width. Verify:
- Hero fills viewport, caption is readable
- Photo pairs stack to single column
- All sections have appropriate spacing
- No horizontal overflow

- [ ] **Step 2: Test scroll interactions**

Scroll through the entire page on desktop and verify:
- Directional reveals fire correctly (left images from left, right from right)
- Parallax creates subtle depth without janking
- Scale reveals transition smoothly from 98% to 100%
- Staggered entrances have visible delay between paired images
- Hover zoom is smooth on all gallery images

- [ ] **Step 3: Test reduced motion**

In browser dev tools, enable "prefers-reduced-motion: reduce". Verify:
- All images appear immediately (no reveal animation)
- No parallax movement
- No hover zoom effect
- Page is fully functional and all content visible

- [ ] **Step 4: Run production build and verify**

Run: `cd /Users/akashdesai/projects/kashklicks && pnpm build`
Expected: Build succeeds. Page weight for homepage should be reasonable (check with network tab).

- [ ] **Step 5: Final commit if any polish was needed**

```bash
git add -A
git commit -m "fix: polish homepage scroll interactions and responsive layout"
```
