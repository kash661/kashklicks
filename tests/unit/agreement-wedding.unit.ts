import { test, expect } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import clausesJson from '../../src/data/agreement/clauses.json' with { type: 'json' };
import sitePackages from '../../src/data/packages.json' with { type: 'json' };
import siteAddOns from '../../src/data/add-ons.json' with { type: 'json' };
import agreementPackages from '../../src/data/agreement/packages.json' with { type: 'json' };
import business from '../../src/data/agreement/business.json' with { type: 'json' };
import { addMonths, money } from '../../src/lib/agreement/format';
import {
  SIGN_DATE_TOKEN,
  BookingError,
  buildBookingFacts,
  factsFor,
  fillSignDate,
  laterPaymentRows,
  renderVariant,
  signLabels,
} from '../../src/lib/agreement/render';
import type { AgreementDoc, BookingFacts, ClauseFile, DocItem, SourceClause } from '../../src/lib/agreement/types';
import { unpack } from './fixtures/old-bookings-runner';
import oldBookings from './fixtures/old-bookings.json' with { type: 'json' };

// The Full Day (wedding-full): two payments since 2026-11-23 (spec section 5), a second photographer,
// an engagement session. Invented people only.
const file = clausesJson as unknown as ClauseFile;

// A wedding booked before the payment change, as the code of that time stored it (three payments, the
// fee for private work; tests/unit/fixtures/old-bookings.json): the code that reads such facts stays.
const OLD = unpack((oldBookings as any).records['wedding-noset-fee'], oldBookings as any, { strings: true }) as {
  facts: BookingFacts;
  variants: Record<'share' | 'private', { doc_json: string }>;
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
  add_ons: [
    { id: 'second-photographer', qty: 7 },
    { id: 'raw-photos-wedding', qty: 1 },
  ],
};
const CTX = { number: 'KK-TEST-2026-007', createdAt: new Date('2026-11-22T15:00:00Z') };
const facts = (over: Record<string, unknown> = {}) => buildBookingFacts({ ...WEDDING, ...over }, CTX);

const codeOf = (fn: () => unknown): { code: string; field?: string } | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BookingError) return { code: e.code, field: e.field };
    throw e;
  }
  return undefined;
};

const sourceClauses = (): SourceClause[] =>
  file.sections.flatMap((s) => s.items).filter((i): i is SourceClause => i.type === 'clause');
const src = (id: string): SourceClause => {
  const c = sourceClauses().find((x) => x.id === id);
  if (!c) throw new Error(`clause ${id} missing`);
  return c;
};
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (c: SourceClause, text: string) =>
  new RegExp('^' + c.text.split(/\{\{[A-Z0-9_]+\}\}/).map(escRe).join('[\\s\\S]+?') + '$').test(text);
const clauses = (doc: AgreementDoc) =>
  doc.sections.flatMap((s) =>
    s.items.filter((i): i is Extract<DocItem, { type: 'clause' }> => i.type === 'clause').map((i) => ({ sec: s.num, ...i })),
  );
const table = (doc: AgreementDoc, kind: 'booking' | 'addons') => {
  for (const s of doc.sections) for (const i of s.items) if (i.type === 'table' && i.kind === kind) return i;
  throw new Error(`table ${kind} missing`);
};
const rowsOf = (doc: AgreementDoc) => Object.fromEntries(table(doc, 'booking').rows);

// The tags a wedding booking has, worked out here on their own (not by the engine).
// Re-pinned for spec 2026-11-23, section 6.1: PHONE or NO-PHONE, and TIMES-SET or TIMES-TBD (the booking
// fixture WEDDING has a phone and times: PHONE and TIMES-SET).
type Who = { phone: 'PHONE' | 'NO-PHONE'; times: 'TIMES-SET' | 'TIMES-TBD' };
const WITH_PHONE_AND_TIMES: Who = { phone: 'PHONE', times: 'TIMES-SET' };
const activeTags = (choice: 'share' | 'private', balance: string, who: Who) =>
  new Set([
    'ALL',
    ...(agreementPackages as Record<string, { tags: string[] }>)['wedding-full'].tags,
    ...(agreementPackages as Record<string, { sharing: Record<string, { tags: string[] }> }>)['wedding-full'].sharing[choice].tags,
    'HST-NO',
    // Re-pinned for the payment change (spec 2026-11-23, sections 5.1 and 5.3): RET-USUAL (was RET-HALF), and cash only by default.
    'RET-USUAL',
    balance,
    ...(business.insured ? ['INSURED'] : []),
    who.phone,
    who.times,
  ]);
const visibleSource = (choice: 'share' | 'private', balance = 'BAL-CASH', who = WITH_PHONE_AND_TIMES) =>
  sourceClauses().filter((c) => c.tags.some((g) => g.every((t) => activeTags(choice, balance, who).has(t))));
/** Rendered clause id list: each rendered clause paired, in order, with the source clause it must come from. */
const renderedIds = (doc: AgreementDoc, choice: 'share' | 'private', balance = 'BAL-CASH', who = WITH_PHONE_AND_TIMES): string[] => {
  const expected = visibleSource(choice, balance, who);
  const got = clauses(doc);
  expect(got.map((c) => c.text).length).toBe(expected.length);
  got.forEach((c, k) => expect(matches(expected[k], c.text), `${expected[k].id}: ${c.text}`).toBe(true));
  return expected.map((c) => c.id);
};

const WEDDING_PKG = () => (agreementPackages as Record<string, any>)['wedding-full'];

// ------------------------------------------------------------------ dates

test('addMonths keeps the day of the month and clamps to a shorter month', () => {
  expect(addMonths('2027-05-29', 3)).toBe('2027-08-29');
  expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
  expect(addMonths('2027-11-30', 3)).toBe('2028-02-29'); // a leap year
  expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
  expect(addMonths('2027-03-31', 1)).toBe('2027-04-30');
  expect(addMonths('2026-10-15', 3)).toBe('2027-01-15');
  expect(addMonths('2027-12-31', 12)).toBe('2028-12-31');
  expect(addMonths('2027-08-29', 0)).toBe('2027-08-29');
});

// ------------------------------------------------------------------ facts

