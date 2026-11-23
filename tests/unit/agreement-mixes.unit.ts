import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import clausesJson from '../../src/data/agreement/clauses.json' with { type: 'json' };
import agreementPackages from '../../src/data/agreement/packages.json' with { type: 'json' };
import siteAddOns from '../../src/data/add-ons.json' with { type: 'json' };
import {
  SIGN_DATE_TOKEN,
  BookingError,
  buildBookingFacts,
  buildVariantSet,
  docFragments,
  factsFor,
  mixesOf,
  renderVariant,
} from '../../src/lib/agreement/render';
import { docJsonFromSet, mixId } from '../../src/lib/agreement/set';
import type { AgreementDoc, BookingFacts, Choice, ClauseFile, SourceClause } from '../../src/lib/agreement/types';
import { unpack } from './fixtures/old-bookings-runner';
import oldBookings from './fixtures/old-bookings.json' with { type: 'json' };

// Bookings stored before the payment change of 2026-11-23, as the code of that time made them.
const oldRecord = (name: string) => unpack((oldBookings as any).records[name], oldBookings as any, { strings: true }) as any;

// Tick boxes at signing ("extras"), the mixes they make, and the set of finished documents of a booking.
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

// The sample bookings of the spec (section 3.7, item 1).
const SAMPLES: Record<string, () => BookingFacts> = {
  'wedding, three tick boxes': () => weddingFacts({ add_ons: SECOND_ONLY }),
  'wedding, RAW already booked': () => weddingFacts(),
  'civil, usual retainer': () => civilFacts(),
  'civil, set retainer, cash only': () => civilFacts({ retainer: 51.25, balance_cash: true }),
  // 157 is 25% of the total with the drone ticked (551.25 + 76.25 = 627.50, rounded up), by coincidence.
  // Re-pinned for the payment change (spec 2026-11-23, section 5.6): the usual share is 25% now (was 314, half).
  'civil, set retainer equal to the usual share of one mix': () => civilFacts({ price: 551.25, retainer: 157 }),
};

const RAW = 'raw-photos-wedding';
const INSTAX = 'instax-guest-prints';
const CAMERA = 'guest-camera';
// Re-pinned for the payment change (spec 2026-11-23, section 5.3): paid with the balance.
// Re-pinned for spec 2026-11-23, section 5.8: paid together with the balance (no payment method named).
const CAMERA_NOTE = 'Refundable, and not part of your total. Paid together with your balance, on your wedding day. I return it within 7 days after your wedding, when the camera comes back working and undamaged.';

const codeOf = (fn: () => unknown): { code: string; field?: string } | undefined => {
  try {
    fn();
  } catch (e) {
    if (e instanceof BookingError) return { code: e.code, field: e.field };
    throw e;
  }
  return undefined;
};
const BAD_EXTRAS = { code: 'bad_extras', field: 'extras' };

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const tokens = (s: string) => s.split(SIGN_DATE_TOKEN).length - 1;
const cents = (n: number) => Math.round(n * 100);
const bookingRows = (doc: AgreementDoc) => {
  for (const s of doc.sections) for (const i of s.items) if (i.type === 'table' && i.kind === 'booking') return i.rows;
  throw new Error('no booking table');
};
const clauseText = (doc: AgreementDoc, n: string) => {
  for (const s of doc.sections) for (const i of s.items) if (i.type === 'clause' && i.n === n) return i.text;
  throw new Error(`no clause ${n}`);
};
const pkgOf = (id: string) => (agreementPackages as Record<string, any>)[id];
// The engine reads the same data objects the tests import, so a test can bend them briefly to reach the guards.
const withChange = (change: () => () => void, fn: () => void) => {
  const undo = change();
  try {
    fn();
  } finally {
    undo();
  }
};

// ------------------------------------------------------------------ package data

test('tick boxes: at most three per package, in display order', () => {
  expect(pkgOf('wedding-full').tickBoxes.map((t: { id: string }) => t.id)).toEqual([RAW, INSTAX, CAMERA]);
  expect(pkgOf('civil-ceremony').tickBoxes.map((t: { id: string }) => t.id)).toEqual(['drone', 'extra-retouched', 'raw-photos-civil']);
  expect(pkgOf('wedding-full').tickBoxes[2].deposit).toEqual({
    rowLabel: 'Guest camera deposit',
    // Re-pinned for the payment change (spec 2026-11-23, section 5.3).
    // Re-pinned for spec 2026-11-23, section 5.8: paid together with the balance (no payment method named).
    row: '{{PRICE}}, refundable. It is not part of your total. You pay it together with your balance, on your wedding day. I return it in full within 7 days after your wedding, when the camera comes back working and undamaged.',
    note: CAMERA_NOTE,
  });
});

