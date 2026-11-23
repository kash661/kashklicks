import { test, expect } from '@playwright/test';
import clausesJson from '../../src/data/agreement/clauses.json' with { type: 'json' };
import agreementPackages from '../../src/data/agreement/packages.json' with { type: 'json' };
import business from '../../src/data/agreement/business.json' with { type: 'json' };
import pageJson from '../../src/data/agreement/page.json' with { type: 'json' };
import { BookingError, buildBookingFacts, factsFor, laterPaymentRows, mixesOf } from '../../src/lib/agreement/render';
import { PARTS } from '../../src/lib/agreement/parts';
import { mixSummaries, mixSummary, pageContent, type PageContent } from '../../src/lib/agreement/page';
import type { BookingFacts, ClauseFile } from '../../src/lib/agreement/types';

// The page content (main points, glance, tick boxes) and the per-mix summary. Invented people only.

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
const CIVIL_CTX = { number: 'KK-TEST-2026-001', createdAt: new Date('2026-11-10T15:00:00Z') };
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
const WEDDING_CTX = { number: 'KK-TEST-2026-007', createdAt: new Date('2026-11-22T15:00:00Z') };
const SECOND_ONLY = [{ id: 'second-photographer', qty: 7 }];

const civilFacts = (over: Record<string, unknown> = {}) => buildBookingFacts({ ...PILOT, ...over }, CIVIL_CTX);
const weddingFacts = (over: Record<string, unknown> = {}) => buildBookingFacts({ ...WEDDING, ...over }, WEDDING_CTX);

const SAMPLES: Record<string, () => BookingFacts> = {
  'wedding, three tick boxes': () => weddingFacts({ add_ons: SECOND_ONLY }),
  'wedding, RAW already booked': () => weddingFacts(),
  'wedding, second photographer of the package only': () => weddingFacts({ add_ons: [] }),
  'wedding, second photographer for part of the day, with notes': () =>
    weddingFacts({ add_ons: [{ id: 'second-photographer', qty: 3 }, { id: 'instax-guest-prints', qty: 1 }], notes: 'First look at the church garden.' }),
  'civil, usual retainer': () => civilFacts(),
  'civil, set retainer, cash only': () => civilFacts({ retainer: 51.25, balance_cash: true }),
  // Re-pinned for the payment change (spec 2026-11-23, section 5.6): 157 is 25% of one mix (the drone), was 314 (half).
  'civil, set retainer equal to the usual share of one mix': () => civilFacts({ price: 551.25, retainer: 157, notes: '' }),
  'civil, everything booked up front': () =>
    civilFacts({ add_ons: [{ id: 'drone', qty: 1 }, { id: 'extra-retouched', qty: 2 }, { id: 'raw-photos-civil', qty: 1 }] }),
};

const B = business as { legalName: string; tradeNames: string[]; phone: string; email: string; etransferEmail: string; whoShoots: string };
const PAGE = pageJson as any;
// Re-pinned for the payment change (spec 2026-11-23, section 5.3).
// Re-pinned for spec 2026-11-23, section 5.8: paid together with the balance (no payment method named).
const CAMERA_NOTE = 'Refundable, and not part of your total. Paid together with your balance, on your wedding day. I return it within 7 days after your wedding, when the camera comes back working and undamaged.';
// The e-transfer address every new booking freezes (spec 2026-11-23, section 5.2).
const NEW_ETRANSFER = 'kashklicks.ca@gmail.com';

// The page words of spec 3.4, typed out here so page.json cannot drift from them unseen.
const LEDE = [
  'Everything we agreed, in plain words.',
  'Seven short parts. Most parts start with the main points, and the full wording is one tap away. The full wording is the agreement, so please read it before you sign. You sign at the end.',
];
const EXTRAS_INTRO = 'These are added only if you tick them. Your total updates right away.';
const SHARING = {
  legend: 'May I share some of your photos?',
  points: [
    'Sharing means I may show a selection of your photos and film, with your first names, on my website, my social media and my Google business profile, in printed samples, in submissions to publications and competitions, and in paid ads.',
    'I do not share your last name, your contact details or your home address, and I do not tag you without asking.',
    // Clause 15.9.
    'You can change your mind at any time. Tell me in writing. Within 30 days I take your work off my website and my social media pages, and I stop using it in new posts and ads.',
    'I cannot take back printed material, or copies that other people have already saved or published.',
  ],
};
// Clauses 6.2 to 6.6: the same for both packages.
const COSTS_AT_PLACE =
  'Costs at the places of your day: my parking at every location and any entry fee or ferry ticket at a place you choose (all at cost), a permit or written permission if a place needs one (you arrange it and pay for it), and travel outside the GTA ($0.75 per km). For travel far away or outside Canada I send you a written quote first. Flights, nights away and transport are then charged at cost.';
// Part 7, the same for both packages.
const PART_7 = [
  'One of you signs for both of you. By signing, you confirm that your partner has read this agreement and agrees to it.',
  'By signing, you confirm that you are 18 or older.',
  'A change to this agreement needs both of us, in writing. Email or WhatsApp is enough.',
  'You get a PDF copy by email right after you sign.',
];
// Clause 13.2: "Ask me in writing and pay within 30 days of your final delivery."
const RAW_TICKABLE = 'RAW files are not part of the package. You can add them in part 4, or ask me in writing and pay within 30 days of your final delivery.';
const RAW_OLD = 'RAW files are not part of the package. You can add them in part 4, or ask me in writing within 30 days of your final delivery.';

