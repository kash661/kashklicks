/**
 * Magnetic pull effect for buttons and interactive elements.
 * Add `magnetic` class to any element. It will subtly drift toward
 * the cursor when nearby (max 3px shift). Desktop only.
 *
 * Writes to CSS custom properties --magnetic-x / --magnetic-y so the
 * transform property stays composable with other effects (e.g., :active
 * scale press feedback on the same element). Those custom properties are
 * @property-registered in global.css with a CSS transition, so the
 * browser interpolates per-frame — no JS animation framework required.
 *
 * Replaced gsap.quickTo on 2026-05-26 PM to eliminate the 72KB GSAP
 * static-import that magnetic.ts was bringing into every BaseLayout-using
 * page on the site.
 */
export function initMagnetic() {
  if (window.matchMedia('(pointer: coarse)').matches) return;

  const elements = document.querySelectorAll<HTMLElement>('.magnetic');
  if (!elements.length) return;

  elements.forEach((el) => {
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const dx = e.clientX - rect.left - rect.width / 2;
      const dy = e.clientY - rect.top - rect.height / 2;
      const maxPull = 3;
      const pullX = (dx / rect.width) * maxPull * 2;
      const pullY = (dy / rect.height) * maxPull * 2;
      el.style.setProperty('--magnetic-x', `${pullX}px`);
      el.style.setProperty('--magnetic-y', `${pullY}px`);
    });

    el.addEventListener('mouseleave', () => {
      el.style.setProperty('--magnetic-x', '0px');
      el.style.setProperty('--magnetic-y', '0px');
    });
  });
}