test('a tick box that breaks a rule is a data mistake and throws', () => {
  const wed = () => pkgOf('wedding-full');
  const civ = () => pkgOf('civil-ceremony');
  const swapTicks = (pkg: () => any, ticks: unknown[]) => () => {
    const before = pkg().tickBoxes;
    pkg().tickBoxes = ticks;
    return () => {
      pkg().tickBoxes = before;
    };
  };
  const cases: [() => any, unknown[], string][] = [
    [civ, [{ id: 'drone' }, { id: 'extra-retouched' }, { id: 'raw-photos-civil' }, { id: 'extra-hours-civil' }], 'at most 3 tick boxes'],
    [civ, [{ id: 'drone' }, { id: 'drone' }], 'tick box drone twice'],
    [civ, [{ id: 'no-such-add-on' }], 'tick box no-such-add-on: needs exactly one add-on row'],
    // The full message: these ids also have a twin Overtime row, so "needs exactly one add-on row" would match a shorter text.
    [civ, [{ id: 'extra-hours-civil' }], 'tick box extra-hours-civil: hours cannot be a tick box'],
    [wed, [{ id: 'extra-hours-wedding' }], 'tick box extra-hours-wedding: hours cannot be a tick box'],
    [wed, [{ id: 'second-photographer' }], 'tick box second-photographer: hours cannot be a tick box'],
    // An id goes into mix ids (joined by +) and the PDF query (split on commas).
    [civ, [{ id: 'Drone' }], 'tick box Drone: an id may use only a to z, 0 to 9 and hyphens'],
    [civ, [{ id: 'drone,raw' }], 'tick box drone,raw: an id may use only a to z, 0 to 9 and hyphens'],
    [civ, [{ id: 7 }], 'a tick box needs an id'],
    [wed, [{ id: 'priority-delivery-wedding' }], 'tick box priority-delivery-wedding: a priced tick box needs a bookable row'],
    [wed, [{ id: 'drone', deposit: { rowLabel: 'Drone deposit', row: '{{PRICE}}', note: 'n' } }], 'tick box drone: a deposit needs a row that is not bookable'],
    // Re-pinned (spec 2026-11-23, section 5.3): there is no final payment any more, so PRICE is the only name.
    [wed, [{ id: 'guest-camera', deposit: { rowLabel: 'Guest camera deposit', row: '{{PRICE}} by {{EVENT_DATE}}', note: 'n' } }], 'tick box guest-camera: the deposit row may use PRICE only'],
    [wed, [{ id: 'guest-camera', deposit: { rowLabel: 'Guest camera deposit', row: '{{PRICE}} by {{FINAL_DUE}}', note: 'n' } }], 'tick box guest-camera: the deposit row may use PRICE only'],
    [wed, [{ id: 'guest-camera' }], 'tick box guest-camera: a priced tick box needs a bookable row'],
  ];
  for (const [pkg, ticks, message] of cases) {
    withChange(swapTicks(pkg, ticks), () => {
      const make = pkg === wed ? () => weddingFacts({ add_ons: SECOND_ONLY }) : () => civilFacts();
      expect(make, message).toThrow(message);
    });
  }
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): every package is paid in two parts, so
  // a deposit no longer needs three payments; its row still may not name a date of a final payment.
  for (const [row, outcome] of [
    ['{{PRICE}}, due by {{FINAL_DUE}}.', 'tick box civil-camera: the deposit row may use PRICE only'],
    ['{{PRICE}}, refundable.', null],
  ] as const)
    withChange(
      () => {
        const rows = civ().addOnRows;
        rows.push({ id: 'civil-camera', label: 'Guest camera', price: 100, priceText: '{{PRICE}} refundable deposit', note: 'n', bookable: false });
        const before = civ().tickBoxes;
        civ().tickBoxes = [{ id: 'civil-camera', deposit: { rowLabel: 'Deposit', row, note: 'n' } }];
        return () => {
          rows.pop();
          civ().tickBoxes = before;
        };
      },
      () => {
        if (outcome) return expect(() => civilFacts(), row).toThrow(outcome);
        // A package paid in two parts can have one: its row comes right after the balance row, outside the total.
        const f = civilFacts();
        const rows = bookingRows(renderVariant(f, 'share', ['civil-camera']));
        const labels = rows.map((r) => r[0]);
        expect(rows[labels.indexOf('Deposit')]).toEqual(['Deposit', '$100.00, refundable.']);
        expect(labels[labels.indexOf('Deposit') - 1]).toBe('Balance, due on or before the ceremony day');
        expect(factsFor(f, 'share', ['civil-camera']).total).toBe(f.total);
      },
    );
  // An id with a "+" would make two mixes share one id, even when it names a real row.
  withChange(
    () => {
      const rows = civ().addOnRows;
      rows.push({ id: 'drone+raw-photos-civil', label: 'Odd', price: 10, priceText: '{{PRICE}}', note: 'n', bookable: true });
      const before = civ().tickBoxes;
      civ().tickBoxes = [{ id: 'drone' }, { id: 'drone+raw-photos-civil' }, { id: 'raw-photos-civil' }];
      return () => {
        rows.pop();
        civ().tickBoxes = before;
      };
    },
    () => expect(() => civilFacts()).toThrow('tick box drone+raw-photos-civil: an id may use only a to z, 0 to 9 and hyphens'),
  );
  // A price must be a whole number of cents, at least 1: a contract-only price (priced or deposit) and a site price alike.
  const rowOf = (pkg: () => any, id: string) => pkg().addOnRows.find((r: { id: string | null }) => r.id === id);
  for (const [pkg, id, price, message] of [
    [wed, INSTAX, -60, 'add-on row Instax guest prints: a contract-only price must be a whole number of cents, at least 1'],
    [wed, INSTAX, 60.005, 'add-on row Instax guest prints: a contract-only price must be a whole number of cents, at least 1'],
    [wed, CAMERA, -100, 'add-on row Guest camera: a contract-only price must be a whole number of cents, at least 1'],
    [wed, CAMERA, 0, 'add-on row Guest camera: a contract-only price must be a whole number of cents, at least 1'],
  ] as const)
    withChange(
      () => {
        const row = rowOf(pkg, id);
        const before = row.price;
        row.price = price;
        return () => {
          row.price = before;
        };
      },
      () => expect(() => weddingFacts({ add_ons: SECOND_ONLY }), `${id} ${price}`).toThrow(message),
    );
  // A site price of a tick box (add-ons.json) is checked too.
  const site = (siteAddOns as { id: string; price: number | null }[]).find((a) => a.id === 'drone')!;
  for (const price of [0.5, 76.255])
    withChange(
      () => {
        const before = site.price;
        site.price = price;
        return () => {
          site.price = before;
        };
      },
      () => expect(() => civilFacts(), String(price)).toThrow('tick box drone: its price must be a whole number of cents, at least 1'),
    );
  // Back to the real data: it works again.
  expect(() => weddingFacts({ add_ons: SECOND_ONLY })).not.toThrow();
  expect(() => civilFacts()).not.toThrow();
});

