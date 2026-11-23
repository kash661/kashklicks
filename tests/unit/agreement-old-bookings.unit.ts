// The old-booking guard (spec 2026-11-23, section 5.6): every booking stored before the payment change
// opens, signs, downloads and resends exactly as before, byte for byte.
//
// How the fixture was made (tests/unit/fixtures/make-old-bookings.mjs, run once, before the change):
// - the records were made by the code that made that shape, with invented people and fixed fake tokens:
//   bookings without a set by git 20408b9 (the last commit before sets), bookings with a set by git
//   881fd2b (the last commit before the payment change). Two of them have their stored labels and
//   summaries removed, a shape the code still reads (they are worked out when read). One has its
//   balance_cash fact and its summary's balance_how removed: the shape of a booking made by c21d167,
//   before 1b01cc4 added them (review finding: the shape most at risk from the cash only default).
// - every answer was recorded by running the code of git 881fd2b on those records, at a fixed clock:
//   the doc answer with and without v=2, sign with share, with private and with extras (refused for a
//   booking without a set), the doc answer after signing, the PDF route, resend, every KV value and D1
//   row afterwards, every Apps Script call, and copyFields of the signed record.
// This test runs today's code on the same records with the same clock and requests and expects the
// same bytes. Long strings that only answers hold are compared by SHA-256 (see old-bookings-runner.ts).
// Never regenerate the fixture to make this test pass: a difference is an old booking that changed.
import { test, expect } from '@playwright/test';
import { handleAgreement } from '../../src/worker/agreement';
import { copyFields } from '../../src/worker/agreement-copy';
import { packStrings, runScenario, unpack, type Packing, type Scenario } from './fixtures/old-bookings-runner';
import fixtureJson from './fixtures/old-bookings.json' with { type: 'json' };

const fixture = fixtureJson as unknown as {
  answers_by: string;
  made_by: Record<string, string>;
  scenarios: Scenario[];
  records: Record<string, unknown>;
  expected: Record<string, unknown>;
  strings: string[];
  forms: unknown[];
};
const P: Packing = { strings: fixture.strings, forms: fixture.forms };
const recordOf = (name: string) => unpack(fixture.records[name], P, { strings: true }) as any;

test('the old bookings are the shapes they claim to be', () => {
  expect(fixture.answers_by).toBe('881fd2b');
  expect(Object.keys(fixture.records)).toEqual([
    'civil-noset',
    'wedding-noset-fee',
    'civil-noset-bare',
    'wedding-noset-fee-bare',
    'wedding-set',
    'civil-set',
    'civil-set-retainer-cash',
    'civil-noset-nocash',
  ]);
  for (const name of Object.keys(fixture.records)) {
    const r = recordOf(name);
    expect(r.token, name).toMatch(/^guard_[a-z]+_0+$/);
    expect(r.token, name).toHaveLength(43);
    expect(r.status, name).toBe('sent');
    // None of them carries the frozen settings of the payment change: they read as 50% and the old address.
    expect(r.facts, name).not.toHaveProperty('retainer_percent');
    expect(r.facts, name).not.toHaveProperty('etransfer_email');
    expect(Boolean(r.set), name).toBe(!name.includes('noset'));
    expect(Boolean(r.variants), name).toBe(name.includes('noset'));
    expect(Boolean(r.labels), name).toBe(!name.endsWith('-bare'));
    // A set keeps one summary per mix; a booking without a set keeps its summaries at the top level.
    expect(Boolean(r.summary), name).toBe(name.includes('noset') && !name.endsWith('-bare'));
  }
  // The stored numbers of spec 5.5: 251 / 250.25 and, for the wedding, 1,505 / 753 / 752 (private 1,543 / 772 / 770).
  expect(recordOf('civil-noset').facts).toMatchObject({ total: 501.25, retainer: 251, balance: 250.25, balance_cash: false });
  expect(recordOf('civil-set').facts).toMatchObject({ total: 501.25, retainer: 251, balance: 250.25 });
  expect(recordOf('civil-set-retainer-cash').facts).toMatchObject({ total: 501.25, retainer: 126, balance: 375.25, balance_cash: true });
  for (const name of ['wedding-noset-fee', 'wedding-set'])
    expect(recordOf(name).facts, name).toMatchObject({ total: 3010, retainer: 1505, second_payment: 753, final_payment: 752, private_fee: 75 });
  expect(recordOf('wedding-noset-fee').summary_private).toMatchObject({ total: '$3,085.00', retainer: '$1,543.00', etransfer_email: 'info@kashklicks.ca' });
  expect(recordOf('wedding-set').facts.tick_boxes.map((t: { id: string }) => t.id)).toEqual(['raw-photos-wedding', 'instax-guest-prints', 'guest-camera']);
  expect(Object.keys(recordOf('wedding-set').set.mixes)).toHaveLength(16);
  // The oldest shape (c21d167, before balance_cash existed): no balance_cash fact and a stored summary
  // without balance_how. It must keep reading as "e-transfer or cash", never as the new cash only default.
  const oldest = recordOf('civil-noset-nocash');
  expect(fixture.made_by['civil-noset-nocash']).toBe('20408b9, balance_cash and balance_how removed (the shape of c21d167)');
  expect(oldest.facts).not.toHaveProperty('balance_cash');
  expect(oldest.summary).not.toHaveProperty('balance_how');
  expect(oldest.facts).toMatchObject({ total: 501.25, retainer: 251, balance: 250.25 });
  expect(fixture.scenarios.filter((s) => s.record === 'civil-noset-nocash').map((s) => s.name.split(': ')[1])).toEqual([
    'doc',
    'doc v=2',
    'sign share, then doc, doc v=2, pdf and resend',
    'sign private, then doc',
    'pdf unsigned',
    'sign with extras is refused',
  ]);
});

for (const sc of fixture.scenarios) {
  test(`old booking ${sc.name}`, async () => {
    const got = packStrings(await runScenario({ handleAgreement: handleAgreement as any, copyFields: copyFields as any }, recordOf(sc.record), sc), P);
    const want = unpack(fixture.expected[sc.name], P, { strings: false });
    // A readable diff first, then the bytes (key order included).
    expect(got).toEqual(want);
    expect(JSON.stringify(got)).toBe(JSON.stringify(want));
  });
}
