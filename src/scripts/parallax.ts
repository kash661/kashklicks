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