// ------------------------------------------------------------------ facts

test('booking facts list the tick boxes still open, frozen with the booking', () => {
  expect(weddingFacts({ add_ons: SECOND_ONLY }).tick_boxes).toEqual([
    { id: RAW, kind: 'price', label: 'RAW photos', amount: 121.25 },
    { id: INSTAX, kind: 'price', label: 'Instax guest prints', amount: 60 },
    { id: CAMERA, kind: 'deposit', label: 'Guest camera', amount: 100, deposit_label: 'Guest camera deposit', deposit_note: CAMERA_NOTE },
  ]);
  // A tick box whose add-on was booked when the link was made is not offered again.
  expect(weddingFacts().tick_boxes!.map((t) => t.id)).toEqual([INSTAX, CAMERA]);
  expect(civilFacts().tick_boxes).toEqual([
    { id: 'drone', kind: 'price', label: 'Drone and aerial frames', amount: 76.25 },
    { id: 'extra-retouched', kind: 'price', label: 'Five extra retouched images', amount: 26.25 },
    { id: 'raw-photos-civil', kind: 'price', label: 'RAW photos', amount: 69.25 },
  ]);
  expect(civilFacts({ add_ons: [{ id: 'extra-retouched', qty: 2 }] }).tick_boxes!.map((t) => t.id)).toEqual(['drone', 'raw-photos-civil']);
  // Nothing left to tick: the key is left out.
  const all = civilFacts({ add_ons: [{ id: 'drone', qty: 1 }, { id: 'extra-retouched', qty: 1 }, { id: 'raw-photos-civil', qty: 1 }] });
  expect(all).not.toHaveProperty('tick_boxes');
  expect(mixesOf(all).map((m) => m.id)).toEqual(['share', 'private']);
  // The facts carry the tick boxes and nothing else new.
  expect(weddingFacts()).not.toHaveProperty('extras');
  expect(weddingFacts()).not.toHaveProperty('deposits');
});

test('every mix must give sensible amounts when the link is made', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3). With three payments, price 4 and a
  // ticked extra of $1.00 gave a final payment below a dollar and was refused. With two payments every mix
  // has a retainer of at least a dollar and a balance of zero or more, so the same booking is made.
  withChange(
    () => {
      const row = pkgOf('wedding-full').addOnRows.find((r: { id: string | null }) => r.id === INSTAX);
      row.price = 1;
      return () => {
        row.price = 60;
      };
    },
    () => {
      const f = weddingFacts({ price: 4, add_ons: [] });
      expect([f.total, f.retainer, f.balance]).toEqual([4, 1, 3]);
      const m = factsFor(f, 'share', [INSTAX]);
      expect([m.total, m.retainer, m.balance]).toEqual([5, 2, 3]);
      for (const x of mixesOf(f)) {
        const g = factsFor(f, x.choice, x.extras);
        expect(g.retainer, x.id).toBeGreaterThanOrEqual(1);
        expect(g.balance, x.id).toBeGreaterThanOrEqual(0);
        expect(cents(g.retainer) + cents(g.balance), x.id).toBe(cents(g.total));
      }
    },
  );
  expect(weddingFacts({ price: 4, add_ons: [] }).total).toBe(4);
});

test('factsFor: nothing ticked behaves exactly as before', () => {
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  expect(factsFor(w, 'share')).toBe(w);
  expect(factsFor(w, 'share', [])).toBe(w);
  expect(factsFor(w, 'private', [])).toEqual(factsFor(w, 'private'));
  const c = civilFacts();
  expect(factsFor(c, 'private')).toBe(c);
  expect(factsFor(c, 'private', [])).toBe(c);
  expect(factsFor(w, 'private')).not.toHaveProperty('extras');
});