test('wedding facts: two payments that add up, second photographer hours, delivery in months', () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): a 25% retainer and the
  // balance in cash on the day; no second or final payment (was 1,566 / 783 / 782.25 by e-transfer).
  const f = facts();
  expect(f.package_name).toBe('The Full Day');
  expect(f.package_price).toBe(2301.25); // the site sale price
  expect(f.add_ons).toEqual([
    { id: 'second-photographer', label: 'Second photographer, extra hours', qty: 7, unit_price: 101.25, line_total: 708.75 },
    { id: 'raw-photos-wedding', label: 'RAW photos', qty: 1, unit_price: 121.25, line_total: 121.25 },
  ]);
  expect(f.total).toBe(3131.25);
  expect(f.retainer).toBe(783);
  expect(f.balance).toBe(2348.25);
  expect(Math.round((f.retainer + f.balance) * 100)).toBe(Math.round(f.total * 100));
  for (const k of ['second_payment', 'final_payment', 'second_due', 'final_due']) expect(f).not.toHaveProperty(k);
  expect(laterPaymentRows(f)).toBeNull();
  expect(f.retainer_percent).toBe(25);
  expect(f.etransfer_email).toBe('kashklicks.ca@gmail.com');
  expect(f.delivery_date).toBe('2027-08-29');
  expect(f.second_hours).toBe(10);
  expect(f.hours).toBe(10);
  expect(f.balance_cash).toBe(true);
});

test('the two payments add up to the total for many totals', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): retainer = 25% rounded up to the
  // dollar, balance = the rest (was half, a quarter, and the rest).
  for (const price of [2301.25, 2301, 2301.01, 2301.5, 2301.75, 2302.99, 999.99, 4000]) {
    const f = facts({ price, add_ons: [] });
    expect(f.retainer, String(price)).toBe(Math.ceil((f.total * 25) / 100));
    expect(f).not.toHaveProperty('second_payment');
    expect(Math.round((f.retainer + f.balance) * 100), String(price)).toBe(Math.round(f.total * 100));
    expect(f.balance, String(price)).toBeGreaterThan(0);
    expect(Math.abs(f.balance * 100 - Math.round(f.balance * 100)) < 1e-6, String(price)).toBe(true);
  }
  // A wedding booked before the change keeps its three payments, and they add up (spec section 5.5).
  expect([OLD.facts.total, OLD.facts.retainer, OLD.facts.second_payment, OLD.facts.final_payment]).toEqual([3010, 1505, 753, 752]);
  expect(OLD.facts).not.toHaveProperty('retainer_percent');
});

test('civil facts carry none of the wedding fields', () => {
  const civil = buildBookingFacts(
    {
      package_id: 'civil-ceremony',
      client_name: 'Priya Sharma',
      partner_name: 'Arjun Mehta',
      client_email: 'priya@example.com',
      client_phone: '416 555 0142',
      event_date: '2026-12-12',
      start_time: '12:00',
      end_time: '14:00',
      place: 'Vaughan City Hall',
    },
    { number: 'KK-TEST-2026-001', createdAt: new Date('2026-11-10T15:00:00Z') },
  );
  for (const k of ['second_payment', 'final_payment', 'second_due', 'final_due', 'second_hours']) expect(civil).not.toHaveProperty(k);
  expect(laterPaymentRows(civil)).toBeNull();
});

// ------------------------------------------------------------------ refusals

