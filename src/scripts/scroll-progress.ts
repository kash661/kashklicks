// src/scripts/scroll-progress.ts
// Updates --scroll-progress on :root as the document scrolls.
// Consumed by .scroll-progress::after for a top-of-viewport hairline.

export function initScrollProgress(): void {
  const root = document.documentElement;
  let ticking = false;

  function update() {
    const max = root.scrollHeight - root.clientHeight;
    const progress = max > 0 ? root.scrollTop / max : 0;
    root.style.setProperty('--scroll-progress', String(progress));
    ticking = false;
  }

  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(update);
      ticking = true;
    }
  }

  update();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', update, { passive: true });
}