test('factsFor: ticked extras in tick box order, priced ones in the total, deposits never', () => {
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  const before = JSON.stringify(w);
  const a = factsFor(w, 'share', [CAMERA, RAW]);
  const b = factsFor(w, 'share', [RAW, CAMERA]);
  expect(a).toEqual(b);
  expect(a.extras).toEqual([RAW, CAMERA]);
  expect(a.add_ons).toEqual([
    { id: 'second-photographer', label: 'Second photographer, extra hours', qty: 7, unit_price: 101.25, line_total: 708.75 },
    { id: RAW, label: 'RAW photos', qty: 1, unit_price: 121.25, line_total: 121.25 },
  ]);
  expect(a.deposits).toEqual([{ id: CAMERA, label: 'Guest camera deposit', amount: 100, note: CAMERA_NOTE }]);
  // The same amounts as a booking made with RAW photos up front. Re-pinned for the payment change (spec
  // 2026-11-23, sections 5.3 and 5.5): a 25% retainer and the balance, no second or final payment.
  expect([a.total, a.retainer, a.second_payment, a.final_payment, a.balance]).toEqual([3131.25, 783, undefined, undefined, 2348.25]);
  expect(a).not.toHaveProperty('sharing_fee');

  const camera = factsFor(w, 'share', [CAMERA]);
  expect([camera.total, camera.retainer, camera.second_payment, camera.final_payment, camera.balance]).toEqual([3010, 753, undefined, undefined, 2257]);
  expect(camera.add_ons).toEqual(w.add_ons);
  expect(camera.extras).toEqual([CAMERA]);

  const instax = factsFor(w, 'share', [INSTAX]);
  expect(instax).not.toHaveProperty('deposits');
  expect([instax.total, instax.retainer, instax.balance]).toEqual([3070, 768, 2302]);

  const p = factsFor(w, 'private', [RAW]);
  expect(p.sharing_fee).toBe(75);
  expect([p.total, p.retainer, p.second_payment, p.final_payment, p.balance]).toEqual([3206.25, 802, undefined, undefined, 2404.25]);
  // Spec section 5.5: private + RAW + Instax + guest camera: 3,266.25 = 817.00 + 2,449.25, the deposit outside the total.
  const all = factsFor(w, 'private', [RAW, INSTAX, CAMERA]);
  expect([all.total, all.retainer, all.balance]).toEqual([3266.25, 817, 2449.25]);
  expect(all.deposits!.map((d) => d.amount)).toEqual([100]);

  // A wedding booked before the change (three payments) keeps the old rules for every mix.
  const old = oldRecord('wedding-set').facts as BookingFacts;
  const o = factsFor(old, 'private', [RAW]);
  expect([o.total, o.retainer, o.second_payment, o.final_payment, o.balance]).toEqual([3206.25, 1604, 802, 800.25, 1602.25]);
  const oc = factsFor(old, 'share', [CAMERA]);
  expect([oc.total, oc.retainer, oc.second_payment, oc.final_payment, oc.balance]).toEqual([3010, 1505, 753, 752, 1505]);

  // The booked facts are never changed.
  expect(JSON.stringify(w)).toBe(before);
});

test('factsFor: unknown, repeated or already booked extras are refused', () => {
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  for (const extras of [['nope'], [RAW, RAW], ['second-photographer'], ['drone'], [1], [null], ['']])
    expect(codeOf(() => factsFor(w, 'share', extras as string[])), JSON.stringify(extras)).toEqual(BAD_EXTRAS);
  for (const extras of ['raw-photos-wedding', null, {}, 3])
    expect(codeOf(() => factsFor(w, 'share', extras as unknown as string[])), JSON.stringify(extras)).toEqual(BAD_EXTRAS);
  // RAW photos were booked up front: they are no tick box of this booking.
  expect(codeOf(() => factsFor(weddingFacts(), 'private', [RAW]))).toEqual(BAD_EXTRAS);
  // Old facts made before tick boxes existed have none to tick.
  const old = weddingFacts({ add_ons: SECOND_ONLY });
  delete old.tick_boxes;
  expect(factsFor(old, 'share', [])).toBe(old);
  expect(codeOf(() => factsFor(old, 'share', [INSTAX]))).toEqual(BAD_EXTRAS);
});

test('factsFor: facts that already carry extras or the fee throw', () => {
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  const ticked = factsFor(w, 'share', [INSTAX]);
  expect(() => factsFor(ticked, 'share')).toThrow('already in these facts');
  expect(() => factsFor(ticked, 'private', [RAW])).toThrow('already in these facts');
  expect(() => renderVariant(ticked, 'share')).toThrow('already in these facts');
  const priv = factsFor(w, 'private');
  expect(() => factsFor(priv, 'share', [INSTAX])).toThrow('already in these facts');
  expect(() => factsFor(factsFor(w, 'private', [INSTAX]), 'share')).toThrow('already in these facts');
});

