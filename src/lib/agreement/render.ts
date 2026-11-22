// Turns a booking into the exact agreement a client reads, once per sharing choice.
// Clause text comes only from clauses.json. This file fills placeholders and picks visible clauses.
import clausesJson from '../../data/agreement/clauses.json' with { type: 'json' };
import agreementPackagesJson from '../../data/agreement/packages.json' with { type: 'json' };
import businessJson from '../../data/agreement/business.json' with { type: 'json' };
import sitePackagesJson from '../../data/packages.json' with { type: 'json' };
import siteAddOnsJson from '../../data/add-ons.json' with { type: 'json' };
import { money, longDate, shortDate, clockTime, addDays, addMonths, torontoIsoDate } from './format';
import { SIGN_DATE_TOKEN } from './token';
import type { AgreementDoc, BookingFacts, Choice, ClauseFile, DocItem, SourceClause } from './types';

export { SIGN_DATE_TOKEN };

export class BookingError extends Error {
  code: string;
  field?: string;
  constructor(code: string, field?: string) {
    super(field ? `${code}: ${field}` : code);
    this.name = 'BookingError';
    this.code = code;
    this.field = field;
  }
}

interface AddOnRow {
  id: string | null;
  label: string;
  priceText: string;
  note: string;
  bookable: boolean;
}
interface PackageFacts {
  name: string;
  tags: string[];
  hours: number;
  extraHoursAddOnId: string;
  overtimeBlock: number;
  deliverables: string[];
  // One of the two: delivery in calendar months, or in days.
  deliveryMonths?: number;
  deliveryDays?: number;
  deliveryPromise: string;
  deliveryRow: string;
  dateRowLabel: string;
  // The label of the one balance row. Only packages paid in two parts have one.
  balanceRowLabel?: string;
  // 'three-part': retainer, second payment and final payment (clause 3.6, tag WEDDING).
  payments?: 'three-part';
  // The hours a second photographer joins for (clause 8.2, tag SECOND), and the add-on that adds more.
  secondPhotographer?: { includedHours: number; addOnId: string };
  // The engagement session in the package (clauses 10.13 and 16.9, tag ENGAGEMENT).
  engagement?: { desc: string; valuePackageId: string };
  addOnRows: AddOnRow[];
  laterCosts: string;
  introBullets: string[];
  sharing: Record<Choice, { tags: string[]; row: string; option: string }>;
  agreeLabel: string;
  afterSigning: { title: string; text: string };
}
interface Business {
  legalName: string;
  tradeNames: string[];
  phone: string;
  email: string;
  website: string;
  etransferEmail: string;
  hstMode: 'none' | 'added' | 'included';
  hstNumber: string;
  insured: boolean;
  whoShoots: string;
}
interface SitePackage {
  id: string;
  price: number | null;
  salePrice?: number | null;
}
interface SiteAddOn {
  id: string;
  label: string;
  price: number | null;
  max?: number;
}

const CLAUSES = clausesJson as unknown as ClauseFile;
const PACKAGES = agreementPackagesJson as unknown as Record<string, PackageFacts>;
const BUSINESS = businessJson as unknown as Business;
const SITE_PACKAGES = sitePackagesJson as unknown as SitePackage[];
const SITE_ADD_ONS = siteAddOnsJson as unknown as SiteAddOn[];

const TAX_TAG: Record<Business['hstMode'], string> = { none: 'HST-NO', added: 'HST-ADDED', included: 'HST-INCLUDED' };

const cents = (n: number) => Math.round(n * 100) / 100;

const packageFacts = (id: unknown): PackageFacts => {
  const pkg = typeof id === 'string' && Object.hasOwn(PACKAGES, id) ? PACKAGES[id] : undefined;
  if (!pkg || !SITE_PACKAGES.some((p) => p.id === id)) throw new BookingError('package_not_ready', 'package_id');
  return pkg;
};

