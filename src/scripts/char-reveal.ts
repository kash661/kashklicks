/**
 * Character-by-character reveal for display headings.
 * Add `char-reveal` class to any heading. Text fades in letter-by-letter
 * when the element enters the viewport.
 */

// Split a block of text into sentences on ". " boundaries, keeping trailing
// periods attached. Works for the kinds of short display text this script
// handles; deliberately lightweight (no full NLP).
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

export function initCharReveal() {
  const elements = document.querySelectorAll<HTMLElement>('.char-reveal');
  if (!elements.length) return;

  elements.forEach((el) => {
    const text = (el.textContent || '').trim();
    el.textContent = '';
    el.setAttribute('aria-label', text);

    // Structure: sentence → word → char.
    //   • Sentence wrappers give multi-sentence text (e.g. "Moments fade.
    //     Memories don't.") a stable place to line-break on mobile.
    //   • Word wrappers keep each word atomic so the browser can only break
    //     between words — never mid-word into inline-block char shards.
    //   • Char wrappers are the animated unit; styles below stabilise glyph
    //     shape across opacity fades.
    const sentences = splitSentences(text);
    let charIndex = 0;

    sentences.forEach((sentence, sIdx) => {
      const line = document.createElement('span');
      line.className = 'char-reveal-line';

      const tokens = sentence.split(/(\s+)/);
      tokens.forEach((token) => {
        if (token === '') return;
        if (/^\s+$/.test(token)) {
          line.appendChild(document.createTextNode(' '));
          return;
        }
        const word = document.createElement('span');
        word.className = 'char-reveal-word';
        for (const char of token) {
          const span = document.createElement('span');
          span.className = 'char-reveal-char';
          span.textContent = char;
          span.style.opacity = '0';
          span.style.transition = 'opacity 0.08s cubic-bezier(0.22, 1, 0.36, 1)';
          span.style.transitionDelay = `${charIndex * 35}ms`;
          // Stabilise glyph across the opacity fade. Italic serifs
          // (Cormorant/Noir et Blanc) trigger contextual alternates on
          // letter-pair transitions — pinning a GPU layer and disabling
          // kern/ligatures/contextual alternates locks each char to its
          // default form.
          span.style.display = 'inline-block';
          span.style.transform = 'translate3d(0, 0, 0)';
          span.style.backfaceVisibility = 'hidden';
          span.style.willChange = 'opacity';
          span.style.fontFeatureSettings =
            '"kern" 0, "liga" 0, "calt" 0, "clig" 0, "dlig" 0, "hlig" 0';
          span.style.fontVariantLigatures = 'none';
          span.style.fontKerning = 'none';
          span.setAttribute('aria-hidden', 'true');
          word.appendChild(span);
          charIndex += 1;
        }
        line.appendChild(word);
      });

      el.appendChild(line);
      if (sIdx < sentences.length - 1) {
        el.appendChild(document.createTextNode(' '));
      }
    });
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const target = entry.target as HTMLElement;
          const chars = target.querySelectorAll<HTMLSpanElement>('.char-reveal-char');
          chars.forEach((span) => {
            span.style.opacity = '1';
          });

          // Optional: after the full char-reveal finishes, fade the first N
          // letter spans to a lower opacity (used for tagline emphasis where
          // the first clause should settle back once it has been read).
          const fadeCount = parseInt(target.dataset.fadePrefixCount || '0', 10);
          if (fadeCount > 0) {
            const fadeOpacity = target.dataset.fadePrefixOpacity || '0.4';
            const totalDuration = chars.length * 35 + 120;
            setTimeout(() => {
              chars.forEach((span, idx) => {
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