test('factsFor: a set retainer stays, the usual retainer follows the total', () => {
  const set = civilFacts({ retainer: 51.25, balance_cash: true });
  const s = factsFor(set, 'share', ['drone']);
  expect([s.total, s.retainer, s.balance]).toEqual([577.5, 51.25, 526.25]);
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): the usual retainer is 25% of the mix total (was half).
  const usual = factsFor(civilFacts(), 'private', ['drone', 'raw-photos-civil']);
  expect([usual.total, usual.retainer, usual.balance]).toEqual([646.75, 162, 484.75]);
  expect(usual).not.toHaveProperty('sharing_fee'); // civil has no fee for private work
  // Spec section 5.5: the Civil Ceremony at the site price, private with every extra: 723.00 = 181.00 + 542.00.
  const site = factsFor(civilFacts({ price: undefined }), 'private', ['drone', 'extra-retouched', 'raw-photos-civil']);
  expect([site.total, site.retainer, site.balance]).toEqual([723, 181, 542]);
  const coincidence = factsFor(civilFacts({ price: 551.25, retainer: 157 }), 'share', ['drone']);
  expect([coincidence.total, coincidence.retainer, coincidence.balance]).toEqual([627.5, 157, 470.5]);
  // A booking made before the change keeps its own percent (50): its usual retainer follows at half.
  const old = oldRecord('civil-set').facts as BookingFacts;
  const o = factsFor(old, 'private', ['drone', 'raw-photos-civil']);
  expect([o.total, o.retainer, o.balance]).toEqual([646.75, 324, 322.75]);
  // ...and its set retainer stays, even one that equals 25% of its total.
  const oldSet = oldRecord('civil-set-retainer-cash').facts as BookingFacts;
  expect(oldSet.retainer).toBe(126);
  const os = factsFor(oldSet, 'share', ['drone']);
  expect([os.total, os.retainer, os.balance]).toEqual([577.5, 126, 451.5]);
});

test('factsFor: the payments add up for every mix of every sample booking', () => {
  for (const [name, make] of Object.entries(SAMPLES)) {
    const booked = make();
    for (const m of mixesOf(booked)) {
      const f = factsFor(booked, m.choice, m.extras);
      const label = `${name} ${m.id}`;
      expect(cents(f.balance), label).toBe(cents(f.total) - cents(f.retainer));
      if (f.second_payment !== undefined)
        expect(cents(f.retainer) + cents(f.second_payment) + cents(f.final_payment!), label).toBe(cents(f.total));
      const priced = (booked.tick_boxes ?? []).filter((t) => t.kind === 'price' && m.extras.includes(t.id));
      const fee = m.choice === 'private' && booked.private_fee !== undefined ? booked.private_fee : 0;
      expect(cents(f.total), label).toBe(cents(booked.total) + priced.reduce((sum, t) => sum + cents(t.amount), 0) + cents(fee));
    }
  }
});

test('factsFor works from the stored facts only, also for a package that no longer exists', () => {
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  const retired = { ...w, package_id: 'retired-package' };
  const f = factsFor(retired, 'private', [RAW, CAMERA]);
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): two payments at the frozen 25%.
  expect([f.total, f.retainer, f.balance, f.second_payment, f.final_payment]).toEqual([3206.25, 802, 2404.25, undefined, undefined]);
  expect(() => renderVariant(retired, 'share')).toThrow();
  // No business setting either: a later change of the percent never reaches a booking.
  const old = { ...(oldRecord('wedding-set').facts as BookingFacts), package_id: 'retired-package' };
  expect([factsFor(old, 'private', [RAW, CAMERA]).total, factsFor(old, 'private', [RAW, CAMERA]).retainer]).toEqual([3206.25, 1604]);
  expect(factsFor(old, 'private', [RAW, CAMERA])).toMatchObject({ second_payment: 802, final_payment: 800.25 });
});

// ------------------------------------------------------------------ rendering a mix

test('a ticked priced extra joins the row "Add-ons chosen at booking"', () => {
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  const rows = Object.fromEntries(bookingRows(renderVariant(w, 'share', [INSTAX, RAW])));
  expect(rows['Add-ons chosen at booking']).toBe(
    'Second photographer, extra hours, 7 × $101.25 = $708.75; RAW photos, 1 × $121.25 = $121.25; Instax guest prints, 1 × $60.00 = $60.00',
  );
  expect(rows['Total']).toBe('$3,191.25');
  const civil = Object.fromEntries(bookingRows(renderVariant(civilFacts(), 'share', ['raw-photos-civil', 'drone'])));
  expect(civil['Add-ons chosen at booking']).toBe('Drone and aerial frames, 1 × $76.25 = $76.25; RAW photos, 1 × $69.25 = $69.25');
  expect(civil['Total']).toBe('$646.75');
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): 25%, cash only.
  expect(civil['Retainer, due at signing']).toBe('$162.00 by e-transfer');
  expect(civil['Balance, due on or before the ceremony day']).toBe('$484.75 in cash');
});

test('no mix is worked out two ways: a ticked extra gives the document of a booking made with it', () => {
  const pairs: [BookingFacts, string[], BookingFacts][] = [
    [weddingFacts({ add_ons: SECOND_ONLY }), [RAW], weddingFacts()],
    [weddingFacts({ add_ons: SECOND_ONLY }), [INSTAX], weddingFacts({ add_ons: [...SECOND_ONLY, { id: INSTAX, qty: 1 }] })],
    [
      weddingFacts({ add_ons: SECOND_ONLY }),
      [RAW, INSTAX],
      weddingFacts({ add_ons: [...SECOND_ONLY, { id: RAW, qty: 1 }, { id: INSTAX, qty: 1 }] }),
    ],
    [weddingFacts(), [INSTAX], weddingFacts({ add_ons: [...WEDDING.add_ons, { id: INSTAX, qty: 1 }] })],
    [civilFacts(), ['drone'], civilFacts({ add_ons: [{ id: 'drone', qty: 1 }] })],
    [
      civilFacts(),
      ['drone', 'extra-retouched', 'raw-photos-civil'],
      civilFacts({ add_ons: [{ id: 'drone', qty: 1 }, { id: 'extra-retouched', qty: 1 }, { id: 'raw-photos-civil', qty: 1 }] }),
    ],
    [
      civilFacts({ retainer: 51.25, balance_cash: true }),
      ['extra-retouched'],
      civilFacts({ retainer: 51.25, balance_cash: true, add_ons: [{ id: 'extra-retouched', qty: 1 }] }),
    ],
  ];
  for (const [booked, extras, upFront] of pairs) {
    for (const choice of ['share', 'private'] as const) {
      const mix = renderVariant(booked, choice, extras);
      const made = renderVariant(upFront, choice);
      const label = `${booked.package_id} ${choice} ${extras.join('+')}`;
      mix.sections.forEach((s, k) => expect(s, `${label} section ${s.num}`).toEqual(made.sections[k]));
      expect(JSON.stringify(mix), label).toBe(JSON.stringify(made));
      const f = factsFor(booked, choice, extras);
      const g = factsFor(upFront, choice);
      expect([f.total, f.retainer, f.balance, f.second_payment, f.final_payment], label).toEqual([g.total, g.retainer, g.balance, g.second_payment, g.final_payment]);
    }
  }
});