/**
 * True when the package is paid in three parts. A package's data must agree with its clause tags:
 * three payments go with WEDDING (clause 3.6), a second photographer setting with SECOND (clause 8.2).
 * Anything else is a data mistake and throws, so no booking is made or shown from it.
 */
const threePart = (pkg: PackageFacts): boolean => {
  if (pkg.payments !== undefined && pkg.payments !== 'three-part') throw new Error(`package ${pkg.name}: unknown payments ${String(pkg.payments)}`);
  const three = pkg.payments === 'three-part';
  if (three !== pkg.tags.includes('WEDDING')) throw new Error(`package ${pkg.name}: three payments and the WEDDING tag go together`);
  if ((pkg.secondPhotographer !== undefined) !== pkg.tags.includes('SECOND'))
    throw new Error(`package ${pkg.name}: a second photographer setting and the SECOND tag go together`);
  return three;
};

const deliveryDate = (pkg: PackageFacts, eventDate: string): string => {
  if (pkg.deliveryMonths !== undefined) return addMonths(eventDate, pkg.deliveryMonths);
  if (pkg.deliveryDays !== undefined) return addDays(eventDate, pkg.deliveryDays);
  throw new Error(`package ${pkg.name} has no delivery time`);
};

const siteAddOn = (id: string): SiteAddOn => {
  const a = SITE_ADD_ONS.find((x) => x.id === id);
  if (!a || typeof a.price !== 'number') throw new BookingError('bad_add_on', 'add_ons');
  return a;
};

/** Replaces each {{NAME}} from vals. SIGN_DATE stays as the token. An unknown name throws. */
const fill = (template: string, vals: Record<string, string>): string =>
  template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, name: string) => {
    if (name === 'SIGN_DATE') return whole;
    if (!Object.hasOwn(vals, name)) throw new BookingError('unfilled_placeholder', name);
    return vals[name];
  });

// ---------------------------------------------------------------- validation

const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;

// Facts go into clause text, so they must not carry placeholder braces or bold markup.
const hasMarkup = (s: string) => s.includes('{{') || s.includes('}}') || s.includes('**');

/** Trims, turns control characters into spaces and collapses runs of spaces. Markup is refused. */
const cleanText = (v: unknown, min: number, max: number, code: string, field: string): string => {
  if (typeof v !== 'string') throw new BookingError(code, field);
  const s = v.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  if (s.length < min || s.length > max || hasMarkup(s)) throw new BookingError(code, field);
  return s;
};

/** True when n is a whole number of cents (allowing for binary float noise). */
const wholeCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/** The usual retainer: half of the total, rounded up to the next dollar. */
const usualRetainer = (total: number) => Math.ceil(total / 2);

const MAX_DAYS_AHEAD = 1096;

const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const minutes = (hhmm: unknown): number | null => {
  if (typeof hhmm !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm)) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

