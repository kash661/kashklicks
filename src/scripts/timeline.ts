/**
 * Scroll-driven timeline animation.
 * Each `.timeline-step` fades and slides in from its side (left or right)
 * as it enters the viewport. The connecting line grows progressively.
 */
export function initTimeline() {
  const steps = document.querySelectorAll<HTMLElement>('.timeline-step');
  if (!steps.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('timeline-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.2 }
  );

  steps.forEach((step) => observer.observe(step));
}
