import { test, expect } from '@playwright/test';
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
} from '../../src/lib/agreement/render';
import type { AgreementDoc, ClauseFile, SourceClause, DocItem } from '../../src/lib/agreement/types';

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

test('retainer is half, rounded up to the next dollar', () => {
  for (const [price, retainer, balance] of [
    [501.25, 251, 250.25],
    [551.25, 276, 275.25],
    [851.25, 426, 425.25],
  ]) {
    const f = facts({ price });
    expect(f.total).toBe(price);
    expect(f.retainer).toBe(retainer);
    expect(f.balance).toBe(balance);
  }
});

test('pilot facts', () => {
  const f = facts();
  expect(f.number).toBe('KK-TEST-2026-001');
  expect(f.created_at).toBe('2026-11-10T15:00:00.000Z');
  expect(f.package_name).toBe('The Civil Ceremony');
  expect(f.package_price).toBe(501.25);
  expect(f.add_ons).toEqual([]);
  expect(f.total).toBe(501.25);
  expect(f.retainer).toBe(251);
  expect(f.balance).toBe(250.25);
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
  expect(f.retainer).toBe(352);
  expect(f.balance).toBe(350.5);
  const rows = Object.fromEntries(table(renderVariant(f, 'share'), 'booking').rows);
  expect(rows['Add-ons chosen at booking']).toBe('Additional hours, 1 × $201.25 = $201.25');
  expect(rows['Coverage']).toBe('3 hours, from 12:00 pm to 3:00 pm');
  expect(rows['Total']).toBe('$702.50');
  expect(rows['Retainer, due at signing']).toBe('$352.00 by e-transfer');
  expect(rows['Balance, due on or before the ceremony day']).toBe('$350.50 by e-transfer or cash');
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
    ['Retainer, due at signing', '$251.00 by e-transfer'],
    ['Balance, due on or before the ceremony day', '$250.25 by e-transfer or cash'],
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
    expect(shows(doc, '5.1')).toBe(false);
    for (const id of ['3.5', '3.10', '3.11', '7.3', '10.1', '11.12', '16.3']) expect(shows(doc, id), id).toBe(true);
    expect(shows(doc, '3.6')).toBe(false);
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

test('clause text is the source text, with only placeholders filled', () => {
  const doc = renderVariant(facts(), 'share');
  const sourceTexts = file.sections.flatMap((s) => s.items).filter((i): i is SourceClause => i.type === 'clause');
  for (const c of clauses(doc)) {
    const from = sourceTexts.filter((s) => matches(s, c.text));
    expect(from, c.text).toHaveLength(1);
    expect(c.bullets).toEqual(from[0].bullets);
  }
  const all = clauses(doc);
  expect(all[0].text).toBe('**You** are Priya Sharma. Your email is priya@example.com and your phone is 416 555 0142.');
  expect(all[1].text).toBe('You are signing for yourself and for your partner, Arjun Mehta.');
  expect(all[2].text).toBe(
    '**I** am Akash Desai, operating as AD Photography and KashKlicks. Phone 647 613 7430. Email info@kashklicks.ca. Website kashklicks.ca.',
  );
  expect(all[4].text).toBe('This agreement is dated {{SIGN_DATE}}. Your booking number is KK-TEST-2026-001.');
  const texts = all.map((c) => c.text);
  expect(texts).toContain('Overtime costs $201.25 per hour. I bill it in 30 minute blocks of $100.75. A part of a block counts as a full block.');
  expect(texts).toContain(
    'You can pay by Interac e-transfer to info@kashklicks.ca. Please put your booking number in the message. I send a receipt or an invoice for every payment.',
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
  expect(codeOf(() => facts({ package_id: 'wedding-full' }))).toBe('package_not_ready');
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