export function buildBookingFacts(input: unknown, ctx: { number: string; createdAt: Date }): BookingFacts {
  const o = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const pkg = packageFacts(o.package_id);
  const package_id = o.package_id as string;
  const three = threePart(pkg);

  const client_name = cleanText(o.client_name, 2, 120, 'bad_name', 'client_name');
  const partner_name = cleanText(o.partner_name, 2, 120, 'bad_name', 'partner_name');

  // The same rule as Apps Script (AGREEMENT_EMAIL_RE): an address it would refuse is refused here.
  const client_email = cleanText(o.client_email, 3, 254, 'bad_email', 'client_email');
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(client_email)) throw new BookingError('bad_email', 'client_email');

  if (typeof o.client_phone !== 'string') throw new BookingError('bad_phone', 'client_phone');
  const client_phone = o.client_phone.trim();
  if (!/^[0-9 +().-]{7,20}$/.test(client_phone) || client_phone.replace(/\D/g, '').length < 7)
    throw new BookingError('bad_phone', 'client_phone');

  const event_date = o.event_date;
  const today = torontoIsoDate(ctx.createdAt);
  if (!isIsoDate(event_date) || event_date < today || event_date > addDays(today, MAX_DAYS_AHEAD))
    throw new BookingError('bad_date', 'event_date');
  // Three payments: the second falls due 60 days before the wedding at the latest. That date must
  // still be ahead, or the dates in section 1 would already have passed.
  const second_due = three ? addDays(event_date, -60) : undefined;
  if (second_due !== undefined && second_due <= today) throw new BookingError('bad_date', 'event_date');

  const place = cleanText(o.place, 3, 200, 'bad_place', 'place');

  let package_price: number;
  if (o.price === undefined) {
    const site = SITE_PACKAGES.find((p) => p.id === package_id)!;
    const sitePrice = site.salePrice ?? site.price;
    if (typeof sitePrice !== 'number') throw new BookingError('bad_price', 'price');
    package_price = sitePrice;
  } else {
    if (typeof o.price !== 'number' || !Number.isFinite(o.price) || o.price < 1 || o.price > 100000 || !wholeCents(o.price))
      throw new BookingError('bad_price', 'price');
    package_price = cents(o.price);
  }

  const rawAddOns = o.add_ons === undefined ? [] : o.add_ons;
  if (!Array.isArray(rawAddOns)) throw new BookingError('bad_add_on', 'add_ons');
  const seen = new Set<string>();
  const add_ons = rawAddOns.map((a: unknown) => {
    const { id, qty } = (a && typeof a === 'object' ? a : {}) as { id?: unknown; qty?: unknown };
    const row = pkg.addOnRows.find((r) => r.bookable && r.id !== null && r.id === id);
    if (!row || seen.has(row.id!)) throw new BookingError('bad_add_on', 'add_ons');
    seen.add(row.id!);
    const site = siteAddOn(row.id!);
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > (site.max ?? 1))
      throw new BookingError('bad_add_on', 'add_ons');
    const unit_price = site.price as number;
    return { id: row.id!, label: row.label, qty, unit_price, line_total: cents(unit_price * qty) };
  });

  const hours = pkg.hours + (add_ons.find((a) => a.id === pkg.extraHoursAddOnId)?.qty ?? 0);
  const start = minutes(o.start_time);
  const end = minutes(o.end_time);
  if (start === null || end === null || end - start !== hours * 60) throw new BookingError('bad_times', 'end_time');

  // The second photographer joins for the hours in the package plus any booked on top, never more than the coverage.
  const sp = pkg.secondPhotographer;
  const second_hours = sp ? sp.includedHours + (add_ons.find((a) => a.id === sp.addOnId)?.qty ?? 0) : undefined;
  if (second_hours !== undefined && second_hours > hours) throw new BookingError('bad_add_on', 'add_ons');

  const notes = o.notes === undefined || o.notes === '' ? '' : cleanText(o.notes, 0, 300, 'bad_notes', 'notes');

  const total = cents(package_price + add_ons.reduce((sum, a) => sum + a.line_total, 0));
  let retainer: number;
  if (o.retainer === undefined) retainer = usualRetainer(total);
  else {
    if (typeof o.retainer !== 'number' || !Number.isFinite(o.retainer) || !wholeCents(o.retainer) || o.retainer < 1 || cents(o.retainer) >= total)
      throw new BookingError('bad_retainer', 'retainer');
    retainer = cents(o.retainer);
  }
  // The clause for a set retainer is for two payments only (NONWED).
  if (three && retainer !== usualRetainer(total)) throw new BookingError('bad_retainer', 'retainer');
  const balance = cents(total - retainer);

  if (o.balance_cash !== undefined && typeof o.balance_cash !== 'boolean') throw new BookingError('bad_balance_cash', 'balance_cash');
  const balance_cash = o.balance_cash === true;
  // The cash only clause is for two payments only (NONWED).
  if (three && balance_cash) throw new BookingError('bad_balance_cash', 'balance_cash');

  // Three payments (clause 3.6): half at signing, a quarter, then the rest. They add up to the total exactly.
  let payments = {};
  if (three) {
    const second_payment = Math.ceil(total / 4);
    const final_payment = cents(total - retainer - second_payment);
    if (final_payment < 1) throw new BookingError('bad_price', 'price');
    payments = { second_payment, final_payment, second_due: second_due as string, final_due: addDays(event_date, -14) };
  }

  return {
    package_id,
    client_name,
    partner_name,
    client_email,
    client_phone,
    event_date,
    start_time: o.start_time as string,
    end_time: o.end_time as string,
    place,
    number: ctx.number,
    created_at: ctx.createdAt.toISOString(),
    package_name: pkg.name,
    package_price,
    add_ons,
    total,
    retainer,
    balance,
    balance_cash,
    hours,
    delivery_date: deliveryDate(pkg, event_date),
    notes,
    ...payments,
    ...(second_hours === undefined ? {} : { second_hours }),
  };
}