const content = (f: BookingFacts): PageContent => {
  const c = pageContent(f);
  if (!c) throw new Error('no page content');
  return c;
};
const pointsOf = (c: PageContent, n: number) => c.parts.find((p) => p.n === n)!.points;
const strings = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.flatMap(strings) : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
const cents = (amount: string) => Math.round(Number(amount.replace(/[$,]/g, '')) * 100);
const withChange = (change: () => () => void, fn: () => void) => {
  const undo = change();
  try {
    fn();
  } finally {
    undo();
  }
};
/** Adds a probe line with a condition to part 7 of a package's page text, for the length of fn. */
const withProbe = (pkgId: string, when: string, fn: () => void) =>
  withChange(
    () => {
      const lines = PAGE.packages[pkgId].points['7'];
      lines.push({ text: `Probe ${when}.`, when });
      return () => {
        lines.pop();
      };
    },
    fn,
  );
const probed = (f: BookingFacts, when: string) => {
  let shown = false;
  withProbe(f.package_id, when, () => {
    shown = pointsOf(content(f), 7).includes(`Probe ${when}.`);
  });
  return shown;
};

// ------------------------------------------------------------------ parts

test('the seven parts hold every section of the agreement exactly once', () => {
  const file = clausesJson as unknown as ClauseFile;
  const all = PARTS.flatMap((p) => [...p.sections]);
  expect([...all].sort((a, b) => a - b)).toEqual(file.sections.map((s) => s.num));
  expect(new Set(all).size).toBe(all.length);
  expect(PARTS.map((p) => p.n)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(PARTS.map((p) => p.title)).toEqual([
    'Your day',
    'What you get',
    'Price and payments',
    'Extras you can add',
    'Your photos and sharing',
    'If plans change',
    'The legal basics',
  ]);
  // The page content carries the same 7 parts, in order, for every package.
  for (const make of Object.values(SAMPLES)) {
    const c = content(make());
    expect(c.parts.map((p) => ({ n: p.n, title: p.title, sections: p.sections }))).toEqual(PARTS.map((p) => ({ n: p.n, title: p.title, sections: [...p.sections] })));
  }
});

// ------------------------------------------------------------------ page content

test('page content of a wedding with three tick boxes', () => {
  const c = content(SAMPLES['wedding, three tick boxes']());
  expect(c.v).toBe(1);
  expect(c.title).toBe('Your wedding agreement');
  expect(c.lede).toEqual(LEDE);
  expect(c.note).toBe('The main points help you read. The full wording is what we both agree to.');
  expect(c.glance).toEqual([
    { label: 'Date', value: 'Saturday 29 May 2027' },
    { label: 'Coverage', value: '10 hours, 12:00 pm to 10:00 pm' },
    { label: 'Photographers', value: `${B.whoShoots}, and a second photographer for all 10 hours` },
  ]);
  expect(pointsOf(c, 1)).toEqual([
    'Saturday 29 May 2027. 10 hours in one block, from 12:00 pm to 10:00 pm.',
    'Where: St. Example Church, Hamilton. Reception in Burlington.',
    'I photograph your day myself. A second photographer is with me for all 10 hours.',
    'Please send me your final timeline, your addresses and your family photo list at least 14 days before.',
    'If the day runs late and I am able to stay, overtime is $301.25 an hour, billed in 30 minute blocks of $150.75. It starts only after a yes from you or your contact person.',
    `This agreement is between you, Elena Marchetti, and me, ${B.legalName}, operating as ${B.tradeNames[0]} and ${B.tradeNames[1]}. You sign for Daniel Okafor too. My phone is ${B.phone} and my email is ${B.email}.`,
  ]);
  expect(pointsOf(c, 2)).toEqual([
    'At least 400 edited photos in a private online gallery.',
    'A short preview within 24 hours of your wedding.',
    'Your edited photos by Sunday 29 August 2027, which is within 3 months of your wedding.',
    'Your gallery stays online for 90 days. Please download your photos and keep your own backup.',
    'An engagement session: 2 hours, with photos and a short film. Please use it at least 30 days before your wedding.',
    'I bring backup cameras. My main cameras save every photo to two memory cards at the same time.',
  ]);
  // Re-pinned for the payment change (spec 2026-11-23, section 5.4): the retainer by e-transfer, the balance
  // in cash on the wedding day (clauses 3.6, 3.9 and 3.17), and the unpaid balance line (clause 3.11; 3.12 is gone).
  expect(pointsOf(c, 3)).toEqual([
    `You pay the retainer by e-transfer to ${NEW_ETRANSFER}. You pay the balance in cash on your wedding day, not by e-transfer.`,
    'The retainer is not refunded if you cancel, except in the cases part 6 lists.',
    // Clause 3.11 (ALL).
    'If the balance is not paid before I start shooting, I do not have to shoot. That counts as a cancellation by you on the day.',
    'If you choose to keep your photos private in part 5, a marketing fee of $75.00 is added to your total.',
    // Clauses 5.17, 11.6 and 3.15.
    'Costs that can come on top, only if they happen: overtime ($301.25 an hour), a second change of date ($500.00), and any extra you add later.',
    COSTS_AT_PLACE,
    'All prices are in Canadian dollars.',
  ]);
  expect(pointsOf(c, 4)).toEqual([]);
  expect(pointsOf(c, 5)).toEqual([
    'Once you have paid in full, you can print your photos, share them with family and friends, and post them on your personal social media. I keep the copyright.',
    'A business needs my written permission to use them. Examples are your venue or a magazine. Please send them to me.',
    RAW_TICKABLE,
  ]);
  expect(pointsOf(c, 5)).toContain(RAW_TICKABLE);
  expect(pointsOf(c, 5)).not.toContain(RAW_OLD);
  expect(pointsOf(c, 5)).not.toContain('RAW files are in your booking. They are in your total in part 3.');
  expect(pointsOf(c, 6)).toEqual([
    'You can move your date once at no cost, if I am free on the new date and it is within 12 months of your original date. A second change costs $500.00.',
    'If you cancel for a covered reason, such as serious illness or the wedding being called off, I refund a share of what you have paid. More than 180 days before your wedding: 80%. 90 to 180 days: 60%. 60 to 89 days: 40%. 30 to 59 days: 20%. Fewer than 30 days: no refund is owed. The full list of covered reasons is in section 16.',
    'If you cancel for any other reason, the retainer is not refunded. I refund a share of what you paid beyond the retainer, using the same list.',
    'If your engagement session has already been photographed, its value of $551.25 is taken off what you paid before I work out a refund.',
    'If I cannot come, I first try to send a photographer I trust, at the same price. You can say no. If that does not work, I refund everything you paid.',
    "If I cannot deliver any of your photos because of a problem on my side, I refund everything you paid. If only a part is lost, I refund a fair share. My responsibility is limited to the amount you have paid me. The rights that Ontario's Consumer Protection Act gives you stay in place.",
    'Your wedding goes ahead in any weather. If it rains, I use covered and indoor spots. Weather is not a reason for a refund.',
    'If we disagree, we first try to solve it together. The law of Ontario applies.',
  ]);
  expect(pointsOf(c, 6)).toContain(
    'If your engagement session has already been photographed, its value of $551.25 is taken off what you paid before I work out a refund.',
  );
  expect(pointsOf(c, 7)).toEqual(PART_7);
  expect(c.extras).toEqual({
    intro: EXTRAS_INTRO,
    booked_title: 'Already in your total',
    booked: ['Second photographer, extra hours, 7 × $101.25 = $708.75'],
    ticks: [
      { id: 'raw-photos-wedding', kind: 'price', label: 'RAW photos', price: '$121.25', blurb: 'The files straight from my cameras, before any editing.' },
      { id: 'instax-guest-prints', kind: 'price', label: 'Instax guest prints', price: '$60.00', blurb: '50 instant prints, made on your wedding day.' },
      {
        id: 'guest-camera',
        kind: 'deposit',
        label: 'Guest camera',
        price: '$100.00 refundable deposit',
        // Re-pinned for the payment change (spec 2026-11-23, section 5.4).
        // Re-pinned for spec 2026-11-23, section 5.8: paid together with the balance (no payment method named).
        blurb:
          'A small Sony camera that one of your guests carries for the day. There is no fee, only a deposit that is not part of your total. You pay it together with your balance, on your wedding day. I return it within 7 days after your wedding, when the camera comes back working and undamaged.',
      },
    ],
    more_title: 'More extras. Ask me in writing before the wedding.',
    more: [
      'Additional hours, $301.25 per hour',
      'Drone and aerial frames, $76.25',
      'Priority delivery, $501.25, your full gallery within 3 weeks of your wedding',
      'A wedding film, quoted for your wedding',
    ],
  });
  expect(c.sharing).toEqual(SHARING);
});

test('page content of a civil ceremony', () => {
  const c = content(SAMPLES['civil, usual retainer']());
  expect(c.title).toBe('Your agreement');
  expect(c.lede).toEqual(LEDE);
  expect(c.glance).toEqual([
    { label: 'Date', value: 'Saturday 12 December 2026' },
    { label: 'Coverage', value: '2 hours, 12:00 pm to 2:00 pm' },
    { label: 'Photographer', value: B.whoShoots },
  ]);
  expect(pointsOf(c, 1)).toEqual([
    'Saturday 12 December 2026. 2 hours in one block, from 12:00 pm to 2:00 pm.',
    'Where: Vaughan City Hall, 2141 Major Mackenzie Dr W, Vaughan, ON L6A 1T1.',
    'I photograph your ceremony myself.',
    'Also agreed: Family group photos after the ceremony, inside your 2 hours.',
    'Please send me your final timeline, your addresses and your family photo list at least 14 days before.',
    'If the day runs late and I am able to stay, overtime is $201.25 an hour, billed in 30 minute blocks of $100.75. It starts only if you say yes.',
    `This agreement is between you, Priya Sharma, and me, ${B.legalName}, operating as ${B.tradeNames[0]} and ${B.tradeNames[1]}. You sign for Arjun Mehta too. My phone is ${B.phone} and my email is ${B.email}.`,
  ]);
  expect(pointsOf(c, 2)).toEqual([
    'The ceremony, and couple portraits near the venue.',
    'At least 150 edited photos in a private online gallery.',
    'Your edited photos by Saturday 9 January 2027, which is within 4 weeks of your ceremony.',
    'Your gallery stays online for 90 days. Please download your photos and keep your own backup.',
    'I bring backup cameras. My main cameras save every photo to two memory cards at the same time.',
  ]);
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.4): cash only by default, so the bal:cash line shows.
  // Re-pinned for spec 2026-11-23, section 5.8: the civil bal:cash point no longer says 'on the day'.
  expect(pointsOf(c, 3)).toEqual([
    `You pay the retainer by e-transfer to ${NEW_ETRANSFER}. You pay the balance in cash, not by e-transfer.`,
    'The retainer is not refunded if you cancel, except in the cases part 6 lists.',
    'If the balance is not paid before I start shooting, I do not have to shoot. That counts as a cancellation by you on the day.',
    // Clauses 5.17, 11.2 and 3.15.
    'Costs that can come on top, only if they happen: overtime ($201.25 an hour), a change of date fee in some cases ($151.25), and any extra you add later.',
    COSTS_AT_PLACE,
    'All prices are in Canadian dollars.',
  ]);
  expect(pointsOf(c, 5)).toEqual([
    'Once you have paid in full, you can print your photos, share them with family and friends, and post them on your personal social media. I keep the copyright.',
    'A business needs my written permission to use them. Examples are your venue or a magazine. Please send them to me.',
    RAW_TICKABLE,
  ]);
  expect(pointsOf(c, 6)).toEqual([
    'You get one free change of date, to any open date on my calendar, if you ask in writing at least 7 days before. A change you ask for later than that costs $151.25. A second change also costs $151.25. The new date must be within 6 months of your original date.',
    'If you cancel, the retainer is not refunded. If you cancel more than 14 days before, I refund everything you paid beyond the retainer. If you cancel 14 days or less before, or you do not show up, I refund nothing.',
    'If I cannot come, I first try to send a photographer I trust, at the same price. You can say no. If that does not work, I refund everything you paid.',
    "If I cannot deliver any of your photos because of a problem on my side, I refund everything you paid. If only a part is lost, I refund a fair share. My responsibility is limited to the amount you have paid me. The rights that Ontario's Consumer Protection Act gives you stay in place.",
    'Your ceremony goes ahead in any weather. If it rains, I use covered and indoor spots. Weather is not a reason for a refund.',
    'If we disagree, we first try to solve it together. The law of Ontario applies.',
  ]);
  expect(pointsOf(c, 7)).toEqual(PART_7);
  expect(pointsOf(c, 3).some((p) => p.includes('marketing fee'))).toBe(false);
  // The late payment line was clause 3.12, which is gone (spec 2026-11-23, section 5.1): in neither package.
  expect(pointsOf(c, 3).some((p) => p.startsWith('If a payment is late'))).toBe(false);
  expect(pointsOf(content(SAMPLES['wedding, three tick boxes']()), 3).some((p) => p.startsWith('If a payment is late'))).toBe(false);
  expect(pointsOf(c, 5)).toContain(RAW_TICKABLE);
  expect(pointsOf(c, 5)).not.toContain(RAW_OLD);
  // Clause 11.1 (NONWED): "one free change of date to any open date on my calendar".
  expect(pointsOf(c, 6)[0]).toBe(
    'You get one free change of date, to any open date on my calendar, if you ask in writing at least 7 days before. A change you ask for later than that costs $151.25. A second change also costs $151.25. The new date must be within 6 months of your original date.',
  );
  expect(c.extras.intro).toBe(EXTRAS_INTRO);
  expect(c.sharing).toEqual(SHARING);
  expect(c.extras.booked).toEqual([]);
  expect(c.extras.ticks).toEqual([
    { id: 'drone', kind: 'price', label: 'Drone and aerial frames', price: '$76.25', blurb: 'Weather and airspace permitting. Refunded in full if I cannot fly.' },
    { id: 'extra-retouched', kind: 'price', label: 'Five extra retouched images', price: '$26.25 per set of five', blurb: 'One set of five, on top of the photos in your package.' },
    { id: 'raw-photos-civil', kind: 'price', label: 'RAW photos', price: '$69.25', blurb: 'The files straight from my cameras, before any editing.' },
  ]);
  expect(c.extras.more_title).toBe('More extras. Ask me in writing before your ceremony.');
  expect(c.extras.more).toEqual(['Additional hours, $201.25 per hour']);
});

