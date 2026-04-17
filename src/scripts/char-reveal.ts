/**
 * Character-by-character reveal for display headings.
 * Add `char-reveal` class to any heading. Text fades in letter-by-letter
 * when the element enters the viewport.
 */
export function initCharReveal() {
  const elements = document.querySelectorAll<HTMLElement>('.char-reveal');
  if (!elements.length) return;

  elements.forEach((el) => {
    const text = el.textContent || '';
    el.textContent = '';
    el.setAttribute('aria-label', text);

    // Emit spaces as plain text nodes so the browser can break lines at word
    // boundaries; non-breaking spaces made the whole heading one unbreakable
    // string and overflowed narrow columns.
    text.split('').forEach((char, i) => {
      if (char === ' ') {
        el.appendChild(document.createTextNode(' '));
        return;
      }
      const span = document.createElement('span');
      span.textContent = char;
      span.style.opacity = '0';
      span.style.transition = `opacity 0.08s cubic-bezier(0.22, 1, 0.36, 1)`;
      span.style.transitionDelay = `${i * 35}ms`;
      span.setAttribute('aria-hidden', 'true');
      el.appendChild(span);
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const target = entry.target as HTMLElement;
          const spans = target.querySelectorAll<HTMLSpanElement>('span');
          spans.forEach((span) => {
            span.style.opacity = '1';
          });

          // Optional: after the full char-reveal finishes, fade the first N
          // letter spans to a lower opacity (used for tagline emphasis where
          // the first clause should settle back once it has been read).
          const fadeCount = parseInt(target.dataset.fadePrefixCount || '0', 10);
          if (fadeCount > 0) {
            const fadeOpacity = target.dataset.fadePrefixOpacity || '0.4';
            const totalDuration = spans.length * 35 + 120;
            setTimeout(() => {
              spans.forEach((span, idx) => {
                if (idx < fadeCount) {
                  span.style.transition = 'opacity 1500ms cubic-bezier(0.22, 1, 0.36, 1)';
                  span.style.transitionDelay = '0ms';
                  span.style.opacity = fadeOpacity;
                }
              });
            }, totalDuration + 400);
          }

          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );

  elements.forEach((el) => observer.observe(el));
}
