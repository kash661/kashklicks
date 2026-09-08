// src/scripts/scroll-reveal.ts
// IntersectionObserver-based scroll animations
// Elements with class="reveal" fade up when entering the viewport.
// Elements with class="reveal-left" or "reveal-right" slide in from their direction.
// Add stagger-1 through stagger-5 for sequential delays.

export function initScrollReveal(): void {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const allRevealElements = document.querySelectorAll<HTMLElement>(
    '.reveal, .reveal-left, .reveal-right'
  );
  if (!allRevealElements.length) return;

  if (prefersReducedMotion) {
    allRevealElements.forEach((el) => {
      el.classList.add('revealed');
    });
    return;
  }

  // Elements already in the viewport on load are revealed with their
  // transitions temporarily suppressed, so they appear in their final state
  // instead of fading in. That used to mean measuring every element with
  // getBoundingClientRect before the first frame, which forced a full layout
  // and delayed the paint. The observer's first delivery carries the same
  // information for free, so it does the work now.
  let firstDelivery = true;

  const observer = new IntersectionObserver(
    (entries) => {
      const initialPass = firstDelivery;
      firstDelivery = false;

      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        if (initialPass) {
          entry.target.classList.add('no-reveal-transition');
        }
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      });

      if (!initialPass) return;
      // Re-enable transitions on the next frame so scroll-triggered reveals
      // below the fold animate normally.
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.querySelectorAll('.no-reveal-transition').forEach((el) => {
            el.classList.remove('no-reveal-transition');
          });
        });
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  allRevealElements.forEach((el) => observer.observe(el));
}
