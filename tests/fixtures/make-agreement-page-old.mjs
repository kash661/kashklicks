#!/usr/bin/env node
// Makes tests/fixtures/agreement-page-old.json: answers of bookings made before the payment change of
// 2026-11-23, exactly as the code of 881fd2b (the last commit before that change) made them for
// tests/agreement.spec.ts: the group "a booking made before the simpler page" (a civil booking with the 50%
// retainer, and a wedding paid in three parts, both without a set), and the v=2 answer of the wedding made
// with the simpler page (a set and page content, still paid in three parts). Today's engine makes none of
// them any more (and refuses to render three payments), so the page tests read these stored answers, the
// way the worker serves a booking it stored back then.
//
//   node tests/fixtures/make-agreement-page-old.mjs <empty work folder> [--write]
//
// It copies src/lib and src/data of that commit into the work folder (git archive), bundles the fixture
// code below with it (esbuild from node_modules), runs the bundle, and makes the fixture inside the work
// folder. The fixture code is the fixture code of tests/agreement.spec.ts at 881fd2b (the same inputs and
// expressions; only the type annotations differ). Then it compares that with the tracked
// tests/fixtures/agreement-page-old.json byte for byte (fixture-check.mjs): the same bytes exit 0, a
// difference exits 1, and in both cases the tracked file is not touched. Only --write replaces it.
// Run it to check the file: the point of the fixture is that it does not change.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finishFixture, fixtureArgs } from './fixture-check.mjs';

const COMMIT = '881fd2b';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../..');
const args = fixtureArgs(process.argv.slice(2));
const write = args.write;
const work = args.work ? resolve(args.work) : null;
if (!work) {
  console.error('Usage: node tests/fixtures/make-agreement-page-old.mjs <empty work folder> [--write]');
  process.exit(1);
}
mkdirSync(work, { recursive: true });
if (readdirSync(work).length > 0) {
  console.error(`${work} is not empty`);
  process.exit(1);
}

const old = join(work, 'old');
mkdirSync(old);
const tar = execFileSync('git', ['-C', repo, 'archive', COMMIT, 'src/lib', 'src/data'], { maxBuffer: 1 << 26 });
execFileSync('tar', ['-x', '-C', old], { input: tar });
symlinkSync(join(repo, 'node_modules'), join(old, 'node_modules'));