// ---------------------------------------------------------------- rendering

const activeTags = (pkg: PackageFacts, choice: Choice, facts: BookingFacts): Set<string> => {
  const retainerTag = facts.retainer === usualRetainer(facts.total) ? 'RET-HALF' : 'RET-SET';
  // Stored bookings made before balance_cash existed have none: they read as false.
  const balanceTag = facts.balance_cash === true ? 'BAL-CASH' : 'BAL-ANY';
  const tags = new Set(['ALL', ...pkg.tags, ...pkg.sharing[choice].tags, TAX_TAG[BUSINESS.hstMode], retainerTag, balanceTag]);
  if (BUSINESS.insured) tags.add('INSURED');
  return tags;
};

const isVisible = (c: SourceClause, active: Set<string>) => c.tags.some((group) => group.every((t) => active.has(t)));

const otValues = (pkg: PackageFacts) => ({
  OT_RATE: money(siteAddOn(pkg.extraHoursAddOnId).price as number),
  OT_BLOCK: money(pkg.overtimeBlock),
});

/**
 * The two payments after the retainer of a booking paid in three parts, as label and sentence, or
 * null for a booking without them. Section 1, the page after signing and the review step use these words.
 */
export function laterPaymentRows(f: BookingFacts): { label: string; text: string }[] | null {
  if (f.second_payment === undefined) return null;
  if (f.final_payment === undefined || f.second_due === undefined || f.final_due === undefined)
    throw new Error(`booking ${f.number} has a second payment but no final payment or due dates`);
  return [
    {
      label: 'Second payment',
      text: `${money(f.second_payment)} by e-transfer. Due 7 days after I deliver your engagement session gallery. If you have not had your engagement session by ${longDate(f.second_due)}, it is due on that date.`,
    },
    { label: 'Final payment', text: `${money(f.final_payment)} by e-transfer. Due by ${longDate(f.final_due)}, which is 14 days before your wedding.` },
  ];
}

const paymentRows = (f: BookingFacts, pkg: PackageFacts): string[][] => {
  if (threePart(pkg)) {
    const later = laterPaymentRows(f);
    if (!later) throw new Error(`booking ${f.number} of ${pkg.name} has no later payments`);
    return later.map((r) => [r.label, r.text]);
  }
  if (pkg.balanceRowLabel === undefined) throw new Error(`package ${pkg.name} has no balance row label`);
  return [[pkg.balanceRowLabel, f.balance_cash === true ? `${money(f.balance)} in cash` : `${money(f.balance)} by e-transfer or cash`]];
};

