// Document rendering for the agreement page: what the couple reads before and after signing.
// Every word of the agreement comes from the server's doc_json, rendered by html.ts.
// The variant strings are never changed: they are what gets hashed and signed.
//
// Same import rule as agreement.ts: html.ts, hash.ts, token.ts, format.ts and types only.
import { agreementToHtml, docHeadHtml, sectionToHtml } from '../lib/agreement/html';
import type { AgreementDoc, Choice } from '../lib/agreement/types';

export type Docs = Record<Choice, AgreementDoc>;
type Section = AgreementDoc['sections'][number];

export const CHOICES: Choice[] = ['share', 'private'];
const SHARING_ROW = 'Sharing choice (section 15)';
const UNDECIDED_ROW = 'You choose at the bottom of this page (section 15). It does not change your price.';
const VARIANT_HEADING: Record<Choice, string> = { share: 'If you choose to share', private: 'If you choose to keep it private' };

/** The first element of an HTML string. */
export function element(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild as HTMLElement;
}

/**
 * Parses both variants. The title, intro, business signature and the list of sections are shown
 * once on the page, so they must be the same in both; if not, this throws and the page does not load.
 */
export function parseVariants(variants: Record<Choice, { doc_json: string }>): Docs {
  const docs = {} as Docs;
  for (const c of CHOICES) docs[c] = JSON.parse(variants[c].doc_json) as AgreementDoc;
  const frame = (d: AgreementDoc) =>
    JSON.stringify([d.title, d.intro, d.business_signature, d.sections.map((s) => [s.num, s.title])]);
  if (frame(docs.share) !== frame(docs.private)) throw new Error('the two variants differ outside their sections');
  return docs;
}

/** "On this page": one link per section, numbered as its heading is. */
export function tocItems(doc: AgreementDoc): HTMLLIElement[] {
  return doc.sections.map((s) => {
    const a = document.createElement('a');
    a.href = `#sec-${s.num}`;
    a.textContent = s.num === 0 ? s.title : `${s.num}. ${s.title}`;
    const li = document.createElement('li');
    li.append(a);
    return li;
  });
}

/**
 * The agreement while it is not signed, with the sign box at the end of the last section.
 * render(null) is the undecided state; render(choice) shows that variant, every section of it.
 * Only sections whose HTML changes are replaced, so the sign box and its focus are never detached.
 */
export function docView(container: HTMLElement, docs: Docs, signDateText: string, signbox: HTMLElement) {
  const opts = { signDateText };
  const shown = new Map<number, string>(); // section number -> the HTML on screen
  const sectionOf = (c: Choice, num: number): Section => docs[c].sections.find((s) => s.num === num)!;
  // The title and the intro, the same in both variants (parseVariants checks), first in the container.
  container.replaceChildren(element(docHeadHtml(docs.share, 'h2')));

  /** A display copy with the sharing row's value replaced. The variant itself is untouched. */
  const undecided = (sec: Section): Section => ({
    ...sec,
    items: sec.items.map((it) =>
      it.type === 'table' ? { ...it, rows: it.rows.map((r) => (r[0] === SHARING_ROW ? [r[0], UNDECIDED_ROW] : r)) } : it,
    ),
  });

  /** Both versions of a section, each in its own card under one heading. */
  function bothVersions(num: number): string {
    const wrap = element(sectionToHtml(sectionOf('share', num), opts));
    wrap.replaceChildren(wrap.querySelector('h2')!);
    for (const c of CHOICES) {
      const card = document.createElement('div');
      card.className = 'agr-variant';
      card.dataset.agrVariant = c;
      const h3 = document.createElement('h3');
      h3.textContent = VARIANT_HEADING[c];
      const inner = element(sectionToHtml(sectionOf(c, num), opts));
      inner.querySelector('h2')?.remove();
      card.append(h3, ...Array.from(inner.childNodes));
      wrap.append(card);
    }
    return wrap.outerHTML;
  }

  /** A section that reads the same in both variants (once the sharing row is hidden) shows once; any other shows both. */
  function undecidedHtml(num: number): string {
    const [a, b] = CHOICES.map((c) => sectionToHtml(undecided(sectionOf(c, num)), opts));
    return a === b ? a : bothVersions(num);
  }

  function render(choice: Choice | null) {
    const anchored = container.contains(signbox);
    const before = anchored ? signbox.getBoundingClientRect().top : 0;
    const sections = docs.share.sections;
    const last = sections[sections.length - 1].num;
    for (const { num } of sections) {
      const html = choice ? sectionToHtml(sectionOf(choice, num), opts) : undecidedHtml(num);
      if (shown.get(num) === html) continue;
      const node = element(html);
      const old = container.querySelector(`#sec-${num}`);
      if (old) old.replaceWith(node);
      else container.append(node);
      shown.set(num, html);
      if (num === last) node.append(signbox);
    }
    // Sections above the sign box changed height: keep the sign box where the reader's eyes are.
    if (anchored) {
      const delta = signbox.getBoundingClientRect().top - before;
      if (delta) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
    }
  }

  return { render };
}

/** The signed agreement, read only, with the signature lines at the end of the last section. */
export function renderSignedDoc(container: HTMLElement, doc: AgreementDoc, signDateText: string, lines: HTMLElement) {
  container.innerHTML = `${docHeadHtml(doc, 'h2')}\n${agreementToHtml(doc, { signDateText })}`;
  const secs = container.querySelectorAll('section.agr-sec');
  (secs[secs.length - 1] ?? container).append(lines);
}
