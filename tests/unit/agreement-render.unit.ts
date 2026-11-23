import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import clausesJson from '../../src/data/agreement/clauses.json' with { type: 'json' };
import sitePackages from '../../src/data/packages.json' with { type: 'json' };
import siteAddOns from '../../src/data/add-ons.json' with { type: 'json' };
import agreementPackages from '../../src/data/agreement/packages.json' with { type: 'json' };
import business from '../../src/data/agreement/business.json' with { type: 'json' };
import { money, longDate, shortDate, clockTime, torontoStamp, addDays } from '../../src/lib/agreement/format';
import {
  SIGN_DATE_TOKEN,
  BookingError,
  buildBookingFacts,
  renderVariant,
  fillSignDate,
  signLabels,
  usualRetainer,
  retainerPercentOf,
  etransferEmailOf,
  RETAINER_PERCENT_BEFORE_2026_11_23,
  ETRANSFER_EMAIL_BEFORE_2026_11_23,
  factsFor,
  phoneOf,
  timesOf,
} from '../../src/lib/agreement/render';
import type { AgreementDoc, BookingFacts, ClauseFile, SourceClause, DocItem } from '../../src/lib/agreement/types';

const file = clausesJson as unknown as ClauseFile;

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

const facts = (over: Record<string, unknown> = {}) => buildBookingFacts({ ...PILOT, ...over }, CTX);

const src = (id: string): SourceClause => {
  for (const s of file.sections)
    for (const i of s.items) if (i.type === 'clause' && i.id === id) return i;
  throw new Error(`clause ${id} missing`);
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A source clause matches a rendered text when the text equals the source with each placeholder filled by something.
const matches = (c: SourceClause, text: string) =>
  new RegExp('^' + c.text.split(/\{\{[A-Z0-9_]+\}\}/).map(escRe).join('[\\s\\S]+?') + '$').test(text);

const clauses = (doc: AgreementDoc) =>
  doc.sections.flatMap((s) =>
    s.items.filter((i): i is Extract<DocItem, { type: 'clause' }> => i.type === 'clause').map((i) => ({ sec: s.num, ...i })),
  );
const shows = (doc: AgreementDoc, id: string) => clauses(doc).some((c) => matches(src(id), c.text));
const table = (doc: AgreementDoc, kind: 'booking' | 'addons') => {
  for (const s of doc.sections)
    for (const i of s.items) if (i.type === 'table' && i.kind === kind) return { sec: s.num, ...i };
  throw new Error(`table ${kind} missing`);
};

const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BookingError) return e.code;
    throw e;
  }
  return undefined;
};

test('money, dates and times', () => {
  expect(money(501.25)).toBe('$501.25');
  expect(money(1451.25)).toBe('$1,451.25');
  expect(money(251)).toBe('$251.00');
  expect(money(100000)).toBe('$100,000.00');
  expect(longDate('2026-12-12')).toBe('Saturday 12 December 2026');
  expect(longDate('2027-01-09')).toBe('Saturday 9 January 2027');
  expect(clockTime('12:00')).toBe('12:00 pm');
  expect(clockTime('14:00')).toBe('2:00 pm');
  expect(clockTime('09:30')).toBe('9:30 am');
  expect(clockTime('00:15')).toBe('12:15 am');
  expect(addDays('2026-12-12', 28)).toBe('2027-01-09');
  expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  expect(shortDate(new Date('2026-11-10T15:00:00Z'))).toBe('10 November 2026');
  expect(torontoStamp(new Date('2026-11-09T19:41:00Z'))).toEqual({ date: '9 November 2026', time: '2:41 pm' });
});

test('sign date uses Toronto time', () => {
  expect(shortDate(new Date('2026-12-13T04:30:00Z'))).toBe('12 December 2026');
  expect(torontoStamp(new Date('2026-12-13T04:30:00Z'))).toEqual({ date: '12 December 2026', time: '11:30 pm' });
});

test('retainer is 25%, rounded up to the next dollar', () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): 25% of the total, was half.
  for (const [price, retainer, balance] of [
    [501.25, 126, 375.25],
    [551.25, 138, 413.25],
    [851.25, 213, 638.25],
  ]) {
    const f = facts({ price });
    expect(f.total).toBe(price);
    expect(f.retainer).toBe(retainer);
    expect(f.balance).toBe(balance);
  }
});

test('the business settings of the payment change (spec 2026-11-23, section 5.2)', () => {
  expect(business.etransferEmail).toBe('kashklicks.ca@gmail.com');
  expect(business.retainerPercent).toBe(25);
  expect(business.balanceCashOnly).toBe(true);
  // The contact address (clauses 0.3 and 21.7) stays.
  expect(business.email).toBe('info@kashklicks.ca');
  // The percent the engine works with is the percent the clauses name: changing one without the other is a mistake.
  for (const id of ['3.5', '3.6']) expect(src(id).text, id).toContain(`The retainer is ${business.retainerPercent}% of your total`);
});

test('a retainer percent that clauses 3.5 and 3.6 do not name is a data mistake, and /new makes no booking from it', () => {
  // Review finding (spec 5.2): the clauses write the usual retainer as fixed text ("The retainer is 25% of
  // your total"). A business.json percent they do not name would give every new booking a section 1
  // retainer that its own clause 3.5 or 3.6 contradicts. buildBookingFacts throws a plain Error, like the
  // other data checks, so /new answers 500 and uses up no number.
  const b = business as Record<string, unknown>;
  const keep = b.retainerPercent;
  const named = ['3.5', '3.6'].map((id) => [src(id), src(id).text] as const);
  const f = facts();
  try {
    b.retainerPercent = 40;
    expect(() => facts()).toThrow('business.json: retainerPercent 40 is not the percent the clauses name (25, 25)');
    // A stored booking is not touched: it renders from its own frozen percent.
    expect(JSON.stringify(renderVariant(f, 'share'))).toContain('The retainer is 25% of your total');
    // The clauses changed with it: a booking is made at 40.
    for (const [c, t] of named) c.text = t.replace('The retainer is 25% of your total', 'The retainer is 40% of your total');
    expect([facts().retainer_percent, facts().retainer]).toEqual([40, 201]);
    // One clause left behind is still a mistake.
    named[1][0].text = named[1][1];
    expect(() => facts()).toThrow('business.json: retainerPercent 40 is not the percent the clauses name (40, 25)');
    // A clause file that names no percent at all is a mistake too (today's clauses always name one).
    for (const [c, t] of named) c.text = t.replace('The retainer is 25% of your total', 'The retainer is a part of your total');
    expect(() => facts()).toThrow('business.json: retainerPercent 40 is not the percent the clauses name (none)');
  } finally {
    b.retainerPercent = keep;
    for (const [c, t] of named) c.text = t;
  }
  expect(facts()).toEqual(f);
});

