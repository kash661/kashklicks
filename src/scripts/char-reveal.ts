/**
 * Character-by-character reveal for display headings.
 *
 * Add `char-reveal` to any heading. The homepage hero tagline arrives already
 * split from the build (`data-presplit`), so this script never touches its
 * markup. Every other heading is split here, once, at the same three layer
 * structure the build emits: sentence line -> word -> char.
 *
 * The script only writes classes and a `--i` index. All timing, opacity and
 * glyph stabilisation lives in global.css, so no letter gets an inline style,
 * a transform, or a compositor layer of its own.
 */

interface CharCounter {
  index: number;
}

// Split a block of text into sentences on ". " boundaries, keeping trailing
// periods attached. Deliberately lightweight (no full NLP) and matched to the
// build-time helper in src/pages/index.astro.
function splitSentences(text: string): string[] {
  const parts = text.split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
  return parts.length ? parts : [text];
}

// Collapse the source formatting whitespace so indented markup does not turn
// into stray spaces once every word is wrapped.
function normaliseWhitespace(el: HTMLElement): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    texts.push(node as Text);
    node = walker.nextNode();
  }
  texts.forEach((t) => {
    t.data = t.data.replace(/\s+/g, ' ');
  });
  if (texts.length) {
    texts[0].data = texts[0].data.replace(/^\s+/, '');
    texts[texts.length - 1].data = texts[texts.length - 1].data.replace(/\s+$/, '');
  }
}

function appendWords(text: string, target: Node, counter: CharCounter): void {
  const tokens = text.split(/(\s+)/);
  tokens.forEach((token) => {
    if (token === '') return;
    if (/^\s+$/.test(token)) {
      target.appendChild(document.createTextNode(' '));
      return;
    }
    const word = document.createElement('span');
    word.className = 'char-reveal-word';
    for (const char of token) {
      const span = document.createElement('span');
      span.className = 'char-reveal-char';
      span.style.setProperty('--i', String(counter.index));
      span.setAttribute('aria-hidden', 'true');
      span.textContent = char;
      word.appendChild(span);
      counter.index += 1;
    }
    target.appendChild(word);
  });
}

// Walk the original nodes and rebuild them into `target`. Element children are
// cloned shallowly first, so an <em> inside a heading keeps its tag, its
// classes and therefore its italic styling instead of being flattened away.
function appendNodes(nodes: Node[], target: Node, counter: CharCounter): void {
  nodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendWords(node.textContent || '', target, counter);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const source = node as HTMLElement;
    const wrapper = source.cloneNode(false) as HTMLElement;
    appendNodes(Array.from(source.childNodes), wrapper, counter);
    target.appendChild(wrapper);
  });
}

function splitElement(el: HTMLElement): void {
  normaliseWhitespace(el);
  const text = (el.textContent || '').trim();
  if (!text) return;
  el.setAttribute('aria-label', text);

  const counter: CharCounter = { index: 0 };
  const fragment = document.createDocumentFragment();
  const hasElementChildren = Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.ELEMENT_NODE
  );

  if (hasElementChildren) {
    // Structure has to be preserved, so the whole heading becomes one line.
    const line = document.createElement('span');
    line.className = 'char-reveal-line';
    appendNodes(Array.from(el.childNodes), line, counter);
    fragment.appendChild(line);
  } else {
    const sentences = splitSentences(text);
    sentences.forEach((sentence, sIdx) => {
      const line = document.createElement('span');
      line.className = 'char-reveal-line';
      appendWords(sentence, line, counter);
      fragment.appendChild(line);
      if (sIdx < sentences.length - 1) {
        fragment.appendChild(document.createTextNode(' '));
      }
    });
  }

  el.textContent = '';
  el.appendChild(fragment);

  const fadeCount = parseInt(el.dataset.fadePrefixCount || '0', 10);
  if (fadeCount > 0) {
    const chars = el.querySelectorAll<HTMLElement>('.char-reveal-char');
    for (let i = 0; i < Math.min(fadeCount, chars.length); i += 1) {
      chars[i].classList.add('is-prefix');
    }
  }
}

export function initCharReveal(): void {
  const elements = document.querySelectorAll<HTMLElement>('.char-reveal');
  if (!elements.length) return;

  elements.forEach((el) => {
    if (el.querySelector('.char-reveal-char')) return; // already split at build time
    splitElement(el);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const target = entry.target as HTMLElement;
        observer.unobserve(target);

        const fadeOpacity = target.dataset.fadePrefixOpacity;
        if (fadeOpacity) {
          target.style.setProperty('--fade-prefix-opacity', fadeOpacity);
        }

        target.classList.add('is-in');

        // Let the staggered fade finish before the opening clause settles back.
        const charCount = target.querySelectorAll('.char-reveal-char').length;
        window.setTimeout(() => {
          target.classList.add('is-settled');
        }, charCount * 35 + 520);
      });
    },
    { threshold: 0.3 }
  );

  elements.forEach((el) => observer.observe(el));
}
