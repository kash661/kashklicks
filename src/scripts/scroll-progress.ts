// src/scripts/scroll-progress.ts
// Updates transform: scaleX() on .scroll-progress-fill as the document scrolls.
// GPU-accelerated via transform instead of CSS variable + layout recalc.

export function initScrollProgress(): void {
  const progressFill = document.querySelector('.scroll-progress-fill') as HTMLElement | null;
  if (!progressFill) return;

  let ticking = false;

  function update() {
    const root = document.documentElement;
    const max = root.scrollHeight - root.clientHeight;
    const progress = max > 0 ? root.scrollTop / max : 0;
    progressFill!.style.transform = `scaleX(${progress})`;
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