test('usual retainer: percent 50 gives exactly half rounded up, for every cent total from 0.01 to 20,000.00', () => {
  // Every booking made before 2026-11-23 reads as 50: its retainer rule must not move by one cent.
  expect(RETAINER_PERCENT_BEFORE_2026_11_23).toBe(50);
  let checked = 0;
  for (let c = 1; c <= 2_000_000; c += 1) {
    const total = c / 100;
    if (usualRetainer(total, 50) !== Math.ceil(total / 2)) throw new Error(`total ${total}: ${usualRetainer(total, 50)} is not ${Math.ceil(total / 2)}`);
    checked += 1;
  }
  expect(checked).toBe(2_000_000);
  // And 25 is a quarter, rounded up to the next dollar (spec section 5.5).
  expect([3010, 3085, 3266.25, 551.25, 723, 501.25].map((t) => usualRetainer(t, 25))).toEqual([753, 772, 817, 138, 181, 126]);
});

test('facts made before 2026-11-23 read as 50% and the old e-transfer address; new facts carry their own', () => {
  const f = facts();
  expect([f.retainer_percent, f.etransfer_email]).toEqual([25, 'kashklicks.ca@gmail.com']);
  expect([retainerPercentOf(f), etransferEmailOf(f)]).toEqual([25, 'kashklicks.ca@gmail.com']);
  const { retainer_percent: _p, etransfer_email: _e, ...old } = f;
  expect(ETRANSFER_EMAIL_BEFORE_2026_11_23).toBe('info@kashklicks.ca');
  expect([retainerPercentOf(old as typeof f), etransferEmailOf(old as typeof f)]).toEqual([50, 'info@kashklicks.ca']);
  // The values are frozen with the booking: a later change of business.json does not reach it.
  const b = business as Record<string, unknown>;
  const keep = { etransferEmail: b.etransferEmail, retainerPercent: b.retainerPercent, balanceCashOnly: b.balanceCashOnly };
  const named = ['3.5', '3.6'].map((id) => [src(id), src(id).text] as const);
  try {
    b.etransferEmail = 'later@example.com';
    b.retainerPercent = 30;
    b.balanceCashOnly = false;
    const doc = JSON.stringify(renderVariant(f, 'share'));
    expect(doc).toContain('You pay the retainer by Interac e-transfer to kashklicks.ca@gmail.com.');
    expect(doc).not.toContain('later@example.com');
    expect(doc).toContain('The retainer is 25% of your total');
    // A booking made now takes the new values. A new percent goes with clause text that names it (review
    // finding: /new refuses a percent that clauses 3.5 and 3.6 do not name), so the clauses say 30% here too.
    for (const [c, t] of named) c.text = t.replace('The retainer is 25% of your total', 'The retainer is 30% of your total');
    const later = facts();
    expect([later.retainer_percent, later.etransfer_email, later.balance_cash, later.retainer]).toEqual([30, 'later@example.com', false, 151]);
    // A broken setting is a data mistake.
    for (const [key, value] of [['retainerPercent', 0], ['retainerPercent', 100], ['retainerPercent', 25.5], ['retainerPercent', '25'], ['etransferEmail', 'nope'], ['balanceCashOnly', 'yes']] as const) {
      const before = b[key];
      b[key] = value;
      try {
        expect(() => facts(), `${key} ${String(value)}`).toThrow(`business.json: ${key}`);
      } finally {
        b[key] = before;
      }
    }
  } finally {
    Object.assign(b, keep);
    for (const [c, t] of named) c.text = t;
  }
  expect(facts()).toEqual(f);
});

const TWO_PARTS = 'You pay in two parts.';
const perSection = (doc: AgreementDoc) =>
  Object.fromEntries(doc.sections.map((s) => [s.num, s.items.filter((i) => i.type === 'clause').length]));

test('a booking can set its own retainer', () => {
  const f = facts({ retainer: 51.25 });
  expect(f.total).toBe(501.25);
  expect(f.retainer).toBe(51.25);
  expect(f.balance).toBe(450);
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(f, choice);
    const rows = table(doc, 'booking').rows;
    expect(rows).toContainEqual(['Retainer, due at signing', '$51.25 by e-transfer']);
    // Re-pinned (spec 2026-11-23, section 5.3): the balance is cash only unless the booking says otherwise.
    expect(rows).toContainEqual(['Balance, due on or before the ceremony day', '$450.00 in cash']);
    const pay = clauses(doc).filter((c) => c.text.startsWith(TWO_PARTS));
    expect(pay).toHaveLength(1);
    expect(pay[0].text).toBe(
      'You pay in two parts. The retainer is $51.25 and is due when you sign. The balance is due on or before the shoot day, before I start shooting.',
    );
    const json = JSON.stringify(doc);
    // Re-pinned (spec 2026-11-23, section 5.1): the usual clause says 25% now.
    expect(json).not.toContain('25% of your total');
    expect(json).not.toContain('50% of your total');
    expect(json).not.toContain('{{RETAINER}}');
    expect(perSection(doc)).toEqual(perSection(renderVariant(facts(), choice)));
    for (const s of doc.sections) {
      const ns = s.items.filter((i) => i.type === 'clause').map((i) => (i as { n: string }).n);
      if (s.num !== 0) expect(ns).toEqual(ns.map((_, k) => `${s.num}.${k + 1}`));
    }
  }
});

test('without a set retainer the clause says 25%', () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.1 and 5.5): 25% and $126.00 for the pilot, was 50% and $251.00.
  const f = facts();
  expect(f.retainer).toBe(126);
  expect(f.balance).toBe(375.25);
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(f, choice);
    const pay = clauses(doc).filter((c) => c.text.startsWith(TWO_PARTS));
    // Re-pinned for spec 2026-11-23, section 5.8: clause 3.5 says the retainer is rounded up to the next dollar.
    expect(pay.map((c) => c.text)).toEqual([
      'You pay in two parts. The retainer is 25% of your total, rounded up to the next dollar, and is due when you sign. The balance is due on or before the shoot day, before I start shooting.',
    ]);
    expect(JSON.stringify(doc)).not.toContain('The retainer is $');
  }
});

test('a set retainer equal to the usual 25% gives the standard document', () => {
  // Re-pinned (spec 2026-11-23, section 5.5): the usual retainer of the pilot is $126.00 now.
  const f = facts({ retainer: 126 });
  expect(f.retainer).toBe(126);
  expect(f.balance).toBe(375.25);
  for (const choice of ['share', 'private'] as const)
    expect(JSON.stringify(renderVariant(f, choice))).toBe(JSON.stringify(renderVariant(facts(), choice)));
});

test('a set retainer must be a sensible amount', () => {
  for (const retainer of [0, -5, 0.5, 501.25, 600, '51.25', NaN, Infinity, 51.255, null]) {
    let err: unknown;
    try {
      facts({ retainer });
    } catch (e) {
      err = e;
    }
    expect(err, String(retainer)).toBeInstanceOf(BookingError);
    expect((err as BookingError).code, String(retainer)).toBe('bad_retainer');
    expect((err as BookingError).field, String(retainer)).toBe('retainer');
  }
});

