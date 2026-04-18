// src/scripts/scroll-reveal.ts
// IntersectionObserver-based scroll animations
// Elements with class="reveal" fade up when entering the viewport.
// Elements with class="reveal-left" or "reveal-right" slide in from their direction.
// Add stagger-1 through stagger-5 for sequential delays.

export function initScrollReveal(): void {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const allRevealElements = document.querySelectorAll<HTMLElement>(
    '.reveal, .reveal-left, .reveal-right, .unmask, .unmask-l, .unmask-r'
  );

  if (prefersReducedMotion) {
    allRevealElements.forEach((el) => {
      el.classList.add('revealed');
    });
    return;
  }

  // Immediately reveal elements already in the viewport on page load, with
  // their transitions temporarily suppressed so they appear in their final
  // state without fading in. Stops the "flicker" when a new page loads and
  // above-the-fold content pops from opacity 0 -> 1 over 600ms.
  const viewportH = window.innerHeight;
  allRevealElements.forEach((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.top < viewportH && rect.bottom > 0) {
      el.classList.add('no-reveal-transition', 'revealed');
    }
  });
  // Re-enable transitions on the next frame so scroll-triggered reveals
  // below the fold animate normally.
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('.no-reveal-transition').forEach((el) => {
        el.classList.remove('no-reveal-transition');
      });
    });
  });

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
    if (!el.classList.contains('revealed')) observer.observe(el);
  });
}