test('every condition of the page text', () => {
  const base = SAMPLES['wedding, second photographer of the package only']();
  const part = SAMPLES['wedding, second photographer for part of the day, with notes']();
  const all = SAMPLES['wedding, three tick boxes']();
  const raw = SAMPLES['wedding, RAW already booked']();
  const civil = SAMPLES['civil, usual retainer']();
  const cash = SAMPLES['civil, set retainer, cash only']();
  const noNotes = SAMPLES['civil, set retainer equal to the usual share of one mix']();

  // second:all / second:base / second:part, in the glance and in part 1. Exactly one of them holds.
  expect(content(base).glance[2]).toEqual({ label: 'Photographers', value: `${B.whoShoots}, and a second photographer for 3 hours` });
  expect(pointsOf(content(base), 1)[2]).toBe(
    'I photograph your day myself. A second photographer joins for 3 hours, for the ceremony or the reception. You choose.',
  );
  expect(content(part).glance[2]).toEqual({ label: 'Photographers', value: `${B.whoShoots}, and a second photographer for 6 hours` });
  expect(pointsOf(content(part), 1)[2]).toBe('I photograph your day myself. A second photographer joins for 6 hours in one block. You choose which part of the day.');
  for (const f of [base, part, all]) expect(content(f).glance.filter((g) => g.label === 'Photographers')).toHaveLength(1);
  expect([probed(all, 'second:all'), probed(all, 'second:base'), probed(all, 'second:part')]).toEqual([true, false, false]);
  expect([probed(base, 'second:all'), probed(base, 'second:base'), probed(base, 'second:part')]).toEqual([false, true, false]);
  expect([probed(part, 'second:all'), probed(part, 'second:base'), probed(part, 'second:part')]).toEqual([false, false, true]);
  // A package without a second photographer has none of the three.
  expect([probed(civil, 'second:all'), probed(civil, 'second:base'), probed(civil, 'second:part')]).toEqual([false, false, false]);

  // notes
  expect(pointsOf(content(part), 1)).toContain('Also agreed: First look at the church garden.');
  expect(pointsOf(content(all), 1).some((p) => p.startsWith('Also agreed'))).toBe(false);
  expect(pointsOf(content(noNotes), 1).some((p) => p.startsWith('Also agreed'))).toBe(false);
  expect([probed(civil, 'notes'), probed(noNotes, 'notes')]).toEqual([true, false]);

  // bal:any / bal:cash. Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.4): cash only
  // is the default now; balance_cash: false gives bal:any, for both packages.
  const anyWay = civilFacts({ balance_cash: false });
  const weddingAnyWay = weddingFacts({ add_ons: SECOND_ONLY, balance_cash: false });
  // Re-pinned for spec 2026-11-23, section 5.8: the civil bal:cash point no longer says 'on the day'.
  expect(pointsOf(content(cash), 3)[0]).toBe(`You pay the retainer by e-transfer to ${NEW_ETRANSFER}. You pay the balance in cash, not by e-transfer.`);
  expect(pointsOf(content(cash), 3).filter((p) => p.startsWith('You pay the retainer'))).toHaveLength(1);
  expect(pointsOf(content(anyWay), 3)[0]).toBe(`You pay the retainer by e-transfer to ${NEW_ETRANSFER}. The balance can be an e-transfer or cash.`);
  expect(pointsOf(content(weddingAnyWay), 3)[0]).toBe(`You pay the retainer by e-transfer to ${NEW_ETRANSFER}. The balance can be an e-transfer or cash.`);
  for (const f of [anyWay, weddingAnyWay]) expect(pointsOf(content(f), 3).filter((p) => p.startsWith('You pay the retainer'))).toHaveLength(1);
  expect([probed(cash, 'bal:any'), probed(cash, 'bal:cash'), probed(anyWay, 'bal:any'), probed(anyWay, 'bal:cash')]).toEqual([false, true, true, false]);
  expect([probed(civil, 'bal:any'), probed(civil, 'bal:cash'), probed(all, 'bal:any'), probed(all, 'bal:cash')]).toEqual([false, true, false, true]);
  expect([probed(weddingAnyWay, 'bal:any'), probed(weddingAnyWay, 'bal:cash')]).toEqual([true, false]);

  // fee
  expect([probed(all, 'fee'), probed(civil, 'fee')]).toEqual([true, false]);

  // tickable:<id> / booked:<id>
  expect(pointsOf(content(raw), 5)).toContain('RAW files are in your booking. They are in your total in part 3.');
  expect(pointsOf(content(raw), 5).some((p) => p.startsWith('RAW files are not part of the package'))).toBe(false);
  expect(pointsOf(content(raw), 5)).not.toContain(RAW_TICKABLE);
  const civilAll = SAMPLES['civil, everything booked up front']();
  expect(pointsOf(content(civilAll), 5)).toContain('RAW files are in your booking. They are in your total in part 3.');
  expect(content(civilAll).extras.ticks).toEqual([]);
  expect(content(civilAll).extras.booked).toEqual([
    'Drone and aerial frames, 1 × $76.25 = $76.25',
    'Five extra retouched images, 2 × $26.25 = $52.50',
    'RAW photos, 1 × $69.25 = $69.25',
  ]);
  expect([probed(all, 'tickable:guest-camera'), probed(all, 'booked:guest-camera'), probed(raw, 'tickable:raw-photos-wedding'), probed(raw, 'booked:raw-photos-wedding')]).toEqual([
    true,
    false,
    false,
    true,
  ]);

  // open:<id>: that add-on was not booked when the link was made. A drone (at most 1) already booked is not offered again.
  const drone = weddingFacts({ add_ons: [...SECOND_ONLY, { id: 'drone', qty: 1 }] });
  expect(content(drone).extras.booked).toContain('Drone and aerial frames, 1 × $76.25 = $76.25');
  expect(content(drone).extras.more).toEqual([
    'Additional hours, $301.25 per hour',
    'Priority delivery, $501.25, your full gallery within 3 weeks of your wedding',
    'A wedding film, quoted for your wedding',
  ]);
  expect(content(all).extras.more).toContain('Drone and aerial frames, $76.25');
  expect([probed(all, 'open:drone'), probed(drone, 'open:drone'), probed(drone, 'open:raw-photos-wedding'), probed(raw, 'open:raw-photos-wedding')]).toEqual([
    true,
    false,
    true,
    false,
  ]);

  // An unknown condition is a data mistake.
  withProbe('wedding-full', 'sometimes', () => expect(() => pageContent(all)).toThrow('unknown condition sometimes'));
  expect(() => pageContent(all)).not.toThrow();
});

