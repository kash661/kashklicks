// One code path from an AgreementDoc to HTML: the fragment the page shows, and the full document Apps Script turns
// into the PDF. Every piece of text is escaped. Only the **bold** markers of the clause text become tags.
import businessJson from '../../data/agreement/business.json' with { type: 'json' };
import { torontoStamp } from './format';
import { SIGN_DATE_TOKEN } from './token';
import type { AgreementDoc, Choice, DocItem } from './types';

const BUSINESS = businessJson as unknown as { tradeNames: string[]; phone: string; email: string; website: string };

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Escapes text, turns **x** into <strong>x</strong> and puts the escaped sign date where the token is. */
const inline = (text: string, signDateText: string): string =>
  escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split(SIGN_DATE_TOKEN)
    .join(escapeHtml(signDateText));

const itemToHtml = (item: DocItem, signDateText: string): string => {
  const t = (s: string) => inline(s, signDateText);
  if (item.type === 'clause') {
    const n = item.n ? `<span class="agr-n">${escapeHtml(item.n)}</span> ` : '';
    const bullets = item.bullets.length ? `\n<ul>${item.bullets.map((b) => `<li>${t(b)}</li>`).join('')}</ul>` : '';
    return `<p class="agr-clause">${n}${t(item.text)}</p>${bullets}`;
  }
  if (item.type === 'table') {
    const rows = item.rows.map((row) => {
      const bold = item.bold.includes(row[0]);
      const cells = row.map((cell, i) => {
        const inner = bold ? `<strong>${t(cell)}</strong>` : t(cell);
        return i === 0 ? `<td class="agr-label">${inner}</td>` : `<td>${inner}</td>`;
      });
      return `<tr>${cells.join('')}</tr>`;
    });
    return `<table class="agr-table">\n${rows.join('\n')}\n</table>`;
  }
  return `<ul class="agr-list">${item.items.map((s) => `<li>${t(s)}</li>`).join('')}</ul>`;
};

/** One section: <section id="sec-N" class="agr-sec"> with its heading and items. */
export function sectionToHtml(section: AgreementDoc['sections'][number], opts: { signDateText: string }): string {
  const heading = section.num === 0 ? section.title : `${section.num}. ${section.title}`;
  const body = section.items.map((item) => itemToHtml(item, opts.signDateText)).join('\n');
  return `<section id="sec-${section.num}" class="agr-sec">\n<h2>${escapeHtml(heading)}</h2>\n${body}\n</section>`;
}

/**
 * The frame above the sections: the document title, then the intro as plain text. The page (h2,
 * under its own h1) and the PDF (h1) both use this, so they show the same frame in the same order.
 */
export function docHeadHtml(doc: AgreementDoc, heading: 'h1' | 'h2'): string {
  return `<div class="agr-doc-head">\n<${heading} class="agr-doc-title">${escapeHtml(doc.title)}</${heading}>\n<p class="agr-intro">${escapeHtml(doc.intro)}</p>\n</div>`;
}

/** Every section of the agreement as an HTML fragment for the page. */
export function agreementToHtml(doc: AgreementDoc, opts: { signDateText: string }): string {
  return doc.sections.map((s) => sectionToHtml(s, opts)).join('\n');
}

export interface SignatureBlock {
  signed_name: string;
  partner_name: string;
  choice: Choice;
  signed_at: Date;
  number: string;
  final_hash: string;
}

const SHARING_WORDS: Record<Choice, string> = {
  share: 'Sharing choice: share. You allow sharing as described in section 15.',
  private: 'Sharing choice: private. Your work is not shown in public.',
};

// Apps Script's HTML to PDF conversion handles only simple CSS: block elements, sizes in pt, collapsed tables.
const PDF_STYLE = `
body { font-family: Georgia, 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.45; color: #111; margin: 0; }
.letterhead { font-family: Helvetica, Arial, sans-serif; border-bottom: 0.5pt solid #999; padding-bottom: 8pt; margin-bottom: 16pt; }
.letterhead p { margin: 0; }
.lh-name { font-size: 16pt; font-weight: bold; }
.lh-trade { font-size: 12pt; }
.lh-contact { font-size: 9pt; color: #444; margin-top: 4pt; }
h1 { font-family: Helvetica, Arial, sans-serif; font-size: 16pt; margin: 0 0 8pt 0; }
h2 { font-family: Helvetica, Arial, sans-serif; font-size: 12pt; margin: 16pt 0 6pt 0; }
p { margin: 0 0 6pt 0; }
ul { margin: 0 0 6pt 0; padding-left: 18pt; }
li { margin: 0 0 3pt 0; }
.agr-n { font-weight: bold; }
.agr-table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt 0; }
.agr-table td { border: 0.5pt solid #999; padding: 4pt; vertical-align: top; }
.agr-table td.agr-label { width: 35%; }
.agr-signed { margin-top: 20pt; border-top: 0.5pt solid #999; }
.agr-fingerprint { word-break: break-all; }
`;

