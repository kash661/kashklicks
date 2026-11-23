import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import faq from '../../src/data/faq.json' with { type: 'json' };

// Spec section 5 (the payment change, 2026-11-23): the site text a couple reads before signing must tell the
// same payment rule as every new contract. A 25% retainer by e-transfer when signing, the balance in cash on
// the day, before shooting starts. Weddings pay in two parts: no second and no final payment (5.0, C39).
// The exact texts of 5.4 are pinned word for word. The other step lines are the fixer's words (planner and
// owner to confirm, outside the four texts of 5.4 and C43); they are pinned here so they cannot drift back.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

/** The `body` strings of a journey steps array in an astro page, keyed by `label`. */
function journeySteps(file: string, constName: string): Record<string, string> {
  const src = read(file);
  const start = src.indexOf(`const ${constName} = [`);
  expect(start, `${constName} in ${file}`).toBeGreaterThan(-1);
  const block = src.slice(start, src.indexOf('];', start));
  const steps: Record<string, string> = {};
  const re = /label:\s*'([^']+)',\s*title:\s*'[^']*',\s*body:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  for (const m of block.matchAll(re)) steps[m[1]] = (m[2] ?? m[3]).replace(/\\'/g, "'");
  return steps;
}

/** Wording of the old payment rules (50/30/20 for weddings, 50/50 for sessions). None may come back. */
const STALE = [/50\s*%/, /30\s*%/, /20\s*%/, /\bsecond\b[^.]*\bdue\b/i, /\bfinal\b[^.]*\bdue\b/i, /remaining\s+(\d|balance)/i, /two weeks before/i, /once you('re| are) happy/i];
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`); // en dash, em dash

test('the stale wording and dash checks catch what they are meant to catch', () => {
  for (const old of ['The second 30% is due two weeks before your date', "Final 20% due once you're happy", 'The remaining 50% is due', 'Remaining 50% due on the day.', 'A 50% retainer'])
    expect(STALE.some((re) => re.test(old)), old).toBe(true);
  expect(`a ${String.fromCharCode(0x2014)} b`).toMatch(DASHES);
  expect(`1${String.fromCharCode(0x2013)}2`).toMatch(DASHES);
});

function expectNoStalePayment(label: string, text: string) {
  for (const re of STALE) expect(text, `${label}: ${re}`).not.toMatch(re);
  expect(text, `${label}: en or em dash`).not.toMatch(DASHES);
}

test('wedding page: the journey tells the two part rule of a new wedding contract (spec 5.0, 5.4)', () => {
  const steps = journeySteps('src/pages/services/wedding.astro', 'weddingJourneySteps');
  expect(Object.keys(steps)).toEqual(['Step 01', 'Step 02', 'Step 03', 'Step 04', 'Step 05', 'Step 06', 'Step 07']);
  // 5.4 exact.
  expect(steps['Step 03']).toBe('Sign a simple contract. A 25% retainer secures your date and gets things started.');
  // The balance on the wedding day, in cash, before shooting (clause 3.6, the wedding steps of 5.4).
  expect(steps['Step 05']).toBe(
    'I capture everything. The balance is paid in cash on the day, before I start shooting. You be fully present. I handle the memories.',
  );
  // No final payment after delivery any more.
  expect(steps['Step 07']).toBe('Your complete gallery delivered within 2 to 3 months. Private online gallery, yours to keep.');
  for (const [label, body] of Object.entries(steps)) expectNoStalePayment(`wedding ${label}`, body);
});

test('pre-wedding page: the journey tells the balance of a new session contract (spec 5.0, 5.4)', () => {
  const steps = journeySteps('src/pages/services/pre-wedding.astro', 'preWeddingJourneySteps');
  expect(Object.keys(steps)).toEqual(['Step 01', 'Step 02', 'Step 03', 'Step 04', 'Step 05', 'Step 06']);
  // 5.4 exact.
  expect(steps['Step 03']).toBe('Sign a simple contract. A 25% retainer secures your session date and gets things started.');
  // Clause 3.5 and the FAQ on the same page: the balance on or before the shoot day, in cash, before shooting.
  expect(steps['Step 04']).toBe(
    'I capture everything. The balance is paid in cash on or before the day, before I start shooting. You just show up and be yourselves. I handle the rest.',
  );
  for (const [label, body] of Object.entries(steps)) expectNoStalePayment(`pre-wedding ${label}`, body);
});

test('terms page and FAQ: the exact payment texts of spec 5.4, and the terms date moved with the change', () => {
  const terms = read('src/pages/terms.astro');
  expect(terms).toContain(
    '<p><strong>Payment.</strong> A 25% retainer, paid by e-transfer, holds your date at booking. The balance is paid in cash before I start shooting: on or before the shoot day for sessions, and on the wedding day for weddings. Overtime and any extras added on the day are settled on the day.</p>',
  );
  // The payment paragraph changed on 2026-11-23, so the visible "Last Updated" date says so.
  expect(terms).toContain("const lastUpdated = 'November 23, 2026';");
  const payment = (faq as { question: string; answer: string }[]).filter((f) => f.question === 'How does payment work?');
  expect(payment.map((f) => f.answer)).toEqual([
    'A 25% retainer, paid by e-transfer, holds your date at booking. The balance is paid in cash on or before the shoot day, before I start shooting. Any overtime or extras added on the day are settled on the day.',
  ]);
});

test('terms page: the bookings heading and its paragraph name the retainer, not a deposit (spec 5.8)', () => {
  const terms = read('src/pages/terms.astro');
  // Spec 2026-11-23, section 5.8, exact: the heading, then its paragraph right under it.
  const HEADING = '<h2>Bookings and retainers</h2>';
  const PARAGRAPH =
    '<p>A booking is confirmed once the contract is signed and the retainer has arrived. The contract, not this page, is the binding agreement between you and me. It spells out the retainer amount, payment schedule, cancellation policy, and deliverables for your booking.</p>';
  expect(terms.split(HEADING)).toHaveLength(2);
  expect(terms.split(PARAGRAPH)).toHaveLength(2);
  const after = terms.slice(terms.indexOf(HEADING) + HEADING.length);
  expect(after.slice(0, after.indexOf('<p>')).trim()).toBe('');
  expect(after.slice(after.indexOf('<p>'), after.indexOf('</p>') + '</p>'.length)).toBe(PARAGRAPH);
  // The old wording called the retainer a non-refundable deposit. It may not come back.
  expect(terms).not.toContain('Bookings and deposits');
  expect(terms).not.toMatch(/non-refundable deposit/i);
  expect(terms).not.toContain('deposit amount');
  expectNoStalePayment('terms bookings heading', HEADING);
  expectNoStalePayment('terms bookings paragraph', PARAGRAPH);
});

// The AI mirrors (public/mirrors, read by AI search tools) are written by scripts/generate-ai-files.mjs from
// hand copied step lines; pnpm build rewrites them. The generator and the tracked mirrors must both carry the
// new rule.
const WEDDING_MIRROR_STEPS = [
  '3. **Lock In Your Date.** Simple contract, 25% retainer secures the date.',
  '5. **Your Wedding Day.** I capture everything. Balance paid in cash on the day, before I start shooting.',
  '7. **Full Delivery.** Complete gallery in 2 to 3 months.',
];
const PRE_WEDDING_MIRROR_STEPS = [
  '3. **Lock In Your Date.** Simple contract, 25% retainer.',
  '4. **Your Session Day.** Balance paid in cash on or before the day, before I start shooting.',
];

/** The numbered journey lines of a mirror (or of the generator's p('...') calls). */
function journeyLines(text: string): string[] {
  return [...text.matchAll(/^\s*(?:p\(')?(\d\. \*\*[^\n]*?)(?:'\);)?$/gm)].map((m) => m[1]);
}

/** The source of one mirror builder function of the generator. */
function builderSource(src: string, name: string): string {
  const start = src.indexOf(`function ${name}(`);
  expect(start, name).toBeGreaterThan(-1);
  const end = src.indexOf('\nfunction ', start + 1);
  return src.slice(start, end === -1 ? undefined : end);
}

test('AI mirror generator writes the new payment steps (spec 5.0)', () => {
  const gen = read('scripts/generate-ai-files.mjs');
  const lines = [
    ...journeyLines(builderSource(gen, 'buildServiceWeddingMirror')),
    ...journeyLines(builderSource(gen, 'buildServicePreWeddingMirror')),
  ];
  expect(lines.length).toBe(13);
  for (const want of [...WEDDING_MIRROR_STEPS, ...PRE_WEDDING_MIRROR_STEPS]) expect(lines).toContain(want);
  for (const line of lines) expectNoStalePayment(`generator: ${line}`, line);
});

test('tracked AI mirrors carry the new payment steps (spec 5.0)', () => {
  const wedding = journeyLines(read('public/mirrors/services-wedding.md'));
  for (const want of WEDDING_MIRROR_STEPS) expect(wedding).toContain(want);
  for (const line of wedding) expectNoStalePayment(`services-wedding.md: ${line}`, line);
  const pre = journeyLines(read('public/mirrors/services-pre-wedding.md'));
  for (const want of PRE_WEDDING_MIRROR_STEPS) expect(pre).toContain(want);
  for (const line of pre) expectNoStalePayment(`services-pre-wedding.md: ${line}`, line);
});