test('what the wedding package has no clause for is refused', () => {
  // 3 + 8 = 11 second photographer hours on a 10 hour day.
  expect(codeOf(() => facts({ add_ons: [{ id: 'second-photographer', qty: 8 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  // A set retainer has no wedding clause (3.16 is NONWED): still refused (spec 2026-11-23, section 5.3).
  expect(codeOf(() => facts({ retainer: 1000 }))).toEqual({ code: 'bad_retainer', field: 'retainer' });
  // Re-pinned (spec section 5.3): the usual retainer is 25% now, $783.00, so one dollar more is a set retainer.
  expect(codeOf(() => facts({ retainer: 784 }))).toEqual({ code: 'bad_retainer', field: 'retainer' });
  expect(codeOf(() => facts({ retainer: 1566 }))).toEqual({ code: 'bad_retainer', field: 'retainer' });
  // The usual 25%, typed out, is the same as leaving it out.
  expect(JSON.stringify(facts({ retainer: 783 }))).toBe(JSON.stringify(facts()));
  // Re-pinned (spec section 5.3): a wedding no longer refuses balance_cash. Cash only is the default, so
  // saying true is the same as saying nothing; false lets this wedding pay the balance by e-transfer too.
  expect(JSON.stringify(facts({ balance_cash: true }))).toBe(JSON.stringify(facts()));
  expect(codeOf(() => facts({ balance_cash: false }))).toBeUndefined();
  expect(facts({ balance_cash: false }).balance_cash).toBe(false);
  // Booking priority delivery or a film needs clauses this agreement does not have yet.
  expect(codeOf(() => facts({ add_ons: [{ id: 'priority-delivery-wedding', qty: 1 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  expect(codeOf(() => facts({ add_ons: [{ id: 'wedding-film', qty: 1 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  expect(codeOf(() => facts({ add_ons: [{ id: 'raw-video-wedding', qty: 1 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  // Add-ons of other packages.
  expect(codeOf(() => facts({ add_ons: [{ id: 'extra-hours-civil', qty: 1 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  expect(codeOf(() => facts({ add_ons: [{ id: 'extra-retouched', qty: 1 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  // The site maximum of 14 still holds.
  expect(codeOf(() => facts({ add_ons: [{ id: 'second-photographer', qty: 15 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  // The hours must match the coverage.
  expect(codeOf(() => facts({ end_time: '20:00' }))).toEqual({ code: 'bad_times', field: 'end_time' });
});

test('a wedding soon after booking is accepted: there is no second payment date any more', () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.6): the 60 day limit existed
  // only for the second payment, so it went. 30 days ahead, 40 days ahead, even today: accepted.
  for (const event_date of ['2026-12-22', '2027-01-01', '2027-01-21', '2027-01-22', '2026-11-22']) {
    expect(codeOf(() => facts({ event_date })), event_date).toBeUndefined();
    const f = facts({ event_date });
    for (const k of ['second_payment', 'final_payment', 'second_due', 'final_due']) expect(f, `${event_date} ${k}`).not.toHaveProperty(k);
  }
  // A date before today is still refused.
  expect(codeOf(() => facts({ event_date: '2026-11-21' }))).toEqual({ code: 'bad_date', field: 'event_date' });
  // The Toronto date counts: 03:00 UTC on 23 November is still 22 November in Toronto.
  const late = { number: 'KK-TEST-2026-008', createdAt: new Date('2026-11-23T03:00:00Z') };
  expect(codeOf(() => buildBookingFacts({ ...WEDDING, event_date: '2026-11-22' }, late))).toBeUndefined();
  expect(codeOf(() => buildBookingFacts({ ...WEDDING, event_date: '2026-11-21' }, late))).toEqual({ code: 'bad_date', field: 'event_date' });
});

test('a package whose data does not match its tags throws instead of rendering', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): no package has `payments` any more,
  // and a package that has one is refused (was: three payments go with the WEDDING tag).
  const pkg = WEDDING_PKG();
  const keep = { secondPhotographer: pkg.secondPhotographer };
  expect(Object.hasOwn(pkg, 'payments')).toBe(false);
  const booked = facts();
  try {
    for (const payments of ['three-part', 'four-part', undefined]) {
      pkg.payments = payments;
      expect(() => facts(), String(payments)).toThrow('payments is not a package setting any more');
      expect(() => renderVariant(booked, 'share'), String(payments)).toThrow('payments is not a package setting any more');
    }
    delete pkg.payments;
    delete pkg.secondPhotographer;
    expect(() => facts()).toThrow('SECOND tag');
  } finally {
    delete pkg.payments;
    pkg.secondPhotographer = keep.secondPhotographer;
  }
  expect(Object.hasOwn(pkg, 'payments')).toBe(false);
  expect(() => facts()).not.toThrow();
});

test('stored wedding facts with three payments, or without their second photographer hours, do not render', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): a wedding booked before the change
  // has three payments; its texts are stored and served as they are, and no new text is made from its
  // facts (the clauses say two parts now). Facts that have half of the three payment fields still throw
  // where they are read (laterPaymentRows), as before.
  expect(() => renderVariant(OLD.facts, 'share')).toThrow('is paid in three parts');
  expect(() => renderVariant(OLD.facts, 'private')).toThrow('is paid in three parts');
  const { final_due: _b, ...noFinalDue } = OLD.facts;
  expect(() => laterPaymentRows(noFinalDue as BookingFacts)).toThrow('no final payment or due dates');
  const { second_hours: _c, ...noHours } = facts();
  expect(() => renderVariant(noHours as BookingFacts, 'share')).toThrow('no second photographer hours');
});

// ------------------------------------------------------------------ the document

test('both variants render, with only the sign date left to fill', () => {
  for (const choice of ['share', 'private'] as const) {
    const json = JSON.stringify(renderVariant(facts(), choice));
    expect(json.split(SIGN_DATE_TOKEN)).toHaveLength(2);
    const rest = json.split(SIGN_DATE_TOKEN).join('');
    expect(rest).not.toContain('{{');
    expect(rest).not.toContain('}}');
    const filled = fillSignDate(json, '22 November 2026');
    expect(filled).not.toContain('{{');
    const doc = JSON.parse(filled) as AgreementDoc;
    expect(clauses(doc)[4].text).toBe('This agreement is dated 22 November 2026. Your booking number is KK-TEST-2026-007.');
    expect(filled.replace('22 November 2026', SIGN_DATE_TOKEN)).toBe(json);
  }
});

test('numbering has no gaps in a wedding agreement', () => {
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

test('the visible clauses are exactly the ones the wedding tags allow', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.1): 3.12 is gone; 3.11 and the cash
  // clause 3.17 are for every package now, and a wedding is cash only by default.
  const must = ['3.6', '3.9', '3.11', '3.17', '5.17', '5.20', '7.4', '8.2', '10.8', '10.13', '11.4', '11.5', '11.6', '12.3', '16.6', '16.7', '16.8', '16.9', '16.10', '19.4'];
  // Every clause that only a two payment booking (NONWED) or a session (SHOOT) gets, read from clauses.json.
  const onlyNonWedOrShoot = sourceClauses()
    .filter((c) => c.tags.every((g) => g.includes('NONWED') || g.includes('SHOOT')))
    .map((c) => c.id);
  const filmOnly = sourceClauses()
    .filter((c) => c.tags.every((g) => g.includes('FILM')))
    .map((c) => c.id);
  expect(onlyNonWedOrShoot).toEqual(expect.arrayContaining(['3.5', '3.16', '5.1', '7.1', '11.1', '16.3', '19.3']));
  expect(onlyNonWedOrShoot).not.toContain('3.10');
  expect(onlyNonWedOrShoot).not.toContain('3.11');
  expect(filmOnly).toEqual(expect.arrayContaining(['2.6', '8.3', '10.2', '12.5', '12.8']));
  const mustNot = [...new Set([...onlyNonWedOrShoot, ...filmOnly, '3.5', '3.16', '3.10', '3.12', '8.3', '8.10', '8.13'])];
  for (const choice of ['share', 'private'] as const) {
    // balance_cash: false shows clause 3.10 and not 3.17 (spec section 5.6).
    const anyWay = renderedIds(renderVariant(facts({ balance_cash: false }), choice), choice, 'BAL-ANY');
    expect(anyWay).toContain('3.10');
    expect(anyWay).not.toContain('3.17');
    const ids = renderedIds(renderVariant(facts(), choice), choice);
    for (const id of must) expect(ids, id).toContain(id);
    for (const id of mustNot) expect(ids, id).not.toContain(id);
    // Share: the marketing fee clause (SHARE-B), not the free yes or no (SHARE-C). Private: 15.4 only.
    if (choice === 'share') {
      expect(ids).toContain('15.2');
      expect(ids).not.toContain('15.3');
    } else {
      expect(ids).toContain('15.4');
      expect(ids).not.toContain('15.2');
    }
  }
});

test('a wedding without a phone or without times: clause 0.6 or 5.23 takes the place of 0.1 or 5.2 (spec 2026-11-23, section 6)', () => {
  const noPhone = { client_phone: undefined };
  const noTimes = { start_time: undefined, end_time: undefined };
  const cases: [Record<string, unknown>, Who][] = [
    [{}, { phone: 'PHONE', times: 'TIMES-SET' }],
    [noPhone, { phone: 'NO-PHONE', times: 'TIMES-SET' }],
    [noTimes, { phone: 'PHONE', times: 'TIMES-TBD' }],
    [{ ...noPhone, ...noTimes }, { phone: 'NO-PHONE', times: 'TIMES-TBD' }],
  ];
  for (const choice of ['share', 'private'] as const)
    for (const [over, who] of cases) {
      const doc = renderVariant(facts(over), choice);
      // Every rendered clause, in order, is the one the independent tag set allows.
      const ids = renderedIds(doc, choice, 'BAL-CASH', who);
      const at = `${choice} ${who.phone} ${who.times}`;
      expect(ids.includes('0.1'), at).toBe(who.phone === 'PHONE');
      expect(ids.includes('0.6'), at).toBe(who.phone === 'NO-PHONE');
      expect(ids.includes('5.2'), at).toBe(who.times === 'TIMES-SET');
      expect(ids.includes('5.23'), at).toBe(who.times === 'TIMES-TBD');
      // The same number of clauses: each twin takes the place of the other.
      expect(ids.length, at).toBe(renderedIds(renderVariant(facts(), choice), choice).length);
      expect(clauses(doc)[0].text, at).toBe(
        who.phone === 'PHONE'
          ? '**You** are Elena Marchetti. Your email is elena@example.com and your phone is 416 555 0177.'
          : '**You** are Elena Marchetti. Your email is elena@example.com.',
      );
      expect(rowsOf(doc)['Coverage'], at).toBe(
        who.times === 'TIMES-SET'
          ? '10 hours, from 12:00 pm to 10:00 pm'
          : '10 hours in one continuous block. The start and end time are not set yet (section 5).',
      );
    }
});

test('the numbers of spec 5.5 hold for a wedding without a phone and without times (spec 2026-11-23, section 6)', () => {
  // The shape of the contract this was built for: a wedding, no phone, no times, three tick boxes.
  const f = facts({ client_phone: undefined, start_time: undefined, end_time: undefined, add_ons: [{ id: 'second-photographer', qty: 7 }] });
  expect(f).not.toHaveProperty('client_phone');
  expect(f).not.toHaveProperty('start_time');
  expect(f).not.toHaveProperty('end_time');
  expect(f.tick_boxes!.map((t) => t.id)).toEqual(['raw-photos-wedding', 'instax-guest-prints', 'guest-camera']);
  const amounts = (choice: 'share' | 'private', extras: string[] = []) => {
    const m = factsFor(f, choice, extras);
    const rows = rowsOf(renderVariant(f, choice, extras));
    return [m.total, m.retainer, m.balance, rows['Total'], rows['Retainer, due at signing'], rows['Balance, due on your wedding day']];
  };
  expect(amounts('share')).toEqual([3010, 753, 2257, '$3,010.00', '$753.00 by e-transfer', '$2,257.00 in cash']);
  expect(amounts('private')).toEqual([3085, 772, 2313, '$3,085.00', '$772.00 by e-transfer', '$2,313.00 in cash']);
  const all = ['raw-photos-wedding', 'instax-guest-prints', 'guest-camera'];
  expect(amounts('private', all)).toEqual([3266.25, 817, 2449.25, '$3,266.25', '$817.00 by e-transfer', '$2,449.25 in cash']);
  expect(factsFor(f, 'private', all).deposits).toEqual([
    {
      id: 'guest-camera',
      label: 'Guest camera deposit',
      amount: 100,
      note: 'Refundable, and not part of your total. Paid together with your balance, on your wedding day. I return it within 7 days after your wedding, when the camera comes back working and undamaged.',
    },
  ]);
  // The amounts are those of the same booking with a phone and times.
  const withBoth = facts({ add_ons: [{ id: 'second-photographer', qty: 7 }] });
  for (const choice of ['share', 'private'] as const)
    for (const extras of [[], all]) {
      const a = factsFor(f, choice, extras);
      const b = factsFor(withBoth, choice, extras);
      expect([a.total, a.retainer, a.balance, a.deposits]).toEqual([b.total, b.retainer, b.balance, b.deposits]);
    }
});

test('the engagement session clauses carry its description and value', () => {
  const site = (sitePackages as { id: string; price: number | null }[]).find((p) => p.id === 'love-story-mini-film')!;
  expect(site.price).toBe(551.25);
  const texts = clauses(renderVariant(facts(), 'share')).map((c) => c.text);
  const c1013 = texts.find((t) => matches(src('10.13'), t))!;
  const c169 = texts.find((t) => matches(src('16.9'), t))!;
  expect(c1013).toBe(
    'Your package includes an engagement session: 2 hours, with photos and a short film. It is optional. Please use it at least 30 days before your wedding. It has no cash value and cannot be swapped for money off. The rules for shoots in this agreement apply to it.',
  );
  expect(c169).toBe(
    'If your engagement session has already been photographed, its value of $551.25 is delivered work. I take it off the amount you paid before I work out the refund.',
  );
  expect(texts).toContain('I deliver your edited photos within 3 months of your wedding day. If your booking has more than one shoot day, the time starts after the last one.');
  expect(texts).toContain('Overtime costs $301.25 per hour. I bill it in 30 minute blocks of $150.75. A part of a block counts as a full block.');
});

test('a missing list price for the engagement session throws', () => {
  const pkg = WEDDING_PKG();
  const before = pkg.engagement.valuePackageId;
  try {
    pkg.engagement.valuePackageId = 'no-such-package';
    expect(() => renderVariant(facts(), 'share')).toThrow('no list price for no-such-package');
  } finally {
    pkg.engagement.valuePackageId = before;
  }
});

test('section 1 table is exact for the wedding', () => {
  const expected = (sharing: string): string[][] => [
    ['Booking number', 'KK-TEST-2026-007'],
    ['Package', 'The Full Day'],
    ['Package price', '$2,301.25'],
    ['Add-ons chosen at booking', 'Second photographer, extra hours, 7 × $101.25 = $708.75; RAW photos, 1 × $121.25 = $121.25'],
    ['Sharing choice (section 15)', sharing],
    ['Total', '$3,131.25'],
    // Re-pinned for the payment change (spec 2026-11-23, section 5.3): the retainer (25%) and one balance
    // row in cash, instead of the second and the final payment.
    ['Retainer, due at signing', '$783.00 by e-transfer'],
    ['Balance, due on your wedding day', '$2,348.25 in cash'],
    ['Wedding date', 'Saturday 29 May 2027'],
    ['Coverage', '10 hours, from 12:00 pm to 10:00 pm'],
    ['Where', 'St. Example Church, Hamilton. Reception in Burlington'],
    ['Who shoots', 'Akash Desai'],
    ['Second photographer', '10 hours, for your whole coverage. 3 hours are in your package and 7 are added.'],
    ['Delivery', 'Edited photos by Sunday 29 August 2027, which is within 3 months of your wedding.'],
    [
      'Costs that may apply later',
      'Overtime at $301.25 an hour, in 30 minute blocks of $150.75 (section 5). Parking at cost (section 6). Travel outside the GTA at $0.75 per km (section 6). A fee of $500.00 for a second change of date (section 11). Any add-on you choose later, at the prices in section 4.',
    ],
  ];
  const share = table(renderVariant(facts(), 'share'), 'booking');
  expect(share.rows).toEqual(expected('You allow sharing. No marketing fee.'));
  expect(share.bold).toEqual(['Total']);
  // Private: the fee row before Total, and every amount worked out again from the new total.
  const priv = expected('Private. Your work is not shown in public. A marketing fee of $75.00 is in your total.').map((r) => {
    if (r[0] === 'Total') return ['Total', '$3,206.25'];
    if (r[0] === 'Retainer, due at signing') return [r[0], '$802.00 by e-transfer'];
    if (r[0] === 'Balance, due on your wedding day') return [r[0], '$2,404.25 in cash'];
    return r;
  });
  priv.splice(priv.findIndex((r) => r[0] === 'Total'), 0, ['Marketing fee for private work', '$75.00']);
  expect(table(renderVariant(facts(), 'private'), 'booking').rows).toEqual(priv);
  const labels = share.rows.map((r) => r[0]);
  expect(labels).not.toContain('Balance, due on or before the ceremony day');
  expect(labels.filter((l) => /balance|payment/i.test(l))).toEqual(['Balance, due on your wedding day']);
  // balance_cash: false: the same row, either way.
  expect(rowsOf(renderVariant(facts({ balance_cash: false }), 'share'))['Balance, due on your wedding day']).toBe('$2,348.25 by e-transfer or cash');
});

test('notes still add their row for a wedding', () => {
  const rows = table(renderVariant(facts({ notes: 'Family photos at the church steps.' }), 'share'), 'booking').rows;
  const labels = rows.map((r) => r[0]);
  expect(labels.indexOf('Also agreed for your day')).toBe(labels.indexOf('Delivery') + 1);
});

test('section 4 table is exact for the wedding, every site price from the site data', () => {
  const price = (id: string) => (siteAddOns as { id: string; price: number }[]).find((a) => a.id === id)!.price;
  expect([price('extra-hours-wedding'), price('second-photographer'), price('drone'), price('priority-delivery-wedding'), price('raw-photos-wedding')]).toEqual([
    301.25, 101.25, 76.25, 501.25, 121.25,
  ]);
  expect(table(renderVariant(facts(), 'share'), 'addons').rows).toEqual([
    ['Additional hours', '$301.25 per hour', 'Book them before the day. They become part of your booked hours.'],
    ['Overtime', '$301.25 per hour', 'Billed in 30 minute blocks of $150.75. See section 5.'],
    ['Second photographer, extra hours', '$101.25 per hour', 'On top of the 3 hours in your package. Book them before the day.'],
    ['Drone and aerial frames', '$76.25', 'Weather and airspace permitting. Refunded in full if I cannot fly.'],
    ['A wedding film', 'Quoted for your wedding', 'Every price in this agreement is for photography. A film is agreed in writing, with its own price.'],
    ['Priority delivery', '$501.25', 'Your full gallery within 3 weeks of your wedding. Ask me in writing.'],
    ['Parking', 'At cost', 'With the receipt. See section 6.'],
    ['Travel outside the GTA', '$0.75 per km', 'Round trip, counted from the GTA boundary. See section 6.'],
    ['RAW photos', '$121.25', 'See section 13.'],
    ['Instax guest prints', '$60.00', '50 Fujifilm Instax instant prints, made on your wedding day.'],
    [
      'Guest camera',
      '$100.00 refundable deposit',
      'A small Sony camera that I hand to one of your guests for the day. There is no fee. You get the deposit back in full when the camera comes back working and undamaged.',
    ],
  ]);
});

test('deliverables list for the wedding', () => {
  const s2 = renderVariant(facts(), 'share').sections.find((s) => s.num === 2)!;
  expect(s2.items[0]).toMatchObject({ type: 'clause', n: '2.1', text: 'Your package is The Full Day. It includes:' });
  expect(s2.items[1]).toEqual({ type: 'list', items: WEDDING_PKG().deliverables });
});

test('wedding package data agrees with the site data', () => {
  const pkg = WEDDING_PKG();
  const site = (sitePackages as { id: string; hours: { included: number }; addOnIds: string[] }[]).find((p) => p.id === 'wedding-full')!;
  expect(site.hours.included).toBe(pkg.hours);
  const byId = new Map((siteAddOns as { id: string; price: number | null; note: string; max?: number }[]).map((a) => [a.id, a]));
  for (const row of pkg.addOnRows) {
    if (row.id === null) continue;
    if (row.price !== undefined) {
      // A contract-only add-on: never in the public site data.
      expect(byId.has(row.id), row.id).toBe(false);
      expect(site.addOnIds, row.id).not.toContain(row.id);
      continue;
    }
    expect(site.addOnIds, row.id).toContain(row.id);
    expect(typeof byId.get(row.id)!.price, row.id).toBe('number');
  }
  expect(byId.get('extra-hours-wedding')!.note).toContain(`(${money(pkg.overtimeBlock)} per block)`);
  expect(byId.get('second-photographer')!.max).toBe(14);
});

// ------------------------------------------------------------------ contract-only add-ons

const SECOND_ONLY = [{ id: 'second-photographer', qty: 7 }];

test('without RAW photos: the two payments for second photographer hours only', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.5): 753.00 / 2,257.00 cash (was 1,505 / 753 / 752).
  const f = facts({ add_ons: SECOND_ONLY });
  expect(f.total).toBe(3010);
  expect(f.retainer).toBe(753);
  expect(f.balance).toBe(2257);
  expect(f).not.toHaveProperty('second_payment');
  expect(f).not.toHaveProperty('final_payment');
  expect(Math.round((f.retainer + f.balance) * 100)).toBe(Math.round(f.total * 100));
  expect(rowsOf(renderVariant(f, 'share'))['Balance, due on your wedding day']).toBe('$2,257.00 in cash');
  expect(rowsOf(renderVariant(f, 'share'))['Add-ons chosen at booking']).toBe('Second photographer, extra hours, 7 × $101.25 = $708.75');
});

test('Instax guest prints are booked once at their contract price; the guest camera is never booked', () => {
  const f = facts({ add_ons: [...SECOND_ONLY, { id: 'instax-guest-prints', qty: 1 }] });
  expect(f.total).toBe(3070);
  expect(f.add_ons[1]).toEqual({ id: 'instax-guest-prints', label: 'Instax guest prints', qty: 1, unit_price: 60, line_total: 60 });
  // Re-pinned (spec 2026-11-23, section 5.3): two payments now.
  expect([f.retainer, f.balance]).toEqual([768, 2302]);
  expect(Math.round((f.retainer + f.balance) * 100)).toBe(307000);
  const line = rowsOf(renderVariant(f, 'share'))['Add-ons chosen at booking'];
  expect(line).toContain('Instax guest prints, 1 × $60.00 = $60.00');
  expect(rowsOf(renderVariant(f, 'share'))['Total']).toBe('$3,070.00');
  expect(codeOf(() => facts({ add_ons: [{ id: 'instax-guest-prints', qty: 2 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  expect(codeOf(() => facts({ add_ons: [{ id: 'instax-guest-prints', qty: 0 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  expect(codeOf(() => facts({ add_ons: [{ id: 'guest-camera', qty: 1 }] }))).toEqual({ code: 'bad_add_on', field: 'add_ons' });
  // Not an add-on of the civil ceremony.
  expect(
    codeOf(() =>
      buildBookingFacts(
        {
          package_id: 'civil-ceremony',
          client_name: 'Priya Sharma',
          partner_name: 'Arjun Mehta',
          client_email: 'priya@example.com',
          client_phone: '416 555 0142',
          event_date: '2026-12-12',
          start_time: '12:00',
          end_time: '14:00',
          place: 'Vaughan City Hall',
          add_ons: [{ id: 'instax-guest-prints', qty: 1 }],
        },
        { number: 'KK-TEST-2026-001', createdAt: new Date('2026-11-10T15:00:00Z') },
      ),
    ),
  ).toEqual({ code: 'bad_add_on', field: 'add_ons' });
});

test('a contract-only price on a site add-on, or on a row without an id, is a data mistake', () => {
  const rows = WEDDING_PKG().addOnRows as { id: string | null; label: string; price?: number }[];
  const instax = rows.find((r) => r.id === 'instax-guest-prints')!;
  const film = rows.find((r) => r.label === 'A wedding film')!;
  try {
    instax.id = 'drone'; // an id the site data has
    expect(() => renderVariant(facts(), 'share')).toThrow('package The Full Day, add-on row Instax guest prints: a contract-only price');
  } finally {
    instax.id = 'instax-guest-prints';
  }
  try {
    film.price = 10;
    expect(() => renderVariant(facts(), 'share')).toThrow('add-on row A wedding film: a contract-only price');
  } finally {
    delete film.price;
  }
  expect(() => renderVariant(facts(), 'share')).not.toThrow();
  expect(Object.hasOwn(film, 'price')).toBe(false);
});

// ------------------------------------------------------------------ the marketing fee for private work

test('share: no fee, and clause 15.2 names the marketing fee', () => {
  const f = facts({ add_ons: SECOND_ONLY });
  expect(f.private_fee).toBe(75);
  expect(f).not.toHaveProperty('sharing_fee');
  expect(factsFor(f, 'share')).toBe(f);
  // Re-pinned for the payment change (spec 2026-11-23, section 5.5): 3,010.00 / 753.00 / 2,257.00, no later payments.
  expect([f.total, f.retainer, f.balance, f.second_payment, f.final_payment]).toEqual([3010, 753, 2257, undefined, undefined]);
  const doc = renderVariant(f, 'share');
  const rows = table(doc, 'booking').rows;
  expect(rows.map((r) => r[0])).not.toContain('Marketing fee for private work');
  expect(Object.fromEntries(rows)['Sharing choice (section 15)']).toBe('You allow sharing. No marketing fee.');
  expect(Object.fromEntries(rows)['Total']).toBe('$3,010.00');
  const texts = clauses(doc).map((c) => c.text);
  expect(texts).toContain(
    'You have chosen to allow me to share your work as described in this section. This is your choice. If you would rather keep your work private, choose the private option before you sign. It adds a marketing fee of $75.00.',
  );
  expect(texts.some((t) => matches(src('15.3'), t))).toBe(false);
});

test('private: the fee is in the total and the payments are worked out again', () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): a fee for private work works
  // with two payments: 3,085.00, the usual 25% retainer of it (772.00), the balance (2,313.00).
  const booked = facts({ add_ons: SECOND_ONLY });
  const p = factsFor(booked, 'private');
  expect(p).not.toBe(booked);
  expect(p.sharing_fee).toBe(75);
  expect([p.total, p.retainer, p.balance, p.second_payment, p.final_payment]).toEqual([3085, 772, 2313, undefined, undefined]);
  expect(Math.round((p.retainer + p.balance) * 100)).toBe(308500);
  // Nothing else moves.
  const { sharing_fee: _f, total: _t, retainer: _r, balance: _b, ...restP } = p;
  const { total: _t2, retainer: _r2, balance: _b2, ...restB } = booked;
  expect(restP).toEqual(restB);
  // The booking itself is not changed.
  expect(booked.total).toBe(3010);
  // A wedding booked before the change: the three payments worked out again from the new total, as before.
  const old = factsFor(OLD.facts, 'private');
  expect([old.total, old.retainer, old.second_payment, old.final_payment, old.balance]).toEqual([3085, 1543, 772, 770, 1542]);
  expect(Math.round((old.retainer + old.second_payment! + old.final_payment!) * 100)).toBe(308500);
  expect(laterPaymentRows(old)!.map((r) => r.text.slice(0, 7))).toEqual(['$772.00', '$770.00']);

  const doc = renderVariant(booked, 'private');
  const rows = table(doc, 'booking').rows;
  const labels = rows.map((r) => r[0]);
  expect(labels.indexOf('Marketing fee for private work')).toBe(labels.indexOf('Total') - 1);
  const byLabel = Object.fromEntries(rows);
  expect(byLabel['Marketing fee for private work']).toBe('$75.00');
  expect(byLabel['Total']).toBe('$3,085.00');
  expect(byLabel['Retainer, due at signing']).toBe('$772.00 by e-transfer');
  expect(byLabel['Balance, due on your wedding day']).toBe('$2,313.00 in cash');
  expect(labels).not.toContain('Second payment');
  expect(labels).not.toContain('Final payment');
  expect(byLabel['Sharing choice (section 15)']).toBe('Private. Your work is not shown in public. A marketing fee of $75.00 is in your total.');
  expect(laterPaymentRows(p)).toBeNull();
  const texts = clauses(doc).map((c) => c.text);
  expect(texts.some((t) => matches(src('15.4'), t))).toBe(true);
  expect(texts.some((t) => matches(src('15.2'), t))).toBe(false);
  expect(signLabels(booked).share_option).toBe('Share our work. No marketing fee.');
  expect(signLabels(booked).private_option).toBe('Keep our work private. This adds a marketing fee of $75.00.');
});

test('factsFor never adds the fee twice, and leaves civil facts alone', () => {
  const p = factsFor(facts({ add_ons: SECOND_ONLY }), 'private');
  expect(() => factsFor(p, 'private')).toThrow('already in these facts');
  expect(() => factsFor(p, 'share')).toThrow('already in these facts');
  expect(() => renderVariant(p, 'private')).toThrow('already in these facts');
  const civil = buildBookingFacts(
    {
      package_id: 'civil-ceremony',
      client_name: 'Priya Sharma',
      partner_name: 'Arjun Mehta',
      client_email: 'priya@example.com',
      client_phone: '416 555 0142',
      event_date: '2026-12-12',
      start_time: '12:00',
      end_time: '14:00',
      place: 'Vaughan City Hall',
    },
    { number: 'KK-TEST-2026-001', createdAt: new Date('2026-11-10T15:00:00Z') },
  );
  expect(civil).not.toHaveProperty('private_fee');
  expect(factsFor(civil, 'share')).toBe(civil);
  expect(factsFor(civil, 'private')).toBe(civil);
});

test('a fee for private work that does not fit its package is a data mistake', () => {
  const wed = WEDDING_PKG();
  const civilPkg = (agreementPackages as Record<string, any>)['civil-ceremony'];
  const shareTags = [...wed.sharing.share.tags];
  try {
    // privateFee without SHARE-B.
    wed.sharing.share.tags = ['SHARE', 'SHARE-C'];
    expect(() => facts()).toThrow('a privateFee goes with the SHARE-B tag');
    wed.sharing.share.tags = shareTags;
    // SHARE-B without privateFee.
    delete wed.privateFee;
    expect(() => facts()).toThrow('the SHARE-B tag needs a privateFee');
    // Not a whole number of cents.
    wed.privateFee = 75.005;
    expect(() => facts()).toThrow('privateFee must be a whole number of cents');
    wed.privateFee = 0;
    expect(() => facts()).toThrow('privateFee must be a whole number of cents');
  } finally {
    wed.sharing.share.tags = shareTags;
    wed.privateFee = 75;
  }
  const civilShare = civilPkg.sharing.share.tags;
  try {
    // Re-pinned for the payment change (spec 2026-11-23, section 5.3): a fee for private work works with
    // two payments now (it threw "not built yet"): the new total, its usual retainer, the balance.
    civilPkg.privateFee = 75;
    civilPkg.sharing.share.tags = ['SHARE', 'SHARE-B'];
    const civil = buildBookingFacts(
      {
        package_id: 'civil-ceremony',
        client_name: 'Priya Sharma',
        partner_name: 'Arjun Mehta',
        client_email: 'priya@example.com',
        client_phone: '416 555 0142',
        event_date: '2026-12-12',
        start_time: '12:00',
        end_time: '14:00',
        place: 'Vaughan City Hall',
        price: 501.25,
      },
      { number: 'KK-TEST-2026-001', createdAt: new Date('2026-11-10T15:00:00Z') },
    );
    expect(civil.private_fee).toBe(75);
    const p = factsFor(civil, 'private');
    expect([p.total, p.retainer, p.balance, p.sharing_fee]).toEqual([576.25, 145, 431.25, 75]);
    expect(p).not.toHaveProperty('second_payment');
    // A set retainer stays a set retainer with the fee.
    const set = factsFor({ ...civil, retainer: 300, balance: 201.25 }, 'private');
    expect([set.total, set.retainer, set.balance]).toEqual([576.25, 300, 276.25]);
  } finally {
    delete civilPkg.privateFee;
    civilPkg.sharing.share.tags = civilShare;
  }
  expect(Object.hasOwn(civilPkg, 'privateFee')).toBe(false);
  expect(() => facts()).not.toThrow();
});

test('stored wedding facts without a fee do not render against a package that has one', () => {
  const { private_fee: _drop, ...old } = facts();
  expect(() => renderVariant(old as BookingFacts, 'share')).toThrow('do not agree on a fee for private work');
  expect(factsFor(old as BookingFacts, 'private')).toBe(old);
});

// ------------------------------------------------------------------ the second photographer row

const secondRow = (f: BookingFacts) => rowsOf(renderVariant(f, 'share'))['Second photographer'];

test('without extra second photographer hours the row says 3 hours, your choice', () => {
  const f = facts({ add_ons: [] });
  expect(f.second_hours).toBe(3);
  expect(f.total).toBe(2301.25);
  expect(secondRow(f)).toBe('3 hours, for the ceremony or the reception (your choice)');
  const labels = table(renderVariant(f, 'share'), 'booking').rows.map((r) => r[0]);
  expect(labels.indexOf('Second photographer')).toBe(labels.indexOf('Who shoots') + 1);
  expect(rowsOf(renderVariant(f, 'share'))['Add-ons chosen at booking']).toBe('None');
});

test('with fewer second photographer hours than the coverage the row says one continuous block', () => {
  const f = facts({
    start_time: '10:00',
    end_time: '22:00',
    add_ons: [
      { id: 'extra-hours-wedding', qty: 2 },
      { id: 'second-photographer', qty: 7 },
    ],
  });
  expect(f.hours).toBe(12);
  expect(f.second_hours).toBe(10);
  expect(f.total).toBe(2301.25 + 602.5 + 708.75);
  const rows = rowsOf(renderVariant(f, 'share'));
  expect(rows['Second photographer']).toBe(
    '10 hours in one continuous block. You choose which part of the day. 3 hours are in your package and 7 are added.',
  );
  expect(rows['Coverage']).toBe('12 hours, from 10:00 am to 10:00 pm');
  // With 12 hours, 9 extra second photographer hours fit and 10 do not.
  expect(codeOf(() => facts({ start_time: '10:00', end_time: '22:00', add_ons: [{ id: 'extra-hours-wedding', qty: 2 }, { id: 'second-photographer', qty: 9 }] }))).toBeUndefined();
  expect(codeOf(() => facts({ start_time: '10:00', end_time: '22:00', add_ons: [{ id: 'extra-hours-wedding', qty: 2 }, { id: 'second-photographer', qty: 10 }] }))).toEqual({
    code: 'bad_add_on',
    field: 'add_ons',
  });
});

test('one extra second photographer hour reads "1 is added"', () => {
  expect(secondRow(facts({ add_ons: [{ id: 'second-photographer', qty: 1 }] }))).toBe(
    '4 hours in one continuous block. You choose which part of the day. 3 hours are in your package and 1 is added.',
  );
});

// ------------------------------------------------------------------ labels, later payment rows, wording

test('wedding sign labels', () => {
  expect(signLabels(facts())).toEqual({
    share_option: 'Share our work. No marketing fee.',
    private_option: 'Keep our work private. This adds a marketing fee of $75.00.',
    agree_label:
      'I have read this agreement and I agree to it. I am signing for myself and for Daniel Okafor. Signing here is my electronic signature.',
    intro_bullets: ['Elena signs for both of you.', 'You can download or print a copy before you sign.', 'You will get a PDF copy by email the moment you sign.'],
    after_signing: {
      title: 'Your engagement session',
      text: 'Your package includes an engagement session. Message me when you are ready to plan it. Closer to the wedding, please send me your final timeline, your addresses and your list of family photos, at least 14 days before the day.',
    },
  });
});

test('later payment rows use the same words as section 1', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): only a wedding booked before the
  // change has later payments. Their rows are the words of section 1 of its STORED texts, for both choices.
  expect(laterPaymentRows(facts())).toBeNull();
  for (const choice of ['share', 'private'] as const) {
    const later = laterPaymentRows(factsFor(OLD.facts, choice))!;
    expect(later.map((r) => r.label)).toEqual(['Second payment', 'Final payment']);
    const rows = rowsOf(JSON.parse(OLD.variants[choice].doc_json) as AgreementDoc);
    for (const r of later) expect(rows[r.label], `${choice} ${r.label}`).toBe(r.text);
  }
});

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

test('no dash in anything a wedding client reads', () => {
  const all = [
    ...strings(WEDDING_PKG()),
    ...strings(renderVariant(facts(), 'share')),
    ...strings(renderVariant(facts(), 'private')),
    ...strings(renderVariant(facts({ add_ons: [] }), 'share')),
    ...strings(renderVariant(facts({ add_ons: [{ id: 'second-photographer', qty: 7 }, { id: 'instax-guest-prints', qty: 1 }] }), 'private')),
    ...strings(signLabels(facts())),
    ...strings(laterPaymentRows(facts())),
    ...strings(laterPaymentRows(factsFor(facts({ add_ons: SECOND_ONLY }), 'private'))),
    ...strings(renderVariant(facts({ add_ons: SECOND_ONLY }), 'private')),
    ...strings(signLabels(facts({ add_ons: SECOND_ONLY }))),
    secondRow(facts({ add_ons: [{ id: 'second-photographer', qty: 1 }] })),
  ];
  expect(all.length).toBeGreaterThan(100);
  for (const s of all) expect(s, s).not.toMatch(/[—–]/);
});

// ------------------------------------------------------------------ sample text for review

/** With AGREEMENT_SAMPLE=<path>.txt, writes the whole wedding agreement as plain text: share there, private at <path>-private.txt. */
test('wedding sample text', () => {
  const out = process.env.AGREEMENT_SAMPLE;
  test.skip(!out, 'set AGREEMENT_SAMPLE to write the sample');
  for (const choice of ['share', 'private'] as const) writeSample(choice === 'share' ? out! : out!.replace(/\.txt$/, '-private.txt'), choice);
});

function writeSample(out: string, choice: 'share' | 'private') {
  // Booked as the owner decided: second photographer extra hours only, no RAW photos.
  const booked = facts({ add_ons: [{ id: 'second-photographer', qty: 7 }] });
  const doc = JSON.parse(fillSignDate(JSON.stringify(renderVariant(booked, choice)), '22 November 2026')) as AgreementDoc;
  const lines: string[] = [doc.title, '', doc.intro, ''];
  for (const s of doc.sections) {
    lines.push(s.num === 0 ? s.title : `${s.num}. ${s.title}`, '');
    for (const it of s.items) {
      if (it.type === 'clause') {
        lines.push(it.n ? `${it.n} ${it.text}` : it.text);
        for (const b of it.bullets) lines.push(`  - ${b}`);
      } else if (it.type === 'table') for (const r of it.rows) lines.push(`  | ${r.join(' | ')}`);
      else for (const li of it.items) lines.push(`  * ${li}`);
      lines.push('');
    }
  }
  lines.push(doc.business_signature, '');
  const labels = signLabels(booked);
  lines.push('--- around the text on the page ---', ...labels.intro_bullets.map((b) => `* ${b}`), labels.share_option, labels.private_option, labels.agree_label);
  lines.push(`Step 2: ${labels.after_signing.title}. ${labels.after_signing.text}`, '');
  writeFileSync(out, lines.join('\n'));
}