// Re-pinned for the payment change (spec 2026-11-23, section 5.1): the words of clauses 3.10 and 3.17.
const ANY_WAY = 'You can pay the balance by e-transfer or in cash.';
const CASH_ONLY = 'You pay the balance in cash, not by e-transfer.';
const BALANCE_ROW = 'Balance, due on or before the ceremony day';
const sectionGapless = (doc: AgreementDoc, num: number) => {
  const s = doc.sections.find((x) => x.num === num)!;
  const ns = s.items.filter((i) => i.type === 'clause').map((i) => (i as { n: string }).n);
  expect(ns).toEqual(ns.map((_, k) => `${num}.${k + 1}`));
};

// Re-pinned for the payment change (spec 2026-11-23, sections 5.2 and 5.3): the business setting
// balanceCashOnly makes cash only the default; balance_cash: false lets one booking pay by e-transfer too.
test('a booking can say the balance may be paid either way', () => {
  const f = facts({ balance_cash: false });
  expect(f.balance_cash).toBe(false);
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(f, choice);
    const texts = clauses(doc).map((c) => c.text);
    expect(texts).toContain(ANY_WAY);
    expect(texts).not.toContain(CASH_ONLY);
    expect(Object.fromEntries(table(doc, 'booking').rows)[BALANCE_ROW]).toBe('$375.25 by e-transfer or cash');
    expect(perSection(doc)).toEqual(perSection(renderVariant(facts(), choice)));
    sectionGapless(doc, 3);
  }
});

test('by default the balance is paid in cash only', () => {
  const f = facts();
  expect(f.balance_cash).toBe(true);
  expect(f.balance).toBe(375.25);
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(f, choice);
    const texts = clauses(doc).map((c) => c.text);
    expect(texts.filter((t) => t === CASH_ONLY)).toHaveLength(1);
    expect(texts).not.toContain(ANY_WAY);
    expect(Object.fromEntries(table(doc, 'booking').rows)[BALANCE_ROW]).toBe('$375.25 in cash');
    sectionGapless(doc, 3);
  }
  // Saying true is the same as saying nothing.
  for (const choice of ['share', 'private'] as const)
    expect(JSON.stringify(renderVariant(facts({ balance_cash: true }), choice))).toBe(JSON.stringify(renderVariant(f, choice)));
});

test('cash only together with a set retainer', () => {
  const f = facts({ price: 501.25, retainer: 51.25, balance_cash: true });
  for (const choice of ['share', 'private'] as const) {
    const rows = Object.fromEntries(table(renderVariant(f, choice), 'booking').rows);
    expect(rows['Retainer, due at signing']).toBe('$51.25 by e-transfer');
    expect(rows[BALANCE_ROW]).toBe('$450.00 in cash');
  }
});

test('balance_cash must be true or false', () => {
  for (const balance_cash of ['yes', 1, null, 'true']) {
    let err: unknown;
    try {
      facts({ balance_cash });
    } catch (e) {
      err = e;
    }
    expect(err, String(balance_cash)).toBeInstanceOf(BookingError);
    expect((err as BookingError).code, String(balance_cash)).toBe('bad_balance_cash');
    expect((err as BookingError).field, String(balance_cash)).toBe('balance_cash');
  }
});

test('stored facts without balance_cash render as before', () => {
  // Facts stored before balance_cash existed read as false (either way). Re-pinned (spec 2026-11-23,
  // section 5.3): the default of a new booking is cash only now, so the comparison names false.
  const { balance_cash: _drop, ...old } = facts();
  for (const choice of ['share', 'private'] as const)
    expect(JSON.stringify(renderVariant(old as Parameters<typeof renderVariant>[0], choice))).toBe(
      JSON.stringify(renderVariant(facts({ balance_cash: false }), choice)),
    );
});

test('pilot facts', () => {
  const f = facts();
  expect(f.number).toBe('KK-TEST-2026-001');
  expect(f.created_at).toBe('2026-11-10T15:00:00.000Z');
  expect(f.package_name).toBe('The Civil Ceremony');
  expect(f.package_price).toBe(501.25);
  expect(f.add_ons).toEqual([]);
  expect(f.total).toBe(501.25);
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5).
  expect(f.retainer).toBe(126);
  expect(f.balance).toBe(375.25);
  expect(f.balance_cash).toBe(true);
  expect(f.retainer_percent).toBe(25);
  expect(f.etransfer_email).toBe('kashklicks.ca@gmail.com');
  expect(f).not.toHaveProperty('second_payment');
  expect(f.hours).toBe(2);
  expect(f.delivery_date).toBe('2027-01-09');
  expect(f.client_name).toBe('Priya Sharma');
  expect(f.partner_name).toBe('Arjun Mehta');
  expect(f.notes).toBe('Family group photos after the ceremony, inside your 2 hours.');
});

test('site price is used when no price is typed', () => {
  const site = (sitePackages as { id: string; price: number | null; salePrice?: number | null }[]).find(
    (p) => p.id === 'civil-ceremony',
  )!;
  const { price: _drop, ...noPrice } = PILOT;
  const f = buildBookingFacts(noPrice, CTX);
  expect(f.package_price).toBe(site.salePrice ?? site.price);
  expect(f.total).toBe(site.salePrice ?? site.price);
});

test('an extra hour changes total, hours and coverage', () => {
  const f = facts({ add_ons: [{ id: 'extra-hours-civil', qty: 1 }], end_time: '15:00' });
  expect(f.hours).toBe(3);
  expect(f.add_ons).toEqual([{ id: 'extra-hours-civil', label: 'Additional hours', qty: 1, unit_price: 201.25, line_total: 201.25 }]);
  expect(f.total).toBe(702.5);
  // Re-pinned (spec 2026-11-23, section 5.3): 25%, cash only.
  expect(f.retainer).toBe(176);
  expect(f.balance).toBe(526.5);
  const rows = Object.fromEntries(table(renderVariant(f, 'share'), 'booking').rows);
  expect(rows['Add-ons chosen at booking']).toBe('Additional hours, 1 × $201.25 = $201.25');
  expect(rows['Coverage']).toBe('3 hours, from 12:00 pm to 3:00 pm');
  expect(rows['Total']).toBe('$702.50');
  expect(rows['Retainer, due at signing']).toBe('$176.00 by e-transfer');
  expect(rows['Balance, due on or before the ceremony day']).toBe('$526.50 in cash');
  // The same extra hour without moving the end time is refused.
  expect(codeOf(() => facts({ add_ons: [{ id: 'extra-hours-civil', qty: 1 }] }))).toBe('bad_times');
});

test('two add-ons are joined with a semicolon', () => {
  const f = facts({ add_ons: [{ id: 'drone', qty: 1 }, { id: 'extra-retouched', qty: 2 }] });
  expect(f.total).toBe(501.25 + 76.25 + 52.5);
  const rows = Object.fromEntries(table(renderVariant(f, 'share'), 'booking').rows);
  expect(rows['Add-ons chosen at booking']).toBe(
    'Drone and aerial frames, 1 × $76.25 = $76.25; Five extra retouched images, 2 × $26.25 = $52.50',
  );
});