test('the place and the notes in the main points end with one full stop', () => {
  // PLACE loses a trailing full stop, since the line adds one.
  const place = weddingFacts({ add_ons: SECOND_ONLY, place: 'St. Example Church, Hamilton.' });
  expect(pointsOf(content(place), 1)[1]).toBe('Where: St. Example Church, Hamilton.');
  expect(pointsOf(content(civilFacts({ place: 'Vaughan City Hall...' })), 1)[1]).toBe('Where: Vaughan City Hall.');
  // NOTES gets a full stop when it ends without one. Section 1 keeps the note exactly as typed.
  const note = civilFacts({ notes: 'Family photos after the ceremony' });
  expect(pointsOf(content(note), 1)).toContain('Also agreed: Family photos after the ceremony.');
  expect(note.notes).toBe('Family photos after the ceremony');
  for (const typed of ['Family photos after.', 'Is the park open?', 'Bring the rings!', 'Family photos (inside your 2 hours).', 'Ask for "the garden."'])
    expect(pointsOf(content(civilFacts({ notes: typed })), 1), typed).toContain(`Also agreed: ${typed}`);
});

test('page text placeholders: an unknown name throws, and nothing may be left', () => {
  const f = SAMPLES['wedding, three tick boxes']();
  const civil = SAMPLES['civil, usual retainer']();
  const lines = () => PAGE.packages['wedding-full'].points['7'];
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof BookingError) return `${e.code}: ${e.field}`;
      throw e;
    }
    return undefined;
  };
  for (const [text, code] of [
    ['{{NOPE}}', 'unfilled_placeholder: NOPE'],
    ['Dated {{SIGN_DATE}}.', 'unfilled_placeholder: page'],
    ['{{TOTAL}}', 'unfilled_placeholder: TOTAL'], // amounts of a mix only in steps and the total line
  ]) {
    withChange(
      () => {
        lines().push({ text });
        return () => lines().pop();
      },
      () => expect(codeOf(() => pageContent(f)), text).toBe(code),
    );
  }
  // SECOND and FINAL do not exist for a package paid in two parts.
  withChange(
    () => {
      const steps = PAGE.packages['civil-ceremony'].steps;
      steps.push({ title: 'Later', amount: '{{SECOND}}', note: 'x' });
      return () => steps.pop();
    },
    () => expect(codeOf(() => mixSummary(civil, 'share', []))).toBe('unfilled_placeholder: SECOND'),
  );
  // A part number that does not exist.
  withChange(
    () => {
      PAGE.packages['wedding-full'].points['8'] = [{ text: 'x' }];
      return () => delete PAGE.packages['wedding-full'].points['8'];
    },
    () => expect(() => pageContent(f)).toThrow('no part 8'),
  );
  expect(() => pageContent(f)).not.toThrow();
});

