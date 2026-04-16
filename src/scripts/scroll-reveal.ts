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