test('section 1 table is exact for the pilot', () => {
  const expected = (sharing: string) => [
    ['Booking number', 'KK-TEST-2026-001'],
    ['Package', 'The Civil Ceremony'],
    ['Package price', '$501.25'],
    ['Add-ons chosen at booking', 'None'],
    ['Sharing choice (section 15)', sharing],
    ['Total', '$501.25'],
    // Re-pinned for the payment change (spec 2026-11-23, section 5.5): 126.00 / 375.25 cash.
    ['Retainer, due at signing', '$126.00 by e-transfer'],
    ['Balance, due on or before the ceremony day', '$375.25 in cash'],
    ['Ceremony date', 'Saturday 12 December 2026'],
    ['Coverage', '2 hours, from 12:00 pm to 2:00 pm'],
    ['Where', 'Vaughan City Hall, 2141 Major Mackenzie Dr W, Vaughan, ON L6A 1T1'],
    ['Who shoots', 'Akash Desai'],
    ['Delivery', 'Edited photos by Saturday 9 January 2027, which is within 4 weeks of your ceremony.'],
    ['Also agreed for your day', 'Family group photos after the ceremony, inside your 2 hours.'],
    [
      'Costs that may apply later',
      'Overtime at $201.25 an hour, in 30 minute blocks of $100.75 (section 5). Parking at cost (section 6). Travel outside the GTA at $0.75 per km (section 6). A change of date fee of $151.25 in some cases (section 11). Any add-on you choose later, at the prices in section 4.',
    ],
  ];
  const f = facts();
  const share = table(renderVariant(f, 'share'), 'booking');
  expect(share.sec).toBe(1);
  expect(share.rows).toEqual(expected('You allow sharing. It does not change your price.'));
  expect(share.bold).toEqual(['Total']);
  expect(share.rows.map((r) => r[0])).not.toContain('HST');
  const priv = table(renderVariant(f, 'private'), 'booking');
  expect(priv.rows).toEqual(expected('Private. Your work is not shown in public.'));

  // Without notes, the "Also agreed" row is left out.
  const { notes: _n, ...noNotes } = PILOT;
  const labels = table(renderVariant(buildBookingFacts(noNotes, CTX), 'share'), 'booking').rows.map((r) => r[0]);
  expect(labels).toHaveLength(14);
  expect(labels).not.toContain('Also agreed for your day');
});

test('section 4 table is exact', () => {
  const t = table(renderVariant(facts(), 'share'), 'addons');
  expect(t.sec).toBe(4);
  expect(t.bold).toEqual([]);
  expect(t.rows).toEqual([
    ['Additional hours', '$201.25 per hour', 'Book them before the day. They become part of your booked hours.'],
    ['Overtime', '$201.25 per hour', 'Billed in 30 minute blocks of $100.75. See section 5.'],
    ['Drone and aerial frames', '$76.25', 'Weather and airspace permitting. Refunded in full if I cannot fly.'],
    ['Five extra retouched images', '$26.25 per set of five', 'On top of the photos in your package.'],
    ['RAW photos', '$69.25', 'See section 13.'],
    ['Parking', 'At cost', 'With the receipt. See section 6.'],
    ['Travel outside the GTA', '$0.75 per km', 'Round trip, counted from the GTA boundary. See section 6.'],
  ]);
});

test('deliverables list sits in section 2', () => {
  const doc = renderVariant(facts(), 'share');
  const s2 = doc.sections.find((s) => s.num === 2)!;
  expect(s2.items[0]).toMatchObject({ type: 'clause', n: '2.1', text: 'Your package is The Civil Ceremony. It includes:' });
  expect(s2.items[1]).toEqual({
    type: 'list',
    items: [
      '2 hours of photography in one continuous block',
      'The ceremony, and couple portraits near the venue',
      'At least 150 edited photos in a private online gallery',
    ],
  });
});

test('clause visibility for a civil ceremony', () => {
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(facts(), choice);
    expect(shows(doc, '5.2')).toBe(true);
    // Spec 2026-11-23, section 6.1: with times, not their twin for times to be set.
    expect(shows(doc, '5.23')).toBe(false);
    expect(shows(doc, '5.1')).toBe(false);
    // Re-pinned (spec 2026-11-23, section 5.1): cash only by default shows 3.17, not 3.10.
    for (const id of ['3.5', '3.17', '3.11', '7.3', '10.1', '11.12', '16.3']) expect(shows(doc, id), id).toBe(true);
    expect(shows(doc, '3.10')).toBe(false);
    expect(shows(doc, '3.6')).toBe(false);
    expect(shows(renderVariant(facts({ balance_cash: false }), choice), '3.10')).toBe(true);
    expect(clauses(doc).filter((c) => c.text.includes('HST'))).toEqual([]);
  }
});

test('visible clause counts match the independent numbers', () => {
  const share = renderVariant(facts(), 'share');
  const priv = renderVariant(facts(), 'private');
  expect(clauses(share)).toHaveLength(161);
  expect(clauses(priv)).toHaveLength(156);
  const perSection = Object.fromEntries(share.sections.map((s) => [s.num, s.items.filter((i) => i.type === 'clause').length]));
  expect(perSection).toEqual({
    0: 5, 1: 3, 2: 5, 3: 10, 4: 6, 5: 13, 6: 9, 7: 10, 8: 8, 9: 7, 10: 10, 11: 5,
    12: 5, 13: 6, 14: 8, 15: 9, 16: 10, 17: 5, 18: 7, 19: 5, 20: 3, 21: 11, 22: 1,
  });
});

// The placeholders whose values the pilot facts give, filled with exactly those values; any other
// placeholder may be any text, as in `matches`. Spec 2026-11-23, section 6.1: clause 0.6 is clause 0.1
// without its last words, so if CLIENT_EMAIL could be any text the text of 0.1 would fit 0.6 too.
const PILOT_VALUES: Record<string, string> = { CLIENT_NAME: PILOT.client_name, CLIENT_EMAIL: PILOT.client_email, CLIENT_PHONE: PILOT.client_phone, PARTNER_NAME: PILOT.partner_name };
const matchesKnown = (c: SourceClause, text: string) =>
  new RegExp(
    '^' +
      c.text
        .split(/(\{\{[A-Z0-9_]+\}\})/)
        .map((part, i) => (i % 2 === 0 ? escRe(part) : Object.hasOwn(PILOT_VALUES, part.slice(2, -2)) ? escRe(PILOT_VALUES[part.slice(2, -2)]) : '[\\s\\S]+?'))
        .join('') +
      '$',
  ).test(text);
/** Every rendered clause comes from exactly one source clause, word for word but for its placeholders. */
const expectFromSource = (doc: AgreementDoc) => {
  const sourceTexts = file.sections.flatMap((s) => s.items).filter((i): i is SourceClause => i.type === 'clause');
  for (const c of clauses(doc)) {
    // A word for word match wins over a template that also fits through a placeholder (3.5 and its set-retainer twin).
    const exact = sourceTexts.filter((s) => s.text === c.text);
    const from = exact.length ? exact : sourceTexts.filter((s) => matchesKnown(s, c.text));
    expect(from, c.text).toHaveLength(1);
    // matchesKnown only ever narrows matches.
    for (const s of from) expect(matches(s, c.text)).toBe(true);
    expect(c.bullets).toEqual(from[0].bullets);
  }
};