test('no page text for a package: no page content, and the summary of today', () => {
  const f = SAMPLES['civil, usual retainer']();
  withChange(
    () => {
      const before = PAGE.packages['civil-ceremony'];
      delete PAGE.packages['civil-ceremony'];
      return () => {
        PAGE.packages['civil-ceremony'] = before;
      };
    },
    () => {
      expect(pageContent(f)).toBeNull();
      // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): 126.00 / 375.25 in cash, the new address.
      expect(mixSummary(f, 'share', [])).toEqual({
        package: 'The Civil Ceremony',
        date: 'Saturday 12 December 2026',
        total: '$501.25',
        retainer: '$126.00',
        balance: '$375.25',
        balance_how: 'in cash',
        etransfer_email: NEW_ETRANSFER,
      });
      expect(mixSummary(f, 'share', ['drone'])).toMatchObject({ total: '$577.50', retainer: '$145.00', balance: '$432.50' });
      expect(mixSummary(f, 'share', ['drone'])).not.toHaveProperty('price_lines');
    },
  );
  expect(pageContent(f)).not.toBeNull();
});

// ------------------------------------------------------------------ the summary of a mix

test('mixSummary: today\'s fields keep their wording, the new ones show the mix', () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3, 5.4 and 5.5): two steps, the retainer by
  // e-transfer and the balance in cash on the wedding day; no later payments; the new address.
  const w = SAMPLES['wedding, three tick boxes']();
  const share = mixSummary(w, 'share', []);
  expect(laterPaymentRows(w)).toBeNull();
  expect(share).toEqual({
    package: 'The Full Day',
    date: 'Saturday 29 May 2027',
    total: '$3,010.00',
    retainer: '$753.00',
    balance: '$2,257.00',
    balance_how: 'in cash',
    etransfer_email: NEW_ETRANSFER,
    total_line: 'Your total is $3,010.00. It stays the same even if my website prices change later.',
    price_lines: [
      { label: 'The Full Day', amount: '$2,301.25' },
      { label: 'Second photographer, extra hours, 7 × $101.25', amount: '$708.75' },
    ],
    steps: [
      { title: 'When you sign', amount: '$753.00', note: 'By e-transfer. Your date is held once this arrives.' },
      { title: 'On your wedding day', amount: '$2,257.00', note: 'In cash, before I start shooting.' },
    ],
  });
  expect(share).not.toHaveProperty('later_payments');
  // balance_cash: false: the other wedding step.
  expect(mixSummary(weddingFacts({ add_ons: SECOND_ONLY, balance_cash: false }), 'share', []).steps).toEqual([
    { title: 'When you sign', amount: '$753.00', note: 'By e-transfer. Your date is held once this arrives.' },
    { title: 'On your wedding day', amount: '$2,257.00', note: 'By e-transfer or in cash, before I start shooting.' },
  ]);

  const p = mixSummary(w, 'private', ['guest-camera', 'raw-photos-wedding']);
  expect([p.total, p.retainer, p.balance]).toEqual(['$3,206.25', '$802.00', '$2,404.25']);
  expect(p).not.toHaveProperty('later_payments');
  expect(p.price_lines).toEqual([
    { label: 'The Full Day', amount: '$2,301.25' },
    { label: 'Second photographer, extra hours, 7 × $101.25', amount: '$708.75' },
    { label: 'RAW photos', amount: '$121.25' },
    { label: 'Marketing fee for private work', amount: '$75.00' },
  ]);
  expect(p.steps!.map((s) => s.amount)).toEqual(['$802.00', '$2,404.25']);
  expect(p.deposit).toEqual({ label: 'Guest camera deposit', amount: '$100.00', note: CAMERA_NOTE });
  // Labels are extra_labels; the name `extras` always means ids.
  expect(p.extra_labels).toEqual(['RAW photos', 'Guest camera']);
  expect(p).not.toHaveProperty('extras');
  expect(p.total_line).toBe('Your total is $3,206.25. It stays the same even if my website prices change later.');
  // Nothing ticked: no deposit and no extra_labels key.
  expect(share).not.toHaveProperty('deposit');
  expect(share).not.toHaveProperty('extra_labels');

  // Re-pinned (spec 2026-11-23, section 5.3): 25% of 527.50, and cash only by default.
  const civil = mixSummary(SAMPLES['civil, usual retainer'](), 'share', ['extra-retouched']);
  expect(civil.steps).toEqual([
    { title: 'When you sign', amount: '$132.00', note: 'By e-transfer. Your date is held once this arrives.' },
    { title: 'On or before your ceremony day', amount: '$395.50', note: 'In cash, before I start shooting.' },
  ]);
  expect(mixSummary(civilFacts({ balance_cash: false }), 'share', ['extra-retouched']).steps![1]).toEqual({
    title: 'On or before your ceremony day',
    amount: '$395.50',
    note: 'By e-transfer or in cash, before I start shooting.',
  });
  expect(civil).not.toHaveProperty('later_payments');
  const cash = mixSummary(SAMPLES['civil, set retainer, cash only'](), 'private', ['drone']);
  expect(cash.steps).toEqual([
    { title: 'When you sign', amount: '$51.25', note: 'By e-transfer. Your date is held once this arrives.' },
    { title: 'On or before your ceremony day', amount: '$526.25', note: 'In cash, before I start shooting.' },
  ]);
  expect(cash.balance_how).toBe('in cash');
  expect(cash.price_lines).toEqual([
    { label: 'The Civil Ceremony', amount: '$501.25' },
    { label: 'Drone and aerial frames', amount: '$76.25' },
  ]);
  const booked = mixSummary(SAMPLES['civil, everything booked up front'](), 'share', []);
  expect(booked.price_lines![2]).toEqual({ label: 'Five extra retouched images, 2 × $26.25', amount: '$52.50' });
});