test('the retainer clause follows the booked facts, not the amounts of a mix', () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.1 and 5.6): the coincidence is 25% of
  // one mix's total now ($157.00, was $314.00, half), and the usual clause says 25%.
  const RET_SET = 'You pay in two parts. The retainer is $157.00 and is due when you sign.';
  const booked = SAMPLES['civil, set retainer equal to the usual share of one mix']();
  expect(booked.retainer).toBe(157);
  const seen = new Set<string>();
  for (const m of mixesOf(booked)) {
    const doc = renderVariant(booked, m.choice, m.extras);
    const text = clauseText(doc, '3.2');
    expect(text.startsWith(RET_SET), m.id).toBe(true);
    expect(JSON.stringify(doc), m.id).not.toContain('25% of your total');
    seen.add(JSON.stringify(doc.sections[3]));
  }
  // Section 3 has one version across all 16 mixes, the drone one included.
  expect(seen.size).toBe(1);
  expect(factsFor(booked, 'share', ['drone']).total).toBe(627.5);
  expect(factsFor(booked, 'share', ['drone']).retainer).toBe(157);
  // A booking with the usual retainer keeps "25%" in every mix.
  const usual = SAMPLES['civil, usual retainer']();
  for (const m of mixesOf(usual)) expect(clauseText(renderVariant(usual, m.choice, m.extras), '3.2'), m.id).toContain('25% of your total');
});

test('the guest camera deposit row: after the balance, only when ticked, amounts unchanged', () => {
  // Re-pinned for the payment change (spec 2026-11-23, section 5.3): in cash with the balance on the
  // wedding day, right after the balance row (was: by e-transfer with the final payment).
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  // Re-pinned for spec 2026-11-23, section 5.8: paid together with the balance (no payment method named).
  const ROW = [
    'Guest camera deposit',
    '$100.00, refundable. It is not part of your total. You pay it together with your balance, on your wedding day. I return it in full within 7 days after your wedding, when the camera comes back working and undamaged.',
  ];
  for (const choice of ['share', 'private'] as const) {
    const plain = bookingRows(renderVariant(w, choice));
    const ticked = bookingRows(renderVariant(w, choice, [CAMERA]));
    const labels = ticked.map((r) => r[0]);
    const at = labels.indexOf('Guest camera deposit');
    expect(ticked[at]).toEqual(ROW);
    expect(labels[at - 1]).toBe('Balance, due on your wedding day');
    expect(labels[at + 1]).toBe('Wedding date');
    // Apart from that one row, the table is the table without the camera.
    expect([...ticked.slice(0, at), ...ticked.slice(at + 1)]).toEqual(plain);
  }
  for (const m of mixesOf(w)) {
    const rows = bookingRows(renderVariant(w, m.choice, m.extras));
    expect(rows.some((r) => r[0] === 'Guest camera deposit'), m.id).toBe(m.extras.includes(CAMERA));
  }
  const both = Object.fromEntries(bookingRows(renderVariant(w, 'share', [RAW, CAMERA])));
  expect(both['Total']).toBe('$3,131.25');
  expect(both['Add-ons chosen at booking']).not.toContain('Guest camera');
});

test('stored facts must agree with the tick boxes of their package', () => {
  const w = weddingFacts({ add_ons: SECOND_ONLY });
  const strange = { ...w, tick_boxes: [...w.tick_boxes!, { id: 'drone', kind: 'price' as const, label: 'Drone and aerial frames', amount: 76.25 }] };
  expect(() => renderVariant(strange, 'share')).toThrow('booking KK-TEST-2026-007: tick box drone is not a tick box of The Full Day');
  const wrongKind = { ...w, tick_boxes: w.tick_boxes!.map((t) => (t.id === CAMERA ? { id: CAMERA, kind: 'price' as const, label: t.label, amount: t.amount } : t)) };
  expect(() => renderVariant(wrongKind, 'share')).toThrow('tick box guest-camera');
  // Facts without tick boxes (made before they existed) render as before.
  const old = { ...w };
  delete old.tick_boxes;
  expect(JSON.stringify(renderVariant(old, 'private'))).toBe(JSON.stringify(renderVariant(w, 'private')));
  // A package without tick boxes and facts that have some do not agree either.
  withChange(
    () => {
      const before = pkgOf('wedding-full').tickBoxes;
      delete pkgOf('wedding-full').tickBoxes;
      return () => {
        pkgOf('wedding-full').tickBoxes = before;
      };
    },
    () => expect(() => renderVariant(w, 'share')).toThrow('tick box raw-photos-wedding is not a tick box of The Full Day'),
  );
});