test('clause text is the source text, with only placeholders filled', () => {
  const doc = renderVariant(facts(), 'share');
  expectFromSource(doc);
  const all = clauses(doc);
  expect(all[0].text).toBe('**You** are Priya Sharma. Your email is priya@example.com and your phone is 416 555 0142.');
  expect(all[1].text).toBe('You are signing for yourself and for your partner, Arjun Mehta.');
  expect(all[2].text).toBe(
    '**I** am Akash Desai, operating as AD Photography and KashKlicks. Phone 647 613 7430. Email info@kashklicks.ca. Website kashklicks.ca.',
  );
  expect(all[4].text).toBe('This agreement is dated {{SIGN_DATE}}. Your booking number is KK-TEST-2026-001.');
  const texts = all.map((c) => c.text);
  expect(texts).toContain('Overtime costs $201.25 per hour. I bill it in 30 minute blocks of $100.75. A part of a block counts as a full block.');
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.1 and 5.2): clause 3.9, the new address frozen with the booking.
  // Re-pinned for spec 2026-11-23, section 5.8: clause 3.9 adds that any other e-transfer goes to the same address.
  expect(texts).toContain(
    'You pay the retainer by Interac e-transfer to kashklicks.ca@gmail.com. Any other payment by e-transfer goes to the same address. Please put your booking number in the message. I send a receipt or an invoice for every payment.',
  );
  expect(texts).toContain(
    'I deliver your edited photos within 4 weeks of your ceremony day. If your booking has more than one shoot day, the time starts after the last one.',
  );
});

test('sharing variants differ only in sections 1 and 15', () => {
  const share = renderVariant(facts(), 'share');
  const priv = renderVariant(facts(), 'private');
  expect(share.choice).toBe('share');
  expect(priv.choice).toBe('private');
  const s15 = (d: AgreementDoc) => ({ ...d, sections: d.sections.filter((s) => s.num === 15) });
  expect(shows(s15(share), '15.3')).toBe(true);
  expect(shows(s15(share), '15.5')).toBe(true);
  expect(shows(s15(share), '15.4')).toBe(false);
  expect(shows(s15(priv), '15.4')).toBe(true);
  expect(shows(s15(priv), '15.5')).toBe(false);
  expect(shows(s15(priv), '15.3')).toBe(false);
  for (const id of ['15.6', '15.7', '15.8', '15.9']) {
    expect(shows(share, id), id).toBe(true);
    expect(shows(priv, id), id).toBe(false);
  }
  const rest = (d: AgreementDoc) => ({ ...d, choice: null, sections: d.sections.filter((s) => s.num !== 1 && s.num !== 15) });
  expect(rest(priv)).toEqual(rest(share));
});

test('numbering has no gaps', () => {
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(facts(), choice);
    expect(doc.sections.map((s) => s.num)).toEqual(Array.from({ length: 23 }, (_, i) => i));
    for (const s of doc.sections) {
      const ns = s.items.filter((i) => i.type === 'clause').map((i) => (i as { n: string }).n);
      if (s.num === 0) expect(ns.every((n) => n === '')).toBe(true);
      else expect(ns).toEqual(ns.map((_, k) => `${s.num}.${k + 1}`));
    }
  }
});

test('only the sign date token is left unfilled', () => {
  for (const choice of ['share', 'private'] as const) {
    const json = JSON.stringify(renderVariant(facts(), choice));
    expect(json.split(SIGN_DATE_TOKEN)).toHaveLength(2);
    const rest = json.split(SIGN_DATE_TOKEN).join('');
    expect(rest).not.toContain('{{');
    expect(rest).not.toContain('}}');
  }
});

test('the document carries its header fields', () => {
  const doc = renderVariant(facts(), 'share');
  expect(doc.title).toBe(file.title);
  expect(doc.intro).toBe(file.intro);
  expect(doc.clause_version).toBe(file.version);
  expect(doc.number).toBe('KK-TEST-2026-001');
  expect(doc.business_signature).toBe(
    'Signed for Akash Desai, operating as AD Photography and KashKlicks, on 10 November 2026',
  );
  expect(doc.sections.map((s) => s.title)).toEqual(file.sections.map((s) => s.title));
});

test('rendering is deterministic', () => {
  expect(JSON.stringify(renderVariant(facts(), 'share'))).toBe(JSON.stringify(renderVariant(facts(), 'share')));
});

test('fillSignDate fills it', () => {
  const json = JSON.stringify(renderVariant(facts(), 'share'));
  const filled = fillSignDate(json, '12 November 2026');
  expect(filled).not.toContain('{{');
  const doc = JSON.parse(filled) as AgreementDoc;
  expect(clauses(doc)[4].text).toBe('This agreement is dated 12 November 2026. Your booking number is KK-TEST-2026-001.');
  // Everything else is unchanged.
  expect(filled.replace('12 November 2026', SIGN_DATE_TOKEN)).toBe(json);
});

test('sign labels', () => {
  expect(signLabels(facts())).toEqual({
    share_option: 'Share our work. My price stays the same.',
    private_option: 'Keep our work private. My price stays the same.',
    agree_label:
      'I have read this agreement and I agree to it. I am signing for myself and for Arjun Mehta. Signing here is my electronic signature.',
    intro_bullets: [
      'Priya signs for both of you.',
      'You can download or print a copy before you sign.',
      'You will get a PDF copy by email the moment you sign.',
    ],
    after_signing: {
      title: 'Your timeline',
      text: 'Please send me your final timeline, your addresses and your list of family photos at least 14 days before the day. Reply to the email, or message me on WhatsApp.',
    },
  });
});

test('sign labels name the client, and a placeholder left in a label throws', () => {
  // The first word of the client name, whatever the partner is called.
  expect(signLabels(facts({ client_name: 'Meera Kapoor Shah' })).intro_bullets[0]).toBe('Meera signs for both of you.');
  const pkg = (agreementPackages as unknown as Record<string, { introBullets: string[]; afterSigning: { text: string } }>)['civil-ceremony'];
  const bullets = [...pkg.introBullets];
  const after = pkg.afterSigning.text;
  try {
    pkg.introBullets[1] = 'Write to {{CLIENT_EMAIL}}.';
    expect(codeOf(() => signLabels(facts()))).toBe('unfilled_placeholder');
    pkg.introBullets.splice(0, pkg.introBullets.length, ...bullets);
    pkg.afterSigning.text = 'Signed on {{SIGN_DATE}}.';
    expect(codeOf(() => signLabels(facts()))).toBe('unfilled_placeholder');
  } finally {
    pkg.introBullets.splice(0, pkg.introBullets.length, ...bullets);
    pkg.afterSigning.text = after;
  }
  expect(signLabels(facts()).intro_bullets[0]).toBe('Priya signs for both of you.');
});