test('the numbers of the payment change, and the frozen e-transfer address (spec 2026-11-23, sections 5.3 and 5.5)', () => {
  const amounts = (s: ReturnType<typeof mixSummary>) => [s.total, s.retainer, s.balance, s.balance_how, ...s.steps!.map((x) => x.amount)];
  // The wedding ($3,010.00): share 753.00 / 2,257.00 cash; private 3,085.00: 772.00 / 2,313.00;
  // private + RAW + Instax + guest camera 3,266.25: 817.00 / 2,449.25, plus the $100.00 deposit outside the total.
  const w = SAMPLES['wedding, three tick boxes']();
  expect(amounts(mixSummary(w, 'share', []))).toEqual(['$3,010.00', '$753.00', '$2,257.00', 'in cash', '$753.00', '$2,257.00']);
  expect(amounts(mixSummary(w, 'private', []))).toEqual(['$3,085.00', '$772.00', '$2,313.00', 'in cash', '$772.00', '$2,313.00']);
  const all = mixSummary(w, 'private', ['raw-photos-wedding', 'instax-guest-prints', 'guest-camera']);
  expect(amounts(all)).toEqual(['$3,266.25', '$817.00', '$2,449.25', 'in cash', '$817.00', '$2,449.25']);
  expect(all.deposit).toEqual({ label: 'Guest camera deposit', amount: '$100.00', note: CAMERA_NOTE });
  // The Civil Ceremony at the site price ($551.25): 138.00 / 413.25 cash; private with every extra 723.00: 181.00 / 542.00.
  const site = civilFacts({ price: undefined });
  expect(amounts(mixSummary(site, 'share', []))).toEqual(['$551.25', '$138.00', '$413.25', 'in cash', '$138.00', '$413.25']);
  expect(amounts(mixSummary(site, 'private', ['drone', 'extra-retouched', 'raw-photos-civil']))).toEqual(['$723.00', '$181.00', '$542.00', 'in cash', '$181.00', '$542.00']);
  // The pilot ($501.25): 126.00 / 375.25.
  expect(amounts(mixSummary(civilFacts(), 'share', []))).toEqual(['$501.25', '$126.00', '$375.25', 'in cash', '$126.00', '$375.25']);
  // The e-transfer address is the one frozen with the booking, never today's setting: in the summary and in part 3.
  for (const f of [w, site]) {
    expect(f.etransfer_email).toBe(NEW_ETRANSFER);
    const changed = { ...f, etransfer_email: 'frozen@example.com' };
    expect(mixSummary(changed, 'share', []).etransfer_email).toBe('frozen@example.com');
    expect(pointsOf(content(changed), 3)[0]).toContain('frozen@example.com');
    // Facts without one (made before 2026-11-23) read as the old address.
    const { etransfer_email: _e, ...old } = f;
    expect(mixSummary(old as BookingFacts, 'share', []).etransfer_email).toBe('info@kashklicks.ca');
  }
  expect(B.etransferEmail).toBe(NEW_ETRANSFER);
});

