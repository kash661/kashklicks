import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Cleanup = () => void;

// Animate one timeline section: scrub-draw the line, pulse each dot, and
// fade/slide each step's content. `slideFrom` returns the initial x offset per
// step (desktop alternates by side; mobile always slides in from the right).
function animateSection(section: HTMLElement, slideFrom: (step: HTMLElement) => number) {
  const line = section.querySelector<HTMLElement>('.journey-line');
  const steps = Array.from(section.querySelectorAll<HTMLElement>('.journey-step'));
  const dots = steps.map((s) => s.querySelector<HTMLElement>('.journey-dot'));
  const contents = steps.map((s) => s.querySelector<HTMLElement>('.journey-step-content'));
  if (!line || steps.length === 0) return;

  // Initial hidden state (CSS defaults were visible).
  gsap.set(line, { scaleY: 0 });
  gsap.set(dots, { opacity: 0, scale: 0.4 });
  contents.forEach((content, i) => {
    if (content) gsap.set(content, { opacity: 0, x: slideFrom(steps[i]) });
  });

  // Line draw — scrub-linked to the whole section.
  gsap.to(line, {
    scaleY: 1,
    ease: 'none',
    scrollTrigger: { trigger: section, start: 'top 75%', end: 'bottom 85%', scrub: 0.6 },
  });

  steps.forEach((step, i) => {
    const dot = dots[i];
    const content = contents[i];
    if (!dot || !content) return;

    // Dot: one-shot pulse when it enters a comfortable zone.
    gsap.to(dot, {
      opacity: 1,
      scale: 1,
      duration: 0.4,
      ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
      scrollTrigger: { trigger: dot, start: 'top 65%', toggleActions: 'play none none reverse' },
    });

    // Content: scrubbed fade + slide just after the dot crosses.
    gsap.to(content, {
      opacity: 1,
      x: 0,
      ease: 'none',
      scrollTrigger: { trigger: dot, start: 'top 65%', end: '+=120', scrub: 0.6 },
    });
  });
}

// One init for the single responsive timeline. matchMedia gates desktop vs
// mobile (and prefers-reduced-motion); reverting on breakpoint flip re-runs the
// correct branch. Returns a cleanup that fully reverts.
export function initJourneyTimeline(): Cleanup | undefined {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-journey-timeline]'));
  if (sections.length === 0) return;

  const mm = gsap.matchMedia();

  mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
    sections.forEach((s) => animateSection(s, (step) => (step.dataset.side === 'left' ? -24 : 24)));
  });

  mm.add('(max-width: 767.98px) and (prefers-reduced-motion: no-preference)', () => {
    sections.forEach((s) => animateSection(s, () => 24));
  });

  return () => mm.revert();
}
