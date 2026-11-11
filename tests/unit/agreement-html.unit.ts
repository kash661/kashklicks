import { test, expect } from '@playwright/test';
import { buildBookingFacts, renderVariant } from '../../src/lib/agreement/render';
import { sha256Hex } from '../../src/lib/agreement/hash';
import { escapeHtml, agreementToHtml, docHeadHtml, sectionToHtml, pdfDocument, pdfDraftDocument } from '../../src/lib/agreement/html';
import type { SignatureBlock } from '../../src/lib/agreement/html';

// Invented people only.
const PILOT = {
  package_id: 'civil-ceremony',
  client_name: 'Priya Sharma',
  partner_name: 'Arjun Mehta',
  client_email: 'priya@example.com',
  client_phone: '416 555 0142',
  event_date: '2026-12-12',
  start_time: '12:00',
  end_time: '14:00',
  place: 'Vaughan City Hall, 2141 Major Mackenzie Dr W, Vaughan, ON L6A 1T1',
  price: 501.25,
  notes: 'Family group photos after the ceremony, inside your 2 hours.',
};
const CTX = { number: 'KK-TEST-2026-001', createdAt: new Date('2026-11-10T15:00:00Z') };
const doc = (over: Record<string, unknown> = {}, choice: 'share' | 'private' = 'share') =>
  renderVariant(buildBookingFacts({ ...PILOT, ...over }, CTX), choice);

const HASH = 'ab'.repeat(32);
const sig = (over: Partial<SignatureBlock> = {}): SignatureBlock => ({
  signed_name: 'Priya Sharma',
  partner_name: 'Arjun Mehta',
  choice: 'share',
  signed_at: new Date('2026-11-10T19:41:00Z'), // 2:41 pm in Toronto
  number: 'KK-TEST-2026-001',
  final_hash: HASH,
  ...over,
});