test('validation codes', () => {
  expect(codeOf(() => facts())).toBeUndefined();
  expect(codeOf(() => facts({ package_id: 'no-such-package' }))).toBe('package_not_ready');
  expect(codeOf(() => facts({ package_id: 'pre-wedding-full' }))).toBe('package_not_ready');
  expect(codeOf(() => buildBookingFacts(null, CTX))).toBe('package_not_ready');
  expect(codeOf(() => facts({ client_name: ' P ' }))).toBe('bad_name');
  expect(codeOf(() => facts({ partner_name: 'A\u0000' }))).toBe('bad_name');
  expect(codeOf(() => facts({ partner_name: 'x'.repeat(121) }))).toBe('bad_name');
  expect(codeOf(() => facts({ client_email: 'priya@example' }))).toBe('bad_email');
  // The same rule as Apps Script: a pasted separator or angle bracket is refused here, not at copy time.
  for (const client_email of ['priya@example.com;', 'priya@example.com,', '<priya@example.com', 'priya@example.com>', 'priya;x@example.com'])
    expect(codeOf(() => facts({ client_email })), client_email).toBe('bad_email');
  expect(codeOf(() => facts({ client_email: `${'a'.repeat(243)}@example.com` }))).toBe('bad_email'); // 255 characters
  expect(codeOf(() => facts({ client_email: `${'a'.repeat(242)}@example.com` }))).toBeUndefined(); // 254, the most
  expect(codeOf(() => facts({ client_phone: '555-01' }))).toBe('bad_phone');
  expect(codeOf(() => facts({ client_phone: '416 555 0142 ext 9' }))).toBe('bad_phone');
  expect(codeOf(() => facts({ client_phone: '+1 (416) 555-0142' }))).toBeUndefined();
  expect(codeOf(() => facts({ client_phone: '416.555.0142' }))).toBeUndefined();
  expect(codeOf(() => facts({ event_date: '2026-11-09' }))).toBe('bad_date');
  expect(codeOf(() => facts({ event_date: '2026-11-10' }))).toBeUndefined();
  expect(codeOf(() => facts({ event_date: '2026-02-30' }))).toBe('bad_date');
  expect(codeOf(() => facts({ event_date: '12/12/2026' }))).toBe('bad_date');
  expect(codeOf(() => facts({ start_time: '12:00', end_time: '13:00' }))).toBe('bad_times');
  expect(codeOf(() => facts({ start_time: '25:00', end_time: '27:00' }))).toBe('bad_times');
  expect(codeOf(() => facts({ place: 'ab' }))).toBe('bad_place');
  expect(codeOf(() => facts({ place: 'x'.repeat(201) }))).toBe('bad_place');
  expect(codeOf(() => facts({ price: 0 }))).toBe('bad_price');
  expect(codeOf(() => facts({ price: 100001 }))).toBe('bad_price');
  expect(codeOf(() => facts({ price: '501.25' }))).toBe('bad_price');
  expect(codeOf(() => facts({ add_ons: [{ id: 'second-photographer', qty: 1 }] }))).toBe('bad_add_on');
  expect(codeOf(() => facts({ add_ons: [{ id: 'drone', qty: 2 }] }))).toBe('bad_add_on');
  expect(codeOf(() => facts({ add_ons: [{ id: 'extra-retouched', qty: 11 }] }))).toBe('bad_add_on');
  expect(codeOf(() => facts({ add_ons: [{ id: 'extra-retouched', qty: 0 }] }))).toBe('bad_add_on');
  expect(codeOf(() => facts({ notes: 'x'.repeat(301) }))).toBe('bad_notes');
  expect(codeOf(() => facts({ notes: 'x'.repeat(300) }))).toBeUndefined();
});

test('a price must be a whole number of cents', () => {
  for (const price of [100.025, 100.035, 100.085]) expect(codeOf(() => facts({ price })), String(price)).toBe('bad_price');
  for (const price of [501.25, 100, 1.13]) expect(codeOf(() => facts({ price })), String(price)).toBeUndefined();
  expect(codeOf(() => facts({ price: null }))).toBe('bad_price');
});

test('markup in booking facts is refused', () => {
  expect(codeOf(() => facts({ client_name: 'Priya {{BOOKING_ID}}' }))).toBe('bad_name');
  expect(codeOf(() => facts({ partner_name: 'Arjun }} Mehta' }))).toBe('bad_name');
  expect(codeOf(() => facts({ place: 'Vaughan City Hall {{SIGN_DATE}}' }))).toBe('bad_place');
  expect(codeOf(() => facts({ notes: 'Group photos {{' }))).toBe('bad_notes');
  expect(codeOf(() => facts({ client_name: '**Priya** Sharma' }))).toBe('bad_name');
  expect(codeOf(() => facts({ client_email: 'pri**ya@example.com' }))).toBe('bad_email');
  expect(codeOf(() => facts({ client_phone: '416 555 0142**' }))).toBe('bad_phone');
  expect(codeOf(() => facts({ place: 'Vaughan **City** Hall' }))).toBe('bad_place');
  expect(codeOf(() => facts({ notes: 'Family **group** photos' }))).toBe('bad_notes');
});

test('a phone number needs at least 7 digits', () => {
  expect(codeOf(() => facts({ client_phone: '-------' }))).toBe('bad_phone');
  expect(codeOf(() => facts({ client_phone: '(+1) 555-01' }))).toBe('bad_phone');
  expect(codeOf(() => facts({ client_phone: '5550142' }))).toBeUndefined();
});

test('the event date is at most 1096 days ahead', () => {
  expect(addDays('2026-11-10', 1096)).toBe('2029-11-10');
  expect(codeOf(() => facts({ event_date: '2029-11-10' }))).toBeUndefined();
  expect(codeOf(() => facts({ event_date: '2029-11-11' }))).toBe('bad_date');
  expect(codeOf(() => facts({ event_date: '9999-12-31' }))).toBe('bad_date');
});

// ------------------------------------------------------------------ no phone, times to be set (spec 2026-11-23, section 6)

const fieldOf = (fn: () => unknown): { code: string; field?: string } | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BookingError) return { code: e.code, field: e.field };
    throw e;
  }
  return undefined;
};
/** PILOT without these keys at all. */
const pilotWithout = (...keys: string[]) => Object.fromEntries(Object.entries(PILOT).filter(([k]) => !keys.includes(k)));
const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const rowsOf = (doc: AgreementDoc) => Object.fromEntries(table(doc, 'booking').rows);
const WITH_PHONE = '**You** are Priya Sharma. Your email is priya@example.com and your phone is 416 555 0142.';
const NO_PHONE = '**You** are Priya Sharma. Your email is priya@example.com.';
const TIMES_SET = 'Your start time and end time are in section 1. If we change them later, we confirm the new times in writing.';
const TIMES_TBD =
  'Your start time and end time are not set yet. We set them together, in writing, at the latest when you send your final timeline (section 7). If we change them later, we confirm the new times in writing.';
const COVERAGE_SET = '2 hours, from 12:00 pm to 2:00 pm';
const COVERAGE_TBD = '2 hours in one continuous block. The start and end time are not set yet (section 5).';
const NOT_GIVEN = [undefined, null, '', '   ', '\t \n'];