test('mixSummary: price lines add up to the total and steps carry the amounts of every mix', () => {
  for (const [name, make] of Object.entries(SAMPLES)) {
    const booked = make();
    for (const m of mixesOf(booked)) {
      const f = factsFor(booked, m.choice, m.extras);
      const s = mixSummary(booked, m.choice, m.extras);
      const label = `${name} ${m.id}`;
      expect(s.price_lines!.reduce((sum, l) => sum + cents(l.amount), 0), label).toBe(cents(s.total));
      expect(cents(s.total), label).toBe(Math.round(f.total * 100));
      const amounts = f.second_payment === undefined ? [f.retainer, f.balance] : [f.retainer, f.second_payment, f.final_payment!];
      expect(s.steps!.map((x) => cents(x.amount)), label).toEqual(amounts.map((a) => Math.round(a * 100)));
      expect(s.total_line, label).toContain(s.total);
      expect(s.extra_labels ?? [], label).toEqual(m.extras.map((id) => booked.tick_boxes!.find((t) => t.id === id)!.label));
      expect(Boolean(s.deposit), label).toBe(m.extras.includes('guest-camera'));
    }
  }
});

test('mixSummaries: every mix of a booking in one call, exactly mixSummary of each', () => {
  // The link is made with this one call (the per-booking wording is worked out once, inside the call).
  for (const [name, make] of Object.entries(SAMPLES)) {
    const booked = make();
    const mixes = mixesOf(booked);
    expect(mixSummaries(booked, mixes), name).toEqual(mixes.map((m) => mixSummary(booked, m.choice, m.extras)));
  }
  const civil = SAMPLES['civil, usual retainer']();
  expect(mixSummaries(civil, [])).toEqual([]);
  expect(() => mixSummaries(civil, [{ choice: 'share', extras: [] }, { choice: 'share', extras: ['nope'] }])).toThrow('bad_extras');
  // A package without page text: today's summaries, and the package is never looked up.
  withChange(
    () => {
      const before = PAGE.packages['civil-ceremony'];
      delete PAGE.packages['civil-ceremony'];
      return () => {
        PAGE.packages['civil-ceremony'] = before;
      };
    },
    () => {
      const retired = { ...civil, package_id: 'retired-package' };
      expect(mixSummaries(retired, mixesOf(retired))).toEqual(mixesOf(retired).map((m) => mixSummary(retired, m.choice, m.extras)));
      expect(mixSummaries(retired, [{ choice: 'share', extras: ['drone'] }])[0]).toMatchObject({ total: '$577.50' });
    },
  );
});

