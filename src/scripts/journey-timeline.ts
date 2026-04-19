import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Cleanup = () => void;

function initVariant(
  selector: string,
  options: {
    mediaQuery: string;
    lineSelector: string;
    slideFrom: (step: HTMLElement) => number;
  }
): Cleanup | undefined {
  const section = document.querySelector<HTMLElement>(selector);
  if (!section) return;
  if (section.dataset.journeyInitialized === 'true') return;
  section.dataset.journeyInitialized = 'true';

  const mm = gsap.matchMedia();

  mm.add(options.mediaQuery, () => {
    const line = section.querySelector<HTMLElement>(options.lineSelector);
    const steps = Array.from(section.querySelectorAll<HTMLElement>('.journey-step'));
    const dots = steps.map((s) => s.querySelector<HTMLElement>('.journey-dot'));
    const contents = steps.map((s) => s.querySelector<HTMLElement>('.journey-step-content'));

    if (!line || steps.length === 0) return;

    // Set initial hidden state (CSS defaults were visible).
    gsap.set(line, { scaleY: 0 });
    gsap.set(dots, { opacity: 0, scale: 0.4 });
    contents.forEach((content, i) => {
      if (!content) return;
      gsap.set(content, { opacity: 0, x: options.slideFrom(steps[i]) });
    });

    // Line draw — scrub-linked to whole section.
    gsap.to(line, {
      scaleY: 1,
      ease: 'none',
      scrollTrigger: {
        trigger: section,
        start: 'top 75%',
        end: 'bottom 85%',
        scrub: 0.6,
      },
    });

    // Per-step triggers.
    steps.forEach((step, i) => {
      const dot = dots[i];
      const content = contents[i];
      if (!dot || !content) return;

      // Dot: one-shot pulse when it enters a comfortable zone in the viewport.
      gsap.to(dot, {
        opacity: 1,
        scale: 1,
        duration: 0.4,
        ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
        scrollTrigger: {
          trigger: dot,
          start: 'top 65%',
          toggleActions: 'play none none reverse',
        },
      });

      // Content: scrubbed fade + slide over a short range after the dot crosses.
      gsap.to(content, {
        opacity: 1,
        x: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: dot,
          start: 'top 65%',
          end: '+=120',
          scrub: 0.6,
        },
      });
    });

    return () => {
      section.dataset.journeyInitialized = 'false';
    };
  });

  return () => {
    mm.revert();
    section.dataset.journeyInitialized = 'false';
  };
}

export function initJourneyTimelineDesktop(): Cleanup | undefined {
  return initVariant('[data-journey-timeline="desktop"]', {
    mediaQuery: '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
    lineSelector: '.journey-line-desktop',
    slideFrom: (step) => (step.dataset.side === 'left' ? -24 : 24),
  });
}

export function initJourneyTimelineMobile(): Cleanup | undefined {
  return initVariant('[data-journey-timeline="mobile"]', {
    mediaQuery: '(max-width: 767.98px) and (prefers-reduced-motion: no-preference)',
    lineSelector: '.journey-line-mobile',
    slideFrom: () => 24,
  });
}