const lib = (f) => JSON.stringify(join(old, 'src/lib/agreement', f));
const entry = join(work, 'entry.ts');
writeFileSync(
  entry,
  `import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildBookingFacts, buildVariantSet, renderVariant, signLabels, factsFor, laterPaymentRows } from ${lib('render.ts')};
import { longDate, money } from ${lib('format.ts')};
import { mixSummaries, pageContent } from ${lib('page.ts')};
import { docJsonFromSet } from ${lib('set.ts')};
type Choice = 'share' | 'private';

// tests/agreement.spec.ts at ${COMMIT}: the civil booking (PILOT).
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
const NUMBER = 'KK-TEST-2026-001';
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const facts = buildBookingFacts(PILOT, { number: NUMBER, createdAt: new Date('2026-11-10T15:00:00Z') });
const DOCS = { share: renderVariant(facts, 'share'), private: renderVariant(facts, 'private') };
const variant = (c: Choice) => {
  const doc_json = JSON.stringify(DOCS[c]);
  return { doc_json, hash: sha256(doc_json) };
};
const VARIANTS = { share: variant('share'), private: variant('private') };
const LABELS = { ...signLabels(facts), name_expected: facts.client_name };
const SUMMARY = {
  package: facts.package_name,
  date: longDate(facts.event_date),
  total: money(facts.total),
  retainer: money(facts.retainer),
  balance: money(facts.balance),
  etransfer_email: 'info@kashklicks.ca',
};

// tests/agreement.spec.ts at ${COMMIT}: the wedding paid in three parts.
const W_NUMBER = 'KK-TEST-2026-007';
const wFacts = buildBookingFacts(
  {
    package_id: 'wedding-full',
    client_name: 'Elena Marchetti',
    partner_name: 'Daniel Okafor',
    client_email: 'elena@example.com',
    client_phone: '416 555 0177',
    event_date: '2027-05-29',
    start_time: '12:00',
    end_time: '22:00',
    place: 'St. Example Church, Hamilton. Reception in Burlington',
    add_ons: [{ id: 'second-photographer', qty: 7 }],
  },
  { number: W_NUMBER, createdAt: new Date('2026-11-10T15:00:00Z') },
);
const wVariant = (c: Choice) => {
  const doc_json = JSON.stringify(renderVariant(wFacts, c));
  return { doc_json, hash: sha256(doc_json) };
};
const W_VARIANTS = { share: wVariant('share'), private: wVariant('private') };
const W_LABELS = { ...signLabels(wFacts), name_expected: wFacts.client_name };
const summaryOf = (f: typeof wFacts) => ({
  package: f.package_name,
  date: longDate(f.event_date),
  total: money(f.total),
  retainer: money(f.retainer),
  balance: money(f.balance),
  balance_how: 'e-transfer or cash',
  etransfer_email: 'info@kashklicks.ca',
  later_payments: laterPaymentRows(f),
});
const W_SUMMARY = summaryOf(wFacts);
const W_SUMMARY_PRIVATE = summaryOf(factsFor(wFacts, 'private'));

// tests/agreement.spec.ts at ${COMMIT}: v2Booking(...).ready of W2, the wedding made with the simpler page.
function v2Ready(f: any, who: { client_first: string; partner_first: string }) {
  const built = buildVariantSet(f);
  const summaries = mixSummaries(f, built.mixes);
  const mixes: Record<string, any> = {};
  built.mixes.forEach((m, i) => {
    const doc_json = docJsonFromSet(built.pool, m.f);
    mixes[m.id] = { f: m.f, hash: sha256(doc_json), summary: summaries[i] };
  });
  const content = pageContent(f);
  const labels = { ...signLabels(f), name_expected: f.client_name };
  const base = {
    ok: true,
    mode: 'test',
    number: f.number,
    client_first: who.client_first,
    partner_first: who.partner_first,
    client_name: f.client_name,
    partner_name: f.partner_name,
    labels,
  };
  return {
    ...base,
    status: 'opened',
    today: '10 November 2026',
    summary: mixes.share.summary,
    ...(f.private_fee === undefined ? {} : { summary_private: mixes.private.summary }),
    set: { pool: built.pool, mixes },
    ...(content === null ? {} : { page: content }),
  };
}
const W2_READY = v2Ready(
  buildBookingFacts(
    {
      package_id: 'wedding-full',
      client_name: 'Elena Marchetti',
      partner_name: 'Daniel Okafor',
      client_email: 'elena@example.com',
      client_phone: '416 555 0177',
      event_date: '2027-05-29',
      start_time: '12:00',
      end_time: '22:00',
      place: 'St. Example Church, Hamilton. Reception in Burlington',
      add_ons: [{ id: 'second-photographer', qty: 7 }],
    },
    { number: 'KK-TEST-2026-007', createdAt: new Date('2026-11-10T15:00:00Z') },
  ),
  { client_first: 'Elena', partner_first: 'Daniel' },
);

const fixture = {
  made_by: ${JSON.stringify(COMMIT)},
  civil: { variants: VARIANTS, labels: LABELS, summary: SUMMARY },
  wedding: { variants: W_VARIANTS, labels: W_LABELS, summary: W_SUMMARY, summary_private: W_SUMMARY_PRIVATE },
  wedding_set: W2_READY,
};
writeFileSync(${JSON.stringify(join(work, 'agreement-page-old.json'))}, JSON.stringify(fixture, null, 2) + '\\n');
console.log('made agreement-page-old.json in the work folder', VARIANTS.share.hash, VARIANTS.private.hash, W_VARIANTS.share.hash, W_VARIANTS.private.hash, Object.keys(W2_READY.set.mixes).length, W2_READY.set.mixes.share.hash);
`,
);

// The esbuild that astro brings (no npm package is added for this).
const pnpmDir = join(repo, 'node_modules/.pnpm');
const esbuildDir = readdirSync(pnpmDir).filter((d) => /^esbuild@\d/.test(d)).sort().pop();
const esbuild = esbuildDir && join(pnpmDir, esbuildDir, 'node_modules/esbuild/bin/esbuild');
if (!esbuild || !existsSync(esbuild)) {
  console.error('esbuild not found under node_modules/.pnpm');
  process.exit(1);
}
const bundle = join(work, 'make.mjs');
execFileSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning'], { stdio: 'inherit' });
execFileSync(process.execPath, [bundle], { stdio: 'inherit' });
process.exit(finishFixture({ made: join(work, 'agreement-page-old.json'), tracked: join(here, 'agreement-page-old.json'), write }));