// ------------------------------------------------------------------ the set of finished documents

test('mix ids and their order', () => {
  expect(mixId('share', [])).toBe('share');
  expect(mixId('private', [RAW, CAMERA])).toBe('private+raw-photos-wedding+guest-camera');
  const subsets = ['', `+${RAW}`, `+${INSTAX}`, `+${RAW}+${INSTAX}`, `+${CAMERA}`, `+${RAW}+${CAMERA}`, `+${INSTAX}+${CAMERA}`, `+${RAW}+${INSTAX}+${CAMERA}`];
  const w = SAMPLES['wedding, three tick boxes']();
  expect(mixesOf(w).map((m) => m.id)).toEqual([...subsets.map((s) => `share${s}`), ...subsets.map((s) => `private${s}`)]);
  for (const m of mixesOf(w)) expect(m.id).toBe(mixId(m.choice, m.extras));
  expect(mixesOf(SAMPLES['wedding, RAW already booked']()).map((m) => m.id)).toEqual([
    'share',
    `share+${INSTAX}`,
    `share+${CAMERA}`,
    `share+${INSTAX}+${CAMERA}`,
    'private',
    `private+${INSTAX}`,
    `private+${CAMERA}`,
    `private+${INSTAX}+${CAMERA}`,
  ]);
  expect(mixesOf(SAMPLES['civil, usual retainer']())[3]).toEqual({ id: 'share+drone+extra-retouched', choice: 'share', extras: ['drone', 'extra-retouched'] });
});

test('mixesOf refuses tick box ids that would give two mixes one id', () => {
  // The worker stores mixes by id: two mixes with one id would silently drop a text.
  const w = SAMPLES['wedding, three tick boxes']();
  const tick = (id: string) => ({ id, kind: 'price' as const, label: id, amount: 1 });
  for (const [ids, message] of [
    [['x', 'y', 'x+y'], 'booking KK-TEST-2026-007: tick box x+y: an id may use only a to z, 0 to 9 and hyphens'],
    [['a,b'], 'booking KK-TEST-2026-007: tick box a,b: an id may use only a to z, 0 to 9 and hyphens'],
    [['x', 'x'], 'booking KK-TEST-2026-007: tick box x twice'],
  ] as const)
    expect(() => mixesOf({ ...w, tick_boxes: ids.map(tick) }), ids.join(' ')).toThrow(message);
  expect(mixesOf(w)).toHaveLength(16);
});

test('docFragments splits a document exactly', () => {
  const doc = renderVariant(SAMPLES['wedding, three tick boxes'](), 'private', [CAMERA]);
  const { head, sections, tail } = docFragments(doc);
  expect(head + sections.join(',') + tail).toBe(JSON.stringify(doc));
  expect(head.endsWith('"sections":[')).toBe(true);
  expect(tail.startsWith('],"business_signature":')).toBe(true);
  expect(sections).toEqual(doc.sections.map((s) => JSON.stringify(s)));
  expect(docJsonFromSet([head, ...sections, tail], [0, ...sections.map((_, k) => k + 1), sections.length + 1])).toBe(JSON.stringify(doc));
});

test('every mix of every sample booking rebuilds from the set to exactly its own document', () => {
  for (const [name, make] of Object.entries(SAMPLES)) {
    const booked = make();
    const set = buildVariantSet(booked);
    expect(set.mixes.map((m) => m.id), name).toEqual(mixesOf(booked).map((m) => m.id));
    expect(new Set(set.pool).size, `${name}: no fragment twice`).toBe(set.pool.length);
    expect(set.pool.every((p) => typeof p === 'string'), name).toBe(true);
    const hashes = new Set<string>();
    for (const m of set.mixes) {
      expect(m.f, `${name} ${m.id}`).toHaveLength(25);
      const json = docJsonFromSet(set.pool, m.f);
      expect(json, `${name} ${m.id}`).toBe(JSON.stringify(renderVariant(booked, m.choice, m.extras)));
      expect(tokens(json), `${name} ${m.id}`).toBe(1);
      hashes.add(sha256(json));
    }
    // Every mix has its own text.
    expect(hashes.size, name).toBe(set.mixes.length);
  }
});

test('the set needs far fewer section renders than one render per mix', () => {
  const stats = { sectionRenders: 0 };
  const set = buildVariantSet(SAMPLES['wedding, three tick boxes'](), stats);
  expect(set.mixes).toHaveLength(16);
  expect(stats.sectionRenders).toBeGreaterThanOrEqual(23 + 15);
  expect(stats.sectionRenders).toBeLessThanOrEqual(23 * 2 + 16 + 8);
  // The memo lives inside one call: a second call renders as much again.
  const again = { sectionRenders: 0 };
  buildVariantSet(SAMPLES['wedding, three tick boxes'](), again);
  expect(again.sectionRenders).toBe(stats.sectionRenders);
  expect(() => buildVariantSet(SAMPLES['civil, usual retainer']())).not.toThrow();
});

