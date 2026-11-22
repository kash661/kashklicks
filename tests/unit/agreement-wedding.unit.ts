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
  fillSignDate,
  laterPaymentRows,
  renderVariant,
  signLabels,
} from '../../src/lib/agreement/render';
import type { AgreementDoc, BookingFacts, ClauseFile, DocItem, SourceClause } from '../../src/lib/agreement/types';

// The Full Day (wedding-full): three payments, a second photographer, an engagement session.
// Invented people only.
const file = clausesJson as unknown as ClauseFile;

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
const activeTags = (choice: 'share' | 'private') =>
  new Set([
    'ALL',
    ...(agreementPackages as Record<string, { tags: string[] }>)['wedding-full'].tags,
    ...(choice === 'share' ? ['SHARE', 'SHARE-C'] : ['PRIVATE']),
    'HST-NO',
    'RET-HALF',
    'BAL-ANY',
    ...(business.insured ? ['INSURED'] : []),
  ]);
const visibleSource = (choice: 'share' | 'private') =>
  sourceClauses().filter((c) => c.tags.some((g) => g.every((t) => activeTags(choice).has(t))));
/** Rendered clause id list: each rendered clause paired, in order, with the source clause it must come from. */
const renderedIds = (doc: AgreementDoc, choice: 'share' | 'private'): string[] => {
  const expected = visibleSource(choice);
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

test('wedding facts: three payments that add up, second photographer hours, delivery in months', () => {
  const f = facts();
  expect(f.package_name).toBe('The Full Day');
  expect(f.package_price).toBe(2301.25); // the site sale price
  expect(f.add_ons).toEqual([
    { id: 'second-photographer', label: 'Second photographer, extra hours', qty: 7, unit_price: 101.25, line_total: 708.75 },
    { id: 'raw-photos-wedding', label: 'RAW photos', qty: 1, unit_price: 121.25, line_total: 121.25 },
  ]);
  expect(f.total).toBe(3131.25);
  expect(f.retainer).toBe(1566);
  expect(f.second_payment).toBe(783);
  expect(f.final_payment).toBe(782.25);
  expect(Math.round((f.retainer + f.second_payment! + f.final_payment!) * 100)).toBe(Math.round(f.total * 100));
  expect(f.balance).toBe(1565.25);
  expect(f.second_due).toBe('2027-03-30');
  expect(f.final_due).toBe('2027-05-15');
  expect(f.delivery_date).toBe('2027-08-29');
  expect(f.second_hours).toBe(10);
  expect(f.hours).toBe(10);
  expect(f.balance_cash).toBe(false);
});

test('the three payments add up to the total for many totals', () => {
  for (const price of [2301.25, 2301, 2301.01, 2301.5, 2301.75, 2302.99, 999.99, 4000]) {
    const f = facts({ price, add_ons: [] });
    expect(f.retainer).toBe(Math.ceil(f.total / 2));
    expect(f.second_payment).toBe(Math.ceil(f.total / 4));
    expect(Math.round((f.retainer + f.second_payment! + f.final_payment!) * 100), String(price)).toBe(Math.round(f.total * 100));
    expect(f.final_payment!, String(price)).toBeGreaterThan(0);
    expect(Math.abs(f.final_payment! * 100 - Math.round(f.final_payment! * 100)) < 1e-6, String(price)).toBe(true);
  }
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
  // A set retainer is a two payment clause (NONWED).
  expect(codeOf(() => facts({ retainer: 1000 }))).toEqual({ code: 'bad_retainer', field: 'retainer' });
  expect(codeOf(() => facts({ retainer: 1567 }))).toEqual({ code: 'bad_retainer', field: 'retainer' });
  // The usual half, typed out, is the same as leaving it out.
  expect(JSON.stringify(facts({ retainer: 1566 }))).toBe(JSON.stringify(facts()));
  // Cash only is a two payment clause (NONWED). Saying false is the same as saying nothing.
  expect(codeOf(() => facts({ balance_cash: true }))).toEqual({ code: 'bad_balance_cash', field: 'balance_cash' });
  expect(JSON.stringify(facts({ balance_cash: false }))).toBe(JSON.stringify(facts()));
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

test('a wedding whose second payment date has already come is refused', () => {
  // 40 days ahead: 60 days before the wedding was 20 days ago.
  expect(codeOf(() => facts({ event_date: '2027-01-01' }))).toEqual({ code: 'bad_date', field: 'event_date' });
  // Exactly 60 days ahead: the second payment would be due today.
  expect(codeOf(() => facts({ event_date: '2027-01-21' }))).toEqual({ code: 'bad_date', field: 'event_date' });
  // 61 days ahead: due tomorrow, which is fine.
  const f = facts({ event_date: '2027-01-22' });
  expect(f.second_due).toBe('2026-11-23');
  expect(f.final_due).toBe('2027-01-08');
  // The Toronto date counts: 03:00 UTC on 23 November is still 22 November in Toronto.
  const late = { number: 'KK-TEST-2026-008', createdAt: new Date('2026-11-23T03:00:00Z') };
  expect(codeOf(() => buildBookingFacts({ ...WEDDING, event_date: '2027-01-22' }, late))).toBeUndefined();
});

test('a package whose data does not match its tags throws instead of rendering', () => {
  const pkg = WEDDING_PKG();
  const keep = { payments: pkg.payments, secondPhotographer: pkg.secondPhotographer };
  try {
    delete pkg.payments;
    expect(() => facts()).toThrow('three payments and the WEDDING tag go together');
    pkg.payments = 'four-part';
    expect(() => facts()).toThrow('unknown payments');
    pkg.payments = keep.payments;
    delete pkg.secondPhotographer;
    expect(() => facts()).toThrow('SECOND tag');
  } finally {
    pkg.payments = keep.payments;
    pkg.secondPhotographer = keep.secondPhotographer;
  }
  expect(() => facts()).not.toThrow();
});

test('stored wedding facts missing their payment fields do not render', () => {
  const { second_payment: _a, ...noPayments } = facts();
  expect(() => renderVariant(noPayments as BookingFacts, 'share')).toThrow('no later payments');
  const { final_due: _b, ...noFinalDue } = facts();
  expect(() => renderVariant(noFinalDue as BookingFacts, 'share')).toThrow('no final payment or due dates');
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
  const must = ['3.6', '3.12', '5.17', '5.20', '7.4', '8.2', '10.8', '10.13', '11.4', '11.5', '11.6', '12.3', '16.6', '16.7', '16.8', '16.9', '16.10', '19.4'];
  // Every clause that only a two payment booking (NONWED) or a session (SHOOT) gets, read from clauses.json.
  const onlyNonWedOrShoot = sourceClauses()
    .filter((c) => c.tags.every((g) => g.includes('NONWED') || g.includes('SHOOT')))
    .map((c) => c.id);
  const filmOnly = sourceClauses()
    .filter((c) => c.tags.every((g) => g.includes('FILM')))
    .map((c) => c.id);
  expect(onlyNonWedOrShoot).toEqual(expect.arrayContaining(['3.5', '3.10', '3.11', '5.1', '7.1', '11.1', '16.3', '19.3']));
  expect(filmOnly).toEqual(expect.arrayContaining(['2.6', '8.3', '10.2', '12.5', '12.8']));
  const mustNot = [...new Set([...onlyNonWedOrShoot, ...filmOnly, '3.5', '3.16', '3.10', '3.17', '8.3', '8.10', '8.13'])];
  for (const choice of ['share', 'private'] as const) {
    const ids = renderedIds(renderVariant(facts(), choice), choice);
    for (const id of must) expect(ids, id).toContain(id);
    for (const id of mustNot) expect(ids, id).not.toContain(id);
    expect(ids).toContain(choice === 'share' ? '15.3' : '15.4');
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
  const expected = (sharing: string) => [
    ['Booking number', 'KK-TEST-2026-007'],
    ['Package', 'The Full Day'],
    ['Package price', '$2,301.25'],
    ['Add-ons chosen at booking', 'Second photographer, extra hours, 7 × $101.25 = $708.75; RAW photos, 1 × $121.25 = $121.25'],
    ['Sharing choice (section 15)', sharing],
    ['Total', '$3,131.25'],
    ['Retainer, due at signing', '$1,566.00 by e-transfer'],
    [
      'Second payment',
      '$783.00 by e-transfer. Due 7 days after I deliver your engagement session gallery. If you have not had your engagement session by Tuesday 30 March 2027, it is due on that date.',
    ],
    ['Final payment', '$782.25 by e-transfer. Due by Saturday 15 May 2027, which is 14 days before your wedding.'],
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
  expect(share.rows).toEqual(expected('You allow sharing. It does not change your price.'));
  expect(share.bold).toEqual(['Total']);
  expect(table(renderVariant(facts(), 'private'), 'booking').rows).toEqual(expected('Private. Your work is not shown in public.'));
  const labels = share.rows.map((r) => r[0]);
  expect(labels).not.toContain('Balance, due on or before the ceremony day');
  expect(labels.filter((l) => /balance/i.test(l))).toEqual([]);
});

test('notes still add their row for a wedding', () => {
  const rows = table(renderVariant(facts({ notes: 'Family photos at the church steps.' }), 'share'), 'booking').rows;
  const labels = rows.map((r) => r[0]);
  expect(labels.indexOf('Also agreed for your day')).toBe(labels.indexOf('Delivery') + 1);
});

test('section 4 table is exact for the wedding, every price from the site data', () => {
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
    ['RAW photos', '$121.25', 'See section 13.'],
    ['Parking', 'At cost', 'With the receipt. See section 6.'],
    ['Travel outside the GTA', '$0.75 per km', 'Round trip, counted from the GTA boundary. See section 6.'],
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
    expect(site.addOnIds, row.id).toContain(row.id);
    expect(typeof byId.get(row.id)!.price, row.id).toBe('number');
  }
  expect(byId.get('extra-hours-wedding')!.note).toContain(`(${money(pkg.overtimeBlock)} per block)`);
  expect(byId.get('second-photographer')!.max).toBe(14);
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
    share_option: 'Share our work. My price stays the same.',
    private_option: 'Keep our work private. My price stays the same.',
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
  const f = facts();
  const later = laterPaymentRows(f)!;
  expect(later.map((r) => r.label)).toEqual(['Second payment', 'Final payment']);
  const rows = rowsOf(renderVariant(f, 'share'));
  for (const r of later) expect(rows[r.label]).toBe(r.text);
});

const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];

test('no dash in anything a wedding client reads', () => {
  const all = [
    ...strings(WEDDING_PKG()),
    ...strings(renderVariant(facts(), 'share')),
    ...strings(renderVariant(facts(), 'private')),
    ...strings(renderVariant(facts({ add_ons: [] }), 'share')),
    ...strings(signLabels(facts())),
    ...strings(laterPaymentRows(facts())),
    secondRow(facts({ add_ons: [{ id: 'second-photographer', qty: 1 }] })),
  ];
  expect(all.length).toBeGreaterThan(100);
  for (const s of all) expect(s, s).not.toMatch(/[—–]/);
});

// ------------------------------------------------------------------ sample text for review

/** With AGREEMENT_SAMPLE=<path>, writes the whole wedding agreement (share) as plain text there. */
test('wedding sample text', () => {
  const out = process.env.AGREEMENT_SAMPLE;
  test.skip(!out, 'set AGREEMENT_SAMPLE to write the sample');
  const doc = JSON.parse(fillSignDate(JSON.stringify(renderVariant(facts(), 'share')), '22 November 2026')) as AgreementDoc;
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
  const labels = signLabels(facts());
  lines.push('--- around the text on the page ---', ...labels.intro_bullets.map((b) => `* ${b}`), labels.share_option, labels.private_option, labels.agree_label);
  lines.push(`Step 2: ${labels.after_signing.title}. ${labels.after_signing.text}`, '');
  writeFileSync(out!, lines.join('\n'));
});