test('a booking with a phone and times: the facts are byte for byte the ones of before section 6', () => {
  // sha256 of JSON.stringify of the facts the engine of git ecbecf4 (before spec 2026-11-23, section 6) made
  // for PILOT with this number and clock, key order included.
  expect(sha256(JSON.stringify(facts()))).toBe('16aa77b255ab5f1614942019a599fb5ff062b110dff7be024e56bc71c8dd3bcd');
  expect(Object.keys(facts()).slice(0, 9)).toEqual([
    'package_id',
    'client_name',
    'partner_name',
    'client_email',
    'client_phone',
    'event_date',
    'start_time',
    'end_time',
    'place',
  ]);
  // Without them: the same facts, less those keys.
  const less = Object.fromEntries(Object.entries(facts()).filter(([k]) => !['client_phone', 'start_time', 'end_time'].includes(k)));
  expect(JSON.stringify(facts({ client_phone: null, start_time: null, end_time: null }))).toBe(JSON.stringify(less));
  expect(JSON.stringify(buildBookingFacts(pilotWithout('client_phone', 'start_time', 'end_time'), CTX))).toBe(JSON.stringify(less));
});

test('a phone that is not given (missing, null, empty or blank) is no phone, and the facts leave it out', () => {
  for (const f of [buildBookingFacts(pilotWithout('client_phone'), CTX), ...NOT_GIVEN.map((client_phone) => facts({ client_phone }))]) {
    expect(f).not.toHaveProperty('client_phone');
    expect(phoneOf(f)).toBeUndefined();
  }
  // Any other value is checked as before.
  for (const client_phone of [4165550142, false, 0, ['416 555 0142'], { n: '416 555 0142' }, ' 555-01 ', '-------', '416 555 0142 ext 9'])
    expect(fieldOf(() => facts({ client_phone })), String(client_phone)).toEqual({ code: 'bad_phone', field: 'client_phone' });
  expect(facts({ client_phone: '  416 555 0142  ' }).client_phone).toBe('416 555 0142');
  expect(phoneOf(facts())).toBe('416 555 0142');
});

test('times: both or neither; one alone is refused, naming the one that is missing; blank counts as missing', () => {
  // Neither: the times are to be set, and the facts leave both out.
  const neither = [buildBookingFacts(pilotWithout('start_time', 'end_time'), CTX)];
  for (const start_time of NOT_GIVEN) for (const end_time of NOT_GIVEN) neither.push(facts({ start_time, end_time }));
  for (const f of neither) {
    expect(f).not.toHaveProperty('start_time');
    expect(f).not.toHaveProperty('end_time');
    expect(timesOf(f)).toBeNull();
  }
  // One alone.
  for (const missing of NOT_GIVEN) {
    expect(fieldOf(() => facts({ end_time: missing }))).toEqual({ code: 'bad_times', field: 'end_time' });
    expect(fieldOf(() => facts({ start_time: missing }))).toEqual({ code: 'bad_times', field: 'start_time' });
  }
  expect(fieldOf(() => buildBookingFacts(pilotWithout('end_time'), CTX))).toEqual({ code: 'bad_times', field: 'end_time' });
  expect(fieldOf(() => buildBookingFacts(pilotWithout('start_time'), CTX))).toEqual({ code: 'bad_times', field: 'start_time' });
  // Both given: checked as before (a wrong length, a time that is not HH:MM, a number, a space around it).
  for (const [start_time, end_time] of [['12:00', '13:00'], ['25:00', '27:00'], [1200, 1400], [' 12:00', '14:00'], ['12:00', '14:00 '], ['noon', '14:00']])
    expect(fieldOf(() => facts({ start_time, end_time })), `${start_time} ${end_time}`).toEqual({ code: 'bad_times', field: 'end_time' });
  expect(timesOf(facts())).toEqual({ start: '12:00', end: '14:00' });
  // Hours booked on top need no times either; the Coverage row counts them.
  const longer = facts({ start_time: null, end_time: null, add_ons: [{ id: 'extra-hours-civil', qty: 1 }] });
  expect(longer.hours).toBe(3);
  expect(rowsOf(renderVariant(longer, 'share'))['Coverage']).toBe('3 hours in one continuous block. The start and end time are not set yet (section 5).');
  // Stored facts with one time and not the other are a data mistake: nothing is rendered from them.
  const { end_time: _e, ...half } = facts();
  expect(() => timesOf(half as BookingFacts)).toThrow('a start time and an end time go together');
  expect(() => renderVariant(half as BookingFacts, 'share')).toThrow('a start time and an end time go together');
});

test('without a phone: clause 0.6 and not 0.1, and nothing else changes; with a phone: 0.1 and not 0.6', () => {
  const sec0 = (d: AgreementDoc) => clauses(d).filter((c) => c.sec === 0).map((c) => c.text);
  for (const choice of ['share', 'private'] as const) {
    const withPhone = renderVariant(facts(), choice);
    expect(sec0(withPhone)[0]).toBe(WITH_PHONE);
    expect(sec0(withPhone)).not.toContain(NO_PHONE);
    for (const client_phone of NOT_GIVEN) {
      const without = renderVariant(facts({ client_phone }), choice);
      expect(sec0(without)[0]).toBe(NO_PHONE);
      expect(sec0(without)).not.toContain(WITH_PHONE);
      expect(JSON.stringify(without)).not.toContain('416 555 0142');
      expect(JSON.stringify(without)).not.toContain('your phone');
      expectFromSource(without);
      // Clause 0.1 put back in its place gives the document with the phone, byte for byte.
      const back = JSON.parse(JSON.stringify(without)) as AgreementDoc;
      (back.sections[0].items[0] as { text: string }).text = WITH_PHONE;
      expect(JSON.stringify(back)).toBe(JSON.stringify(withPhone));
    }
  }
});

test('without times: clause 5.23 and not 5.2, and the Coverage row says the times are not set yet; with times: today\'s text', () => {
  const sec5 = (d: AgreementDoc) => d.sections[5].items.filter((i): i is Extract<DocItem, { type: 'clause' }> => i.type === 'clause');
  for (const choice of ['share', 'private'] as const) {
    const withTimes = renderVariant(facts(), choice);
    const at = sec5(withTimes).findIndex((c) => c.text === TIMES_SET);
    expect(at).toBeGreaterThanOrEqual(0);
    expect(sec5(withTimes).map((c) => c.text)).not.toContain(TIMES_TBD);
    expect(rowsOf(withTimes)['Coverage']).toBe(COVERAGE_SET);
    const without = renderVariant(facts({ start_time: '', end_time: null }), choice);
    // 5.23 takes the place and the number of 5.2.
    expect(sec5(without)[at]).toEqual({ ...sec5(withTimes)[at], text: TIMES_TBD });
    expect(sec5(without).map((c) => c.text)).not.toContain(TIMES_SET);
    expect(rowsOf(without)['Coverage']).toBe(COVERAGE_TBD);
    expect(JSON.stringify(without)).not.toContain('12:00 pm');
    expectFromSource(without);
    // 5.2 and the Coverage row put back give the document with times, byte for byte.
    const back = JSON.parse(JSON.stringify(without)) as AgreementDoc;
    (back.sections[5].items.filter((i) => i.type === 'clause')[at] as { text: string }).text = TIMES_SET;
    const row = (back.sections[1].items.find((i) => i.type === 'table') as { rows: string[][] }).rows.find((r) => r[0] === 'Coverage')!;
    row[1] = COVERAGE_SET;
    expect(JSON.stringify(back)).toBe(JSON.stringify(withTimes));
  }
});