test('the set sees data changes made between calls (no cache outside one call)', () => {
  const booked = SAMPLES['civil, usual retainer']();
  const first = buildVariantSet(booked);
  const deliverables: string[] = pkgOf('civil-ceremony').deliverables;
  withChange(
    () => {
      const before = deliverables[0];
      deliverables[0] = '3 hours of photography in one continuous block';
      return () => {
        deliverables[0] = before;
      };
    },
    () => {
      const changed = buildVariantSet(booked);
      const json = docJsonFromSet(changed.pool, changed.mixes[0].f);
      expect(json).toContain('3 hours of photography in one continuous block');
      expect(json).toBe(JSON.stringify(renderVariant(booked, 'share')));
    },
  );
  const after = buildVariantSet(booked);
  expect(after).toEqual(first);
});

test('a section whose clauses name an amount of the mix is rendered for each amount', () => {
  // Bend the usual retainer clause (3.5, shown for this booking) so it names the retainer of the mix.
  const file = clausesJson as unknown as ClauseFile;
  const clause = file.sections[3].items.find((i) => i.type === 'clause' && i.id === '3.5') as SourceClause;
  const booked = SAMPLES['civil, usual retainer']();
  withChange(
    () => {
      const before = clause.text;
      clause.text = `${before} Your retainer is {{RETAINER}}.`;
      return () => {
        clause.text = before;
      };
    },
    () => {
      const stats = { sectionRenders: 0 };
      const set = buildVariantSet(booked, stats);
      const sectionThree = new Set<number>();
      for (const m of set.mixes) {
        expect(docJsonFromSet(set.pool, m.f), m.id).toBe(JSON.stringify(renderVariant(booked, m.choice, m.extras)));
        sectionThree.add(m.f[1 + 3]);
      }
      // 8 retainers, one per set of priced extras (share and private give the same text, stored once).
      expect(sectionThree.size).toBe(8);
      expect(new Set(set.mixes.map((m) => factsFor(booked, m.choice, m.extras).retainer)).size).toBe(8);
    },
  );
});

test('docJsonFromSet refuses an index list that does not fit its pool', () => {
  expect(() => docJsonFromSet(['a', 'b'], [0, 5, 1])).toThrow();
  expect(() => docJsonFromSet(['a', 'b'], [0])).toThrow();
  expect(() => docJsonFromSet(['a', 'b'], [0, 1.5, 1])).toThrow();
  expect(docJsonFromSet(['{"s":[', '1', '2', ']}'], [0, 1, 2, 3])).toBe('{"s":[1,2]}');
});

// ------------------------------------------------------------------ byte pins

// sha256 of JSON.stringify(renderVariant(...)), the sign date token still inside. Pinned before tick boxes
// existed (20408b9): a booking with nothing ticked must keep exactly the text it had.
// Re-pinned for the payment change (spec 2026-11-23, sections 5.1 and 5.6): a NEW booking gets the new
// clause text (25%, cash only, two payments), so its hashes are new. A booking made before keeps its
// stored text: the old pins still hold for the stored texts of the old bookings (and the old-booking guard
// in agreement-old-bookings.unit.ts checks every answer about them).
// Re-pinned for spec 2026-11-23, section 5.8: the clause text of a NEW booking changed again (3.5 and 3.6
// rounded up to the next dollar, 3.9 any other e-transfer, 16.14 the written reminder; clause version
// 8f15fd047652). With those words swapped back and the version 749c631df042, the four texts give the
// four pins of section 5.6 again (23d26213, 982777cf, 7ca46625, df7ea6da).
test('nothing ticked: the documents are byte for byte the ones made before tick boxes', () => {
  const civil = civilFacts();
  expect(sha256(JSON.stringify(renderVariant(civil, 'share')))).toBe('767ae39806ab19c984b1b87c6924dcbb04fd70a4e6596bd304f60bf593a17cbb');
  expect(sha256(JSON.stringify(renderVariant(civil, 'private')))).toBe('dfbf0726736e70c741265301aaae32d4d712ab74c15c36bfd6d8507baabb119c');
  const wed = weddingFacts();
  expect(sha256(JSON.stringify(renderVariant(wed, 'share')))).toBe('6a7d8e0f51c6058c7b9bb74db43290a72efbaa2b3c13933bbf479f2eb0c221eb');
  expect(sha256(JSON.stringify(renderVariant(wed, 'private')))).toBe('5d990338eeda9af3c25c7cd8697ab36ceb87164f464737509fb6274800340928');
  // The old pins, on the two texts stored with the pilot booking (same number) made by git 20408b9, before the change.
  const old = oldRecord('civil-noset');
  expect(old.number).toBe('KK-TEST-2026-001');
  expect(sha256(old.variants.share.doc_json)).toBe('1e45ce43c109e8170d479decc3d1bb355dec009ed74882c9acfa94c7856d8629');
  expect(sha256(old.variants.private.doc_json)).toBe('5c03a6b37e0c39591ef15bb39b577919a1837387c771aa0cda5c281d84ed46be');
  // The set gives the same two texts for share and private.
  for (const booked of [civil, wed]) {
    const set = buildVariantSet(booked);
    for (const choice of ['share', 'private'] as Choice[]) {
      const m = set.mixes.find((x) => x.id === choice)!;
      expect(docJsonFromSet(set.pool, m.f)).toBe(JSON.stringify(renderVariant(booked, choice)));
    }
  }
});