// The unsigned copy adds one rule; the signed copy keeps PDF_STYLE exactly as it was.
const PDF_DRAFT_STYLE = `${PDF_STYLE}.agr-draft { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; font-weight: bold; margin: 0 0 12pt 0; }
`;

/** The frame both PDFs share: letterhead, document head, the agreement text, then the closing section. */
function pdfFrame(doc: AgreementDoc, o: { title: string; style: string; lead: string; signDateText: string; closing: string }): string {
  const e = escapeHtml;
  const [trade1, trade2] = BUSINESS.tradeNames;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${e(o.title)}</title>
<style>${o.style}</style>
</head>
<body>
<div class="letterhead">
<p class="lh-name">${e(trade1)}</p>
<p class="lh-trade">${e(trade2)}</p>
<p class="lh-contact">${e(`${BUSINESS.phone} · ${BUSINESS.email} · ${BUSINESS.website}`)}</p>
</div>
${o.lead}${docHeadHtml(doc, 'h1')}
${agreementToHtml(doc, { signDateText: o.signDateText })}
${o.closing}
</body>
</html>
`;
}

/** The complete, self-contained signed agreement for the PDF: inline style only, nothing loaded. */
export function pdfDocument(doc: AgreementDoc, sig: SignatureBlock): string {
  // A PDF must never say two different things.
  if (sig.choice !== doc.choice) throw new Error(`signature choice ${sig.choice} does not match document choice ${doc.choice}`);
  if (sig.number !== doc.number) throw new Error(`signature booking ${sig.number} does not match document booking ${doc.number}`);
  const { date, time } = torontoStamp(sig.signed_at);
  const e = escapeHtml;
  const signed = [
    `<p>${e(doc.business_signature)}</p>`,
    `<p>${e(`Signed by ${sig.signed_name}, for themselves and for ${sig.partner_name}, on ${date} at ${time} (Toronto time)`)}</p>`,
    `<p>${e(SHARING_WORDS[sig.choice])}</p>`,
    `<p>${e(`Booking ${sig.number}`)}</p>`,
    `<p>${e(`Agreement version ${doc.clause_version.slice(0, 12)}`)}</p>`,
    `<p class="agr-fingerprint">${e(`Text fingerprint ${sig.final_hash}`)}</p>`,
  ].join('\n');
  return pdfFrame(doc, {
    title: `${doc.title}, ${sig.number}`,
    style: PDF_STYLE,
    lead: '',
    signDateText: date,
    closing: `<section class="agr-signed">\n<h2>Signed</h2>\n${signed}\n</section>`,
  });
}

/** The unsigned agreement as a copy to read: the same frame, marked as not signed on its first and last lines. */
export function pdfDraftDocument(doc: AgreementDoc, opts: { signDateText: string }): string {
  const e = escapeHtml;
  const closing = [
    '<section class="agr-signed">',
    '<h2>Not signed yet</h2>',
    `<p>${e('This is a copy to read. It is not signed.')}</p>`,
    `<p>${e(`Sharing choice shown in this copy: ${doc.choice}. You choose when you sign.`)}</p>`,
    `<p>${e(`Booking ${doc.number}`)}</p>`,
    `<p>${e(`Agreement version ${doc.clause_version.slice(0, 12)}`)}</p>`,
    '</section>',
  ].join('\n');
  return pdfFrame(doc, {
    title: `${doc.title}, ${doc.number} (not signed)`,
    style: PDF_DRAFT_STYLE,
    lead: `<p class="agr-draft">${e('Copy to read. Not signed.')}</p>\n`,
    signDateText: opts.signDateText,
    closing,
  });
}