test('no phone and no times together: both twins, the numbers of a booking with them, and only the sign date left to fill', () => {
  const f = facts({ client_phone: undefined, start_time: undefined, end_time: undefined, price: undefined });
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(f, choice);
    const texts = clauses(doc).map((c) => c.text);
    expect(texts).toContain(NO_PHONE);
    expect(texts).toContain(TIMES_TBD);
    expect(texts).not.toContain(TIMES_SET);
    expect(rowsOf(doc)['Coverage']).toBe(COVERAGE_TBD);
    const json = JSON.stringify(doc);
    expect(json.split(SIGN_DATE_TOKEN)).toHaveLength(2);
    expect(json.split(SIGN_DATE_TOKEN).join('')).not.toMatch(/\{\{|\}\}|undefined|[–—]/);
    expectFromSource(doc);
  }
  // Spec 5.5, the Civil Ceremony at the site price ($551.25): 138.00 / 413.25 cash; private with every extra 723.00: 181.00 / 542.00.
  const EVERY = ['drone', 'extra-retouched', 'raw-photos-civil'];
  const amounts = (b: BookingFacts, choice: 'share' | 'private', extras: string[] = []) => {
    const m = factsFor(b, choice, extras);
    const r = rowsOf(renderVariant(b, choice, extras));
    return [m.total, m.retainer, m.balance, r['Total'], r['Retainer, due at signing'], r['Balance, due on or before the ceremony day']];
  };
  expect(amounts(f, 'share')).toEqual([551.25, 138, 413.25, '$551.25', '$138.00 by e-transfer', '$413.25 in cash']);
  expect(amounts(f, 'private', EVERY)).toEqual([723, 181, 542, '$723.00', '$181.00 by e-transfer', '$542.00 in cash']);
  // The same as the booking with a phone and times.
  const withBoth = facts({ price: undefined });
  expect(amounts(f, 'share')).toEqual(amounts(withBoth, 'share'));
  expect(amounts(f, 'private', EVERY)).toEqual(amounts(withBoth, 'private', EVERY));
});

// The engine reads the same data objects the tests import, so a test can bend them briefly to reach the guards.
const withChange = (change: () => () => void, fn: () => void) => {
  const undo = change();
  try {
    fn();
  } finally {
    undo();
  }
};
const civil = () => (agreementPackages as Record<string, any>)['civil-ceremony'];

test('a placeholder left in any part of the document is refused', () => {
  const f = facts();
  const stray = (target: () => string[], index: number, text: string) => () => {
    const arr = target();
    const before = arr[index];
    arr[index] = text;
    return () => {
      arr[index] = before;
    };
  };
  // A clause: a placeholder the fill pass does not recognise.
  const c22 = file.sections[22].items[0] as SourceClause;
  withChange(
    () => {
      const before = c22.text;
      c22.text = 'By signing, you confirm {{ SIGN_DATE }}.';
      return () => {
        c22.text = before;
      };
    },
    () => expect(codeOf(() => renderVariant(f, 'share'))).toBe('unfilled_placeholder'),
  );
  // A second sign date token in clause text.
  withChange(
    () => {
      const before = c22.text;
      c22.text = `Signed on ${SIGN_DATE_TOKEN}.`;
      return () => {
        c22.text = before;
      };
    },
    () => expect(codeOf(() => renderVariant(f, 'share'))).toBe('unfilled_placeholder'),
  );
  // A bullet, a table cell and a list item.
  const bulleted = file.sections[14].items.find((i) => i.type === 'clause' && i.id === '14.5') as SourceClause;
  withChange(stray(() => bulleted.bullets, 0, `On ${SIGN_DATE_TOKEN}`), () =>
    expect(codeOf(() => renderVariant(f, 'share'))).toBe('unfilled_placeholder'),
  );
  withChange(
    () => {
      const row = civil().addOnRows[2];
      const before = row.note;
      row.note = 'Weather permitting {{PRICE }}';
      return () => {
        row.note = before;
      };
    },
    () => expect(codeOf(() => renderVariant(f, 'share'))).toBe('unfilled_placeholder'),
  );
  withChange(stray(() => civil().deliverables, 0, `Photos dated ${SIGN_DATE_TOKEN}`), () =>
    expect(codeOf(() => renderVariant(f, 'share'))).toBe('unfilled_placeholder'),
  );
  // Everything is back as it was.
  expect(JSON.stringify(renderVariant(f, 'share')).split(SIGN_DATE_TOKEN)).toHaveLength(2);
});

test('an unknown block in the clause file throws and names the block', () => {
  const items = file.sections[3].items as unknown[];
  withChange(
    () => {
      items.push({ type: 'block', name: 'TABLE:SURPRISE' });
      return () => {
        items.pop();
      };
    },
    () => expect(() => renderVariant(facts(), 'share')).toThrow('TABLE:SURPRISE'),
  );
  expect(() => renderVariant(facts(), 'share')).not.toThrow();
});

test('the "not in the past" check uses the Toronto date', () => {
  // 03:00 UTC on 11 November is still 10 November in Toronto.
  const late = { number: 'KK-TEST-2026-002', createdAt: new Date('2026-11-11T03:00:00Z') };
  expect(codeOf(() => buildBookingFacts({ ...PILOT, event_date: '2026-11-10' }, late))).toBeUndefined();
});

test('facts agree with the site data', () => {
  const pkg = (agreementPackages as Record<string, any>)['civil-ceremony'];
  const byId = new Map((siteAddOns as { id: string; price: number | null; note: string }[]).map((a) => [a.id, a]));
  for (const row of pkg.addOnRows) {
    if (row.id === null) continue;
    expect(byId.has(row.id), row.id).toBe(true);
    expect(typeof byId.get(row.id)!.price, row.id).toBe('number');
  }
  expect(byId.get('extra-hours-civil')!.note).toContain(`${money(pkg.overtimeBlock)} per block`);
  expect(byId.get('extra-hours-civil')!.note).toContain('$100.75 per block');
  const site = (sitePackages as { id: string; hours: { included: number } }[]).find((p) => p.id === 'civil-ceremony')!;
  expect(site.hours.included).toBe(pkg.hours);
});

test('business settings are complete', () => {
  const values = [business.legalName, ...business.tradeNames, business.phone, business.email, business.etransferEmail];
  expect(business.tradeNames).toEqual(['AD Photography', 'KashKlicks']);
  for (const v of values) {
    expect(typeof v).toBe('string');
    expect(v.trim()).not.toBe('');
    expect(v).not.toMatch(/[[\]{}<>]/);
  }
});
