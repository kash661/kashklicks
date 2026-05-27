import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

type Cleanup = () => void;

const noop: Cleanup = () => {};

/**
 * A1 — Plate-rule unfurl.
 * The small hairline next to "Plate I" / "Plate II" / "Plate III" in Recent Work
 * captions draws in from the left when its parent figcaption enters the
 * viewport. The gallery-docent beat — the rule is the wall-label being hung.
 *
 * Scoped to Recent Work only. Journal captions were intentionally left static
 * to keep the lower half of the page lighter on motion.
 */
function initPlateRuleUnfurl(): Cleanup {
  const mm = gsap.matchMedia();

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const rules = document.querySelectorAll<HTMLElement>('.recent-work__plate-rule');
    if (!rules.length) return noop;

    rules.forEach((rule) => {
      gsap.set(rule, { scaleX: 0, transformOrigin: 'left center' });

      gsap.to(rule, {
        scaleX: 1,
        duration: 0.6,
        ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
        scrollTrigger: {
          trigger: rule,
          start: 'top 92%',
          once: true,
        },
      });
    });

    return () => {
      rules.forEach((rule) => gsap.set(rule, { clearProps: 'all' }));
    };
  });

  return () => mm.revert();
}

/**
 * A4 — Contact-CTA bracketed reveal.
 * Closing title card: left rule draws in from its outer edge, "Get in touch"
 * link fades up, right rule draws in from its outer edge. Bracket-shaped reveal
 * matches the cinematic-close framing.
 *
 * Requires index.astro to mark the actions block with [data-cta-bracket] instead
 * of the default .reveal class so this script owns the choreography.
 */
function initContactCtaBracket(): Cleanup {
  const mm = gsap.matchMedia();

  mm.add('(prefers-reduced-motion: no-preference)', () => {
    const block = document.querySelector<HTMLElement>('[data-cta-bracket]');
    if (!block) return noop;

    const rules = block.querySelectorAll<HTMLElement>('.contact-cta__rule');
    const link = block.querySelector<HTMLElement>('.contact-cta__link');
    if (rules.length < 2 || !link) return noop;

    const leftRule = rules[0];
    const rightRule = rules[1];

    gsap.set(leftRule, { scaleX: 0, transformOrigin: 'right center' });
    gsap.set(rightRule, { scaleX: 0, transformOrigin: 'left center' });
    gsap.set(link, { opacity: 0, y: 6 });

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: block,
        start: 'top 80%',
        once: true,
      },
    });

    tl.to(leftRule, {
      scaleX: 1,
      duration: 0.6,
      ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
    }, 0)
      .to(link, {
        opacity: 1,
        y: 0,
        duration: 0.5,
        ease: 'power3.out',
      }, 0.15)
      .to(rightRule, {
        scaleX: 1,
        duration: 0.6,
        ease: 'cubic-bezier(0.22, 1, 0.36, 1)',
      }, 0.3);

    return () => {
      tl.kill();
      gsap.set([leftRule, rightRule, link], { clearProps: 'all' });
    };
  });

  // Reduced-motion fallback: still surface the block (it expects gsap to drive
  // visibility, so we set final state explicitly).
  mm.add('(prefers-reduced-motion: reduce)', () => {
    const block = document.querySelector<HTMLElement>('[data-cta-bracket]');
    if (!block) return noop;
    const rules = block.querySelectorAll<HTMLElement>('.contact-cta__rule');
    const link = block.querySelector<HTMLElement>('.contact-cta__link');
    gsap.set(rules, { scaleX: 1, transformOrigin: 'center' });
    if (link) gsap.set(link, { opacity: 1, y: 0 });
    return noop;
  });

  return () => mm.revert();
}

/**
 * Entry point — initialises homepage motion beats.
 *
 * Trimmed 2026-05-26 PM after density audit:
 *  - A2 (image clip-path reveal) cut — was layering a 5th treatment on
 *    photographs that already had .reveal + .scale-reveal + parallax + hover-zoom.
 *  - A5 (video grade lift) cut — Safari-flaky filter transition with no
 *    perceived gain (the brief itself flagged it as "nobody notices consciously").
 *  - A1 narrowed to Recent Work only — Journal section kept static for calmer pacing.
 */
export function initHomepageMotion(): Cleanup {
  const cleanups: Cleanup[] = [
    initPlateRuleUnfurl(),
    initContactCtaBracket(),
  ];

  return () => cleanups.forEach((c) => c?.());
}
