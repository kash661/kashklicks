// Document rendering for the agreement page: what the couple reads before and after signing.
// Every word of the agreement comes from the server's doc_json, rendered by html.ts.
// The document strings are never changed: they are what gets hashed and signed.
//
// Same import rule as agreement.ts: html.ts, hash.ts, token.ts, format.ts, set.ts, parts.ts and types only.
import { agreementToHtml, docHeadHtml, sectionToHtml } from '../lib/agreement/html';
import type { AgreementDoc, Choice } from '../lib/agreement/types';

export type Section = AgreementDoc['sections'][number];

export const CHOICES: Choice[] = ['share', 'private'];
const SHARING_ROW = 'Sharing choice (section 15)';
/** The value of the sharing row of section 1 while no choice is made. Page only, never in a document. */
export const UNDECIDED_ROW = 'You choose this in part 5.';
const VARIANT_HEADING: Record<Choice, string> = { share: 'If you choose to share', private: 'If you choose to keep it private' };

/** The first element of an HTML string. */
export function element(html: string): HTMLElement {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild as HTMLElement;
}

/**
 * One section as the parts show it: the html.ts output with its one <h2> pair swapped for <h3>, so the
 * section heading sits under the part's own h2. The clause text is the html.ts text, unchanged.
 */
export function panelSectionHtml(section: Section, signDateText: string): string {
  const html = sectionToHtml(section, { signDateText });
  if (html.split('<h2>').length !== 2 || html.split('</h2>').length !== 2) throw new Error(`section ${section.num}: not one heading`);
  return html.replace('<h2>', '<h3>').replace('</h2>', '</h3>');
}

/** A display copy with the sharing row's value replaced, or null when the section has no sharing row. The section itself is untouched. */
export function undecidedCopy(sec: Section): Section | null {
  const has = sec.items.some((it) => it.type === 'table' && it.rows.some((r) => r[0] === SHARING_ROW));
  if (!has) return null;
  return {
    ...sec,
    items: sec.items.map((it) =>
      it.type === 'table' ? { ...it, rows: it.rows.map((r) => (r[0] === SHARING_ROW ? [r[0], UNDECIDED_ROW] : r)) } : it,
    ),
  };
}

/** Both versions of a section (panel HTML of each), each in its own card under the one section heading. */
export function bothVersions(html: Record<Choice, string>): string {
  const wrap = element(html.share);
  const heading = wrap.querySelector(':scope > h3');
  if (!heading) throw new Error('a section without its heading');
  wrap.replaceChildren(heading);
  for (const c of CHOICES) {
    const card = document.createElement('div');
    card.className = 'agr-variant';
    card.dataset.agrVariant = c;
    const h4 = document.createElement('h4');
    h4.textContent = VARIANT_HEADING[c];
    const inner = element(html[c]);
    inner.querySelector(':scope > h3')?.remove();
    card.append(h4, ...Array.from(inner.childNodes));
    wrap.append(card);
  }
  return wrap.outerHTML;
}

/** The title, intro, business signature and section list: shown once, so every document must have the same. */
export const frameOf = (d: AgreementDoc): string =>
  JSON.stringify([d.title, d.intro, d.business_signature, d.sections.map((s) => [s.num, s.title])]);

/** The signed agreement, read only, with the signature lines at the end of the last section. */
export function renderSignedDoc(container: HTMLElement, doc: AgreementDoc, signDateText: string, lines: HTMLElement) {
  container.innerHTML = `${docHeadHtml(doc, 'h2')}\n${agreementToHtml(doc, { signDateText })}`;
  const secs = container.querySelectorAll('section.agr-sec');
  (secs[secs.length - 1] ?? container).append(lines);
}
