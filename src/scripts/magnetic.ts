/**
 * Magnetic pull effect for buttons and interactive elements.
 * Add `magnetic` class to any element. It will subtly drift toward
 * the cursor when nearby (max 3px shift). Desktop only.
 */
export function initMagnetic() {
  if (window.matchMedia('(pointer: coarse)').matches) return;

  const elements = document.querySelectorAll<HTMLElement>('.magnetic');
  if (!elements.length) return;

  elements.forEach((el) => {
    el.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';

    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = e.clientX - centerX;
      const dy = e.clientY - centerY;

      // Max 3px pull
      const maxPull = 3;
      const pullX = (dx / rect.width) * maxPull * 2;
      const pullY = (dy / rect.height) * maxPull * 2;

      el.style.transform = `translate(${pullX}px, ${pullY}px)`;
    });

    el.addEventListener('mouseleave', () => {
      el.style.transform = 'translate(0, 0)';
    });
  });
}