const hoursText = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`;

/** The second photographer row of section 1, after "Who shoots". None for a package without one. */
const secondPhotographerRows = (f: BookingFacts, pkg: PackageFacts): string[][] => {
  const sp = pkg.secondPhotographer;
  if (!sp) return [];
  if (f.second_hours === undefined) throw new Error(`booking ${f.number} of ${pkg.name} has no second photographer hours`);
  const added = f.add_ons.find((a) => a.id === sp.addOnId)?.qty ?? 0;
  if (f.second_hours !== sp.includedHours + added || f.second_hours > f.hours)
    throw new Error(`booking ${f.number}: second photographer hours do not add up`);
  const split = `${hoursText(sp.includedHours)} ${sp.includedHours === 1 ? 'is' : 'are'} in your package and ${added} ${added === 1 ? 'is' : 'are'} added.`;
  const text =
    added === 0
      ? `${hoursText(sp.includedHours)}, for the ceremony or the reception (your choice)`
      : f.second_hours === f.hours
        ? `${hoursText(f.second_hours)}, for your whole coverage. ${split}`
        : `${hoursText(f.second_hours)} in one continuous block. You choose which part of the day. ${split}`;
  return [['Second photographer', text]];
};

const bookingRows = (f: BookingFacts, pkg: PackageFacts, choice: Choice): string[][] => {
  // Only the no-HST case has agreed row text so far.
  if (BUSINESS.hstMode !== 'none') throw new Error(`hstMode ${BUSINESS.hstMode} has no booking table rows yet`);
  const addOns = f.add_ons.length
    ? f.add_ons.map((a) => `${a.label}, ${a.qty} × ${money(a.unit_price)} = ${money(a.line_total)}`).join('; ')
    : 'None';
  const rows: string[][] = [
    ['Booking number', f.number],
    ['Package', f.package_name],
    ['Package price', money(f.package_price)],
    ['Add-ons chosen at booking', addOns],
    ['Sharing choice (section 15)', pkg.sharing[choice].row],
    ['Total', money(f.total)],
    ['Retainer, due at signing', `${money(f.retainer)} by e-transfer`],
    ...paymentRows(f, pkg),
    [pkg.dateRowLabel, longDate(f.event_date)],
    ['Coverage', `${hoursText(f.hours)}, from ${clockTime(f.start_time)} to ${clockTime(f.end_time)}`],
    ['Where', f.place],
    ['Who shoots', BUSINESS.whoShoots],
    ...secondPhotographerRows(f, pkg),
    ['Delivery', fill(pkg.deliveryRow, { DELIVERY_DATE: longDate(f.delivery_date) })],
  ];
  if (f.notes) rows.push(['Also agreed for your day', f.notes]);
  rows.push(['Costs that may apply later', fill(pkg.laterCosts, otValues(pkg))]);
  return rows;
};

const addOnTableRows = (pkg: PackageFacts): string[][] =>
  pkg.addOnRows.map((r) => {
    const vals = { ...(r.id === null ? {} : { PRICE: money(siteAddOn(r.id).price as number) }), OT_BLOCK: money(pkg.overtimeBlock) };
    return [r.label, fill(r.priceText, vals), fill(r.note, vals)];
  });

/** ENGAGEMENT_DESC and ENGAGEMENT_VALUE (the list price of the site package), only for a package with an engagement session. */
const engagementValues = (pkg: PackageFacts): Record<string, string> => {
  const e = pkg.engagement;
  if (!e) return {};
  const site = SITE_PACKAGES.find((p) => p.id === e.valuePackageId);
  if (!site || typeof site.price !== 'number') throw new Error(`package ${pkg.name}: no list price for ${e.valuePackageId}`);
  return { ENGAGEMENT_DESC: e.desc, ENGAGEMENT_VALUE: money(site.price) };
};

const hasStrayPlaceholder = (s: string) => s.split(SIGN_DATE_TOKEN).join('').includes('{{');

export function renderVariant(facts: BookingFacts, choice: Choice): AgreementDoc {
  const pkg = packageFacts(facts.package_id);
  const active = activeTags(pkg, choice, facts);
  const vals: Record<string, string> = {
    CLIENT_NAME: facts.client_name,
    CLIENT_EMAIL: facts.client_email,
    CLIENT_PHONE: facts.client_phone,
    PARTNER_NAME: facts.partner_name,
    BUSINESS_LEGAL_NAME: BUSINESS.legalName,
    BOOKING_ID: facts.number,
    PACKAGE_NAME: pkg.name,
    ETRANSFER_EMAIL: BUSINESS.etransferEmail,
    DELIVERY_PROMISE: pkg.deliveryPromise,
    RETAINER: money(facts.retainer),
    ...otValues(pkg),
    ...engagementValues(pkg),
  };

  let signDateTokens = 0;
  const sections = CLAUSES.sections.map((sec) => {
    const items: DocItem[] = [];
    let k = 0;
    for (const it of sec.items) {
      if (it.type === 'block') {
        const name = (it as { name: string }).name;
        if (name === 'TABLE:BOOKING') items.push({ type: 'table', kind: 'booking', rows: bookingRows(facts, pkg, choice), bold: ['Total'] });
        else if (name === 'TABLE:ADDONS') items.push({ type: 'table', kind: 'addons', rows: addOnTableRows(pkg), bold: [] });
        else if (name === 'LIST:DELIVERABLES') items.push({ type: 'list', items: [...pkg.deliverables] });
        else throw new Error(`unknown block ${name} in section ${sec.num}`);
        continue;
      }
      if (!isVisible(it, active)) continue;
      k += 1;
      const text = fill(it.text, vals);
      const bullets = it.bullets.map((b) => fill(b, vals));
      signDateTokens += text.split(SIGN_DATE_TOKEN).length - 1;
      if (hasStrayPlaceholder(text) || bullets.some((b) => b.includes('{{')) || signDateTokens > 1)
        throw new BookingError('unfilled_placeholder', it.id);
      items.push({ type: 'clause', n: sec.num === 0 ? '' : `${sec.num}.${k}`, text, bullets });
    }
    // Table cells and list items may not carry any placeholder, not even the sign date.
    for (const item of items) {
      const strings = item.type === 'table' ? item.rows.flat() : item.type === 'list' ? item.items : [];
      if (strings.some((s) => s.includes('{{'))) throw new BookingError('unfilled_placeholder', `section ${sec.num}`);
    }
    return { num: sec.num, title: sec.title, items };
  });

  return {
    title: CLAUSES.title,
    intro: CLAUSES.intro,
    clause_version: CLAUSES.version,
    choice,
    number: facts.number,
    sections,
    business_signature: `Signed for ${BUSINESS.legalName}, operating as AD Photography and KashKlicks, on ${shortDate(new Date(facts.created_at))}`,
  };
}

/** Puts the signing date into a rendered document's JSON. The token must occur exactly once. */
export function fillSignDate(docJson: string, dateText: string): string {
  const pieces = docJson.split(SIGN_DATE_TOKEN);
  if (pieces.length !== 2) throw new Error(`expected one ${SIGN_DATE_TOKEN}, found ${pieces.length - 1}`);
  return pieces.join(JSON.stringify(dateText).slice(1, -1));
}

export function signLabels(facts: BookingFacts): {
  share_option: string;
  private_option: string;
  agree_label: string;
  intro_bullets: string[];
  after_signing: { title: string; text: string };
} {
  const pkg = packageFacts(facts.package_id);
  // The only names a label may use. Anything else, or a {{ left over (the sign date), throws.
  const vals = { CLIENT_FIRST: facts.client_name.trim().split(/\s+/)[0] ?? '', PARTNER_NAME: facts.partner_name };
  const label = (template: string) => {
    const s = fill(template, vals);
    if (s.includes('{{')) throw new BookingError('unfilled_placeholder', 'labels');
    return s;
  };
  return {
    share_option: label(pkg.sharing.share.option),
    private_option: label(pkg.sharing.private.option),
    agree_label: label(pkg.agreeLabel),
    intro_bullets: pkg.introBullets.map(label),
    after_signing: { title: label(pkg.afterSigning.title), text: label(pkg.afterSigning.text) },
  };
}
