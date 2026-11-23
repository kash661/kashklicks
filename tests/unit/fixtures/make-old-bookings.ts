// What old-bookings.json holds, and how it is made. Run by make-old-bookings.mjs (see there), never by
// the unit tests. No imports from src: the code of the older commits is passed in. Invented people only.
import { MADE_AT, RUN_AT, makeRecord, packer, runScenario, type Scenario, type WorkerApi } from './old-bookings-runner';

// The same invented people and bookings as tests/unit/agreement-worker.unit.ts (PILOT, WEDDING_SECOND_ONLY).
const CIVIL = {
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
const WEDDING = {
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
};

/** Fixed fake tokens of the real shape (43 characters of A to Z, a to z, 0 to 9, - and _). */
const fakeToken = (name: string) => `guard_${name}_${'0'.repeat(43)}`.slice(0, 43);

const CIVIL_TICKS = ['drone', 'extra-retouched', 'raw-photos-civil'];
const WEDDING_TICKS = ['raw-photos-wedding', 'instax-guest-prints', 'guest-camera'];

/** Every scenario starts from the stored record alone, status sent. */
const scenariosOf = (record: string, ticks: string[] | null): Scenario[] => {
  const s = (name: string, steps: Scenario['steps']): Scenario => ({ name: `${record}: ${name}`, record, steps });
  const list: Scenario[] = [
    s('doc', [{ kind: 'doc' }]),
    s('doc v=2', [{ kind: 'doc', v: '2' }]),
    s('sign share, then doc, doc v=2, pdf and resend', [
      { kind: 'doc', v: '2' },
      { kind: 'sign', choice: 'share' },
      { kind: 'doc' },
      { kind: 'doc', v: '2' },
      { kind: 'pdf', c: 'share' },
      { kind: 'resend' },
    ]),
    s('sign private, then doc', [{ kind: 'doc' }, { kind: 'sign', choice: 'private' }, { kind: 'doc' }]),
    s('pdf unsigned', [{ kind: 'pdf', c: 'share' }, { kind: 'pdf', c: 'private' }]),
  ];
  if (ticks === null) {
    // A booking made before sets offers no extras: refused, and the link still opens.
    list.push(s('sign with extras is refused', [{ kind: 'sign', choice: 'share', extras: ['drone'] }, { kind: 'pdf', c: 'share', x: 'drone' }, { kind: 'doc' }]));
  } else {
    // Sent in reverse order: the worker puts them in tick box order.
    list.push(
      s('sign private with every extra, then doc', [
        { kind: 'sign', choice: 'private', extras: [...ticks].reverse(), hash_of: { choice: 'private', extras: ticks } },
        { kind: 'doc' },
        { kind: 'doc', v: '2' },
      ]),
      s(`sign share with ${ticks[ticks.length - 1]}, then doc`, [{ kind: 'sign', choice: 'share', extras: [ticks[ticks.length - 1]] }, { kind: 'doc' }]),
      s(`sign share with ${ticks[0]}, then doc`, [{ kind: 'sign', choice: 'share', extras: [ticks[0]] }, { kind: 'doc' }]),
      s('pdf of a mix', [{ kind: 'pdf', c: 'private', x: ticks.join(',') }, { kind: 'pdf', c: 'share', x: ticks[0] }]),
    );
  }
  return list;
};

/**
 * pre: the code of the last commit before sets (20408b9), which made every booking without a set.
 * head: the code of 881fd2b, the last commit before the payment change of 2026-11-23.
 * The records come from the code that made that shape; every answer comes from head.
 */
export async function makeFixture(code: { pre: WorkerApi; head: WorkerApi; preCommit: string; headCommit: string }) {
  const records: Record<string, any> = {};
  const madeBy: Record<string, string> = {};
  const add = (name: string, commit: string, record: any) => {
    records[name] = record;
    madeBy[name] = commit;
  };
  // Two full texts, the summaries at the top level. The usual retainer (50%), the balance either way.
  add('civil-noset', code.preCommit, await makeRecord(code.pre, CIVIL, 0, fakeToken('civilnoset')));
  // Three payments, and the fee for private work with its own stored private summary.
  add('wedding-noset-fee', code.preCommit, await makeRecord(code.pre, WEDDING, 1, fakeToken('weddingnoset')));
  // The same two, without the stored labels and summaries the code still knows how to do without: those are worked out at reading time.
  const bare = (r: any) => {
    const { labels: _l, summary: _s, summary_private: _p, ...rest } = r;
    return rest;
  };
  add('civil-noset-bare', `${code.preCommit}, labels and summary removed`, bare(records['civil-noset']));
  add('wedding-noset-fee-bare', `${code.preCommit}, labels and summaries removed`, bare(records['wedding-noset-fee']));
  // A set: 16 mixes (3 tick boxes, one of them a deposit), three payments, the fee, page content.
  add('wedding-set', code.headCommit, await makeRecord(code.head, WEDDING, 2, fakeToken('weddingset')));
  // A set: 16 mixes, the usual retainer.
  add('civil-set', code.headCommit, await makeRecord(code.head, CIVIL, 3, fakeToken('civilset')));
  // A set retainer that is exactly 25% of the total, and cash only: it stays a set retainer in every mix.
  add('civil-set-retainer-cash', code.headCommit, await makeRecord(code.head, { ...CIVIL, retainer: 126, balance_cash: true }, 4, fakeToken('civilsetcash')));
  // The oldest shape: a booking made by c21d167, before 1b01cc4 added balance_cash. Its facts have no
  // balance_cash and its stored summary no balance_how; it reads as "e-transfer or cash". Added after the
  // review of the payment change (a cash only default must never reach it); the other records are unchanged.
  const nocash = (r: any) => {
    const { balance_cash: _c, ...facts } = r.facts;
    const { balance_how: _h, ...summary } = r.summary;
    return { ...r, token: fakeToken('civilnosetnocash'), facts, summary };
  };
  add('civil-noset-nocash', `${code.preCommit}, balance_cash and balance_how removed (the shape of c21d167)`, nocash(records['civil-noset']));

  const scenarios = [
    ...scenariosOf('civil-noset', null),
    ...scenariosOf('civil-noset-bare', null),
    ...scenariosOf('wedding-noset-fee', null),
    ...scenariosOf('wedding-noset-fee-bare', null),
    ...scenariosOf('wedding-set', WEDDING_TICKS),
    ...scenariosOf('civil-set', CIVIL_TICKS),
    ...scenariosOf('civil-set-retainer-cash', CIVIL_TICKS),
    ...scenariosOf('civil-noset-nocash', null),
  ];
  const expected: Record<string, unknown> = {};
  for (const sc of scenarios) expected[sc.name] = await runScenario(code.head, records[sc.record], sc);

  // Big values are stored once (see packer in old-bookings-runner.ts). Records first: their strings are kept in full.
  const { pack, packing } = packer(records);
  // The top level of both maps stays plain, so a record or an answer is found by its name.
  const packedRecords = Object.fromEntries(Object.entries(records).map(([k, v]) => [k, pack(v)]));
  const packedExpected = Object.fromEntries(Object.entries(expected).map(([k, v]) => [k, pack(v)]));
  return {
    about:
      'Bookings stored before the payment change of 2026-11-23, and what the code of that time answered for them. ' +
      'Made by tests/unit/fixtures/make-old-bookings.mjs; read by tests/unit/agreement-old-bookings.unit.ts. Invented people, fake tokens.',
    answers_by: code.headCommit,
    made_at: MADE_AT,
    run_at: RUN_AT,
    made_by: madeBy,
    scenarios,
    records: packedRecords,
    expected: packedExpected,
    strings: packing.strings,
    forms: packing.forms,
  };
}