test('sha256Hex known vector', async () => {
  expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('escapeHtml escapes the five characters', () => {
  expect(escapeHtml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/a&gt;');
});

test('escapes facts', () => {
  const evil = "<img src=x onerror=1> O'Brien";
  const d = doc({ client_name: evil, place: '<script>alert(1)</script> Hall' }, 'share');
  const frag = agreementToHtml(d, { signDateText: '10 November 2026' });
  const pdf = pdfDocument(d, sig({ signed_name: evil, partner_name: '<b>Arjun</b>' }));
  for (const html of [frag, pdf]) {
    expect(html).toContain('&lt;img src=x onerror=1&gt; O&#39;Brien');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Hall');
  }
  expect(pdf).toContain('&lt;b&gt;Arjun&lt;/b&gt;');
  expect(pdf).not.toContain('<b>');
});

test('bold markers become strong', () => {
  const frag = agreementToHtml(doc(), { signDateText: '10 November 2026' });
  const sec0 = frag.slice(frag.indexOf('<section id="sec-0"'), frag.indexOf('<section id="sec-1"'));
  expect(sec0).toContain('<strong>You</strong> are Priya Sharma.');
  expect(sec0).toContain('<strong>I</strong> am Akash Desai');
  expect(frag).not.toContain('**');
});

test('fragment has every section and no raw placeholder', () => {
  const d = doc();
  const frag = agreementToHtml(d, { signDateText: '10 November 2026' });
  for (let n = 0; n <= 22; n += 1) expect(frag).toContain(`<section id="sec-${n}" class="agr-sec">`);
  expect(frag).not.toContain('<section id="sec-23"');
  expect(frag).not.toContain('{{');
  expect(frag).toContain('This agreement is dated 10 November 2026.');
  // Structure the page relies on.
  expect(frag).toContain('<h2>Who we are</h2>');
  expect(frag).toContain('<h2>1. Your booking</h2>');
  expect(frag).toContain('<p class="agr-clause"><span class="agr-n">1.1</span> ');
  expect(frag).toContain('<table class="agr-table">');
  expect(frag).toContain('<ul class="agr-list">');
  expect(frag).toContain('<tr><td class="agr-label"><strong>Total</strong></td><td><strong>$501.25</strong></td></tr>');
  // Section 0 clauses carry no number span.
  const sec0 = frag.slice(frag.indexOf('<section id="sec-0"'), frag.indexOf('<section id="sec-1"'));
  expect(sec0).not.toContain('agr-n');
  // The fragment is exactly its sections, one after another.
  expect(frag).toBe(d.sections.map((s) => sectionToHtml(s, { signDateText: '10 November 2026' })).join('\n'));
});

test('sign date text is escaped', () => {
  const frag = agreementToHtml(doc(), { signDateText: '<i>today</i>' });
  expect(frag).toContain('This agreement is dated &lt;i&gt;today&lt;/i&gt;.');
});

test('pdf document is self contained', () => {
  const pdf = pdfDocument(doc(), sig());
  expect(pdf.startsWith('<!doctype html>')).toBe(true);
  expect(pdf).toContain('<title>Photography and Film Agreement, KK-TEST-2026-001</title>');
  for (const bad of ['<script', ' src=', ' href=', 'http', '<link', '<img', '@import', 'url(', 'display:flex', 'display: flex'])
    expect(pdf).not.toContain(bad);
  const style = pdf.slice(pdf.indexOf('<style>'), pdf.indexOf('</style>'));
  for (const bad of ['flex', 'grid', 'position', 'font-face', 'px']) expect(style).not.toContain(bad);
  expect(pdf).not.toContain('{{');
  expect(pdf).not.toMatch(/[–—]/);
});

test('pdf document carries the signature block', () => {
  const d = doc({}, 'share');
  const pdf = pdfDocument(d, sig());
  expect(pdf).toContain('AD Photography');
  expect(pdf).toContain('KashKlicks');
  expect(pdf).toContain('647 613 7430 · info@kashklicks.ca · kashklicks.ca');
  expect(pdf).toContain('<h2>Signed</h2>');
  expect(pdf).toContain('Signed for Akash Desai, operating as AD Photography and KashKlicks, on 10 November 2026');
  expect(pdf).toContain('Signed by Priya Sharma, for themselves and for Arjun Mehta, on 10 November 2026 at 2:41 pm (Toronto time)');
  expect(pdf).toContain('Sharing choice: share. You allow sharing as described in section 15.');
  expect(pdf).toContain('Booking KK-TEST-2026-001');
  expect(pdf).toContain(`Agreement version ${d.clause_version.slice(0, 12)}`);
  expect(pdf).not.toContain(d.clause_version.slice(0, 13));
  expect(pdf).toContain(`Text fingerprint ${HASH}`);
  // The signing date fills the dated clause.
  expect(pdf).toContain('This agreement is dated 10 November 2026.');
  // Every section is in the PDF, the same HTML the page shows.
  expect(pdf).toContain(agreementToHtml(d, { signDateText: '10 November 2026' }));

  const priv = pdfDocument(doc({}, 'private'), sig({ choice: 'private' }));
  expect(priv).toContain('Sharing choice: private. Your work is not shown in public.');
  expect(priv).not.toContain('Sharing choice: share.');
});

test('the PDF frames the sections as the page does: title, then the intro as plain text', () => {
  const d = doc();
  expect(docHeadHtml(d, 'h2')).toBe(
    `<div class="agr-doc-head">\n<h2 class="agr-doc-title">Photography and Film Agreement</h2>\n<p class="agr-intro">${escapeHtml(d.intro)}</p>\n</div>`,
  );
  const pdf = pdfDocument(d, sig());
  // The title and intro come right before the sections, and nothing in the intro is read as markup.
  expect(pdf).toContain(`${docHeadHtml(d, 'h1')}\n${agreementToHtml(d, { signDateText: '10 November 2026' })}`);
  const marked = { ...d, intro: 'Read **all** of it <now>.' };
  expect(docHeadHtml(marked, 'h1')).toContain('<p class="agr-intro">Read **all** of it &lt;now&gt;.</p>');
  expect(pdfDocument(marked, sig())).toContain('<p class="agr-intro">Read **all** of it &lt;now&gt;.</p>');
});

test('pdf document refuses a sharing choice that differs from the document', () => {
  expect(() => pdfDocument(doc({}, 'share'), sig({ choice: 'private' }))).toThrow(
    'signature choice private does not match document choice share',
  );
});

test('pdf document refuses a booking number that differs from the document', () => {
  expect(() => pdfDocument(doc(), sig({ number: 'KK-TEST-2026-002' }))).toThrow(
    'signature booking KK-TEST-2026-002 does not match document booking KK-TEST-2026-001',
  );
});

test('pdfDocument output is pinned byte for byte', async () => {
  // Pinned before pdfDraftDocument shared its frame. A change here changes every emailed copy.
  expect(await sha256Hex(pdfDocument(doc(), sig()))).toBe('d586e131ff48a3b07df3c7df83f4a29afedcd476d1c6be49ac2cab496571eb9e');
  expect(await sha256Hex(pdfDocument(doc({}, 'private'), sig({ choice: 'private' })))).toBe('c9abf60fe2ab86b34a94826222741be3f3152561e94f3fdd7fa881fadef9d575');
});

test('the unsigned copy says so at the top and at the end, for both choices', () => {
  for (const choice of ['share', 'private'] as const) {
    const d = doc({}, choice);
    const html = pdfDraftDocument(d, { signDateText: '10 November 2026' });
    expect(html).toContain('<title>Photography and Film Agreement, KK-TEST-2026-001 (not signed)</title>');
    expect(html).toContain('.agr-draft { font-family: Helvetica, Arial, sans-serif; font-size: 10pt; font-weight: bold; margin: 0 0 12pt 0; }');
    // Right under the letterhead, before the document head.
    expect(html).toContain(`</div>\n<p class="agr-draft">Copy to read. Not signed.</p>\n${docHeadHtml(d, 'h1')}\n`);
    expect(html).toContain(agreementToHtml(d, { signDateText: '10 November 2026' }));
    expect(html).toContain(
      [
        '<section class="agr-signed">',
        '<h2>Not signed yet</h2>',
        '<p>This is a copy to read. It is not signed.</p>',
        `<p>Sharing choice shown in this copy: ${choice}. You choose when you sign.</p>`,
        '<p>Booking KK-TEST-2026-001</p>',
        `<p>Agreement version ${d.clause_version.slice(0, 12)}</p>`,
        '</section>',
      ].join('\n'),
    );
    expect(html).not.toContain('Signed by');
    expect(html).not.toContain('<h2>Signed</h2>');
    expect(html).not.toContain('Text fingerprint');
    expect(html).not.toContain('{{');
  }
});

test('the unsigned copy escapes what it shows', () => {
  const d = { ...doc(), title: 'A <b>title</b>', number: 'KK-<x>', clause_version: '<script>abcdef' };
  const html = pdfDraftDocument(d, { signDateText: '<i>today</i>' });
  expect(html).toContain('<title>A &lt;b&gt;title&lt;/b&gt;, KK-&lt;x&gt; (not signed)</title>');
  expect(html).toContain('<p>Booking KK-&lt;x&gt;</p>');
  expect(html).toContain('<p>Agreement version &lt;script&gt;abcd</p>'); // the first 12 characters, then escaped
  expect(html).toContain('&lt;i&gt;today&lt;/i&gt;');
  expect(html).not.toContain('<script>');
  expect(html).not.toContain('<i>today</i>');
});