test('mixSummary: more than one deposit is not built yet', () => {
  const w = SAMPLES['wedding, three tick boxes']();
  const two = {
    ...w,
    tick_boxes: [...w.tick_boxes!, { id: 'second-camera', kind: 'deposit' as const, label: 'Second camera', amount: 100, deposit_label: 'Second camera deposit', deposit_note: 'n' }],
  };
  expect(() => mixSummary(two, 'share', ['guest-camera', 'second-camera'])).toThrow('more than one deposit');
});

// ------------------------------------------------------------------ guards on the page text

test('the page tick boxes are exactly the tick boxes of the facts, in their order', () => {
  // The page builds mix ids from this list, so it must be facts.tick_boxes, entry for entry.
  for (const [name, make] of Object.entries(SAMPLES)) {
    const booked = make();
    const ticks = content(booked).extras.ticks;
    expect(ticks.map(({ id, kind, label }) => ({ id, kind, label })), name).toEqual(
      (booked.tick_boxes ?? []).map(({ id, kind, label }) => ({ id, kind, label })),
    );
  }
});

test('every tick box has a blurb, and every blurb names a tick box', () => {
  for (const [id, pkg] of Object.entries(agreementPackages as Record<string, any>)) {
    const ticks = (pkg.tickBoxes ?? []).map((t: { id: string }) => t.id);
    expect(Object.keys(PAGE.packages[id].extras.ticks), id).toEqual(ticks);
  }
  expect(Object.keys(PAGE.packages).sort()).toEqual(Object.keys(agreementPackages).sort());
});

test('the amounts typed in the "Costs ..." main points of part 3 are the ones of section 1', () => {
  for (const [id, page] of Object.entries(PAGE.packages as Record<string, any>)) {
    const laterCosts: string = (agreementPackages as Record<string, any>)[id].laterCosts;
    const lines = (page.points['3'] as { text: string }[]).filter((l) => l.text.startsWith('Costs '));
    // "Costs that can come on top" and "Costs at the places of your day".
    expect(lines.map((l) => l.text.split(':')[0]), id).toEqual(['Costs that can come on top, only if they happen', 'Costs at the places of your day']);
    for (const line of lines) {
      const typed = line.text.match(/\$[\d,]+\.\d{2}/g) ?? [];
      expect(typed.length, `${id} ${line.text}`).toBeGreaterThan(0);
      for (const amount of typed) expect(laterCosts, `${id} ${amount}`).toContain(amount);
    }
  }
  // No "Costs ..." main point outside part 3.
  for (const [id, page] of Object.entries(PAGE.packages as Record<string, any>))
    for (const [n, lines] of Object.entries(page.points as Record<string, { text: string }[]>))
      if (n !== '3') expect(lines.filter((l) => l.text.startsWith('Costs ')), `${id} part ${n}`).toEqual([]);
});

test('the photo count main points are the deliverables of the package', () => {
  const pkgs = agreementPackages as Record<string, any>;
  const texts = (id: string) => Object.values(PAGE.packages[id].points as Record<string, { text: string }[]>).flat().map((l) => l.text);
  expect(texts('wedding-full')).toContain('At least 400 edited photos in a private online gallery.');
  expect(pkgs['wedding-full'].deliverables.map((d: string) => `${d}.`)).toContain('At least 400 edited photos in a private online gallery.');
  expect(texts('civil-ceremony')).toContain('At least 150 edited photos in a private online gallery.');
  expect(pkgs['civil-ceremony'].deliverables.map((d: string) => `${d}.`)).toContain('At least 150 edited photos in a private online gallery.');
});

test('no placeholder, no en dash and no em dash in anything the page content shows', () => {
  for (const [name, make] of Object.entries(SAMPLES)) {
    const booked = make();
    const shown = [...strings(content(booked)), ...mixesOf(booked).flatMap((m) => strings(mixSummary(booked, m.choice, m.extras)))];
    expect(shown.length, name).toBeGreaterThan(50);
    const bad = shown.filter((s) => s.includes('{{') || s.includes('}}') || /[–—]/.test(s));
    expect(bad, name).toEqual([]);
  }
  const raw = JSON.stringify(PAGE);
  expect(/[–—]/.test(raw)).toBe(false);
});

test('the main points of a part are never empty, except part 4 (the tick boxes)', () => {
  for (const [name, make] of Object.entries(SAMPLES)) {
    const c = content(make());
    for (const part of c.parts) {
      if (part.n === 4) expect(part.points, name).toEqual([]);
      else expect(part.points.length, `${name} part ${part.n}`).toBeGreaterThan(0);
    }
  }
});
