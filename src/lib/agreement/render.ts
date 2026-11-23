// Turns a booking into the exact agreement a client reads, once per sharing choice.
// Clause text comes only from clauses.json. This file fills placeholders and picks visible clauses.
import clausesJson from '../../data/agreement/clauses.json' with { type: 'json' };
import agreementPackagesJson from '../../data/agreement/packages.json' with { type: 'json' };
import businessJson from '../../data/agreement/business.json' with { type: 'json' };
import sitePackagesJson from '../../data/packages.json' with { type: 'json' };
import siteAddOnsJson from '../../data/add-ons.json' with { type: 'json' };
import { money, longDate, shortDate, clockTime, addDays, addMonths, torontoIsoDate } from './format';
import { SIGN_DATE_TOKEN } from './token';
import { mixId } from './set';
import type { AgreementDoc, BookingFacts, Choice, ClauseFile, DocItem, SourceBlock, SourceClause, SourceSection, TickBox } from './types';

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
  // A contract-only price, for an add-on that is not in the site data (add-ons.json). Booked once at most.
  price?: number;
}
/** An add-on the couple can tick at signing. Without `deposit` it is priced (qty 1 at the row's price). */
interface TickBoxData {
  id: string;
  // A refundable deposit instead of a price: never in the total. Its row goes into section 1 after the payments.
  deposit?: { rowLabel: string; row: string; note: string };
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
  // The label of the one balance row (every package is paid in two parts since 2026-11-23).
  balanceRowLabel?: string;
  // Not a setting any more: a package that still has it is refused (see checkPackage). Typed only for that check.
  payments?: unknown;
  // The hours a second photographer joins for (clause 8.2, tag SECOND), and the add-on that adds more.
  secondPhotographer?: { includedHours: number; addOnId: string };
  // The engagement session in the package (clauses 10.13 and 16.9, tag ENGAGEMENT).
  engagement?: { desc: string; valuePackageId: string };
  // A fee added to the total when the couple chooses private (clause 15.2, tag SHARE-B).
  privateFee?: number;
  addOnRows: AddOnRow[];
  // At most 3. Order = display order = the order of ticked extras everywhere.
  tickBoxes?: TickBoxData[];
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
  // Frozen into every new booking (facts.etransfer_email): a later change never reaches a booking made before it.
  etransferEmail: string;
  // The usual retainer, in percent of the total (facts.retainer_percent, frozen the same way).
  retainerPercent: number;
  // The balance is paid in cash only, unless a booking says otherwise (balance_cash: false).
  balanceCashOnly: boolean;
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
 * A package's data must agree with its clause tags: a second photographer setting goes with SECOND
 * (clause 8.2). Every booking is paid in two parts since 2026-11-23 (clauses 3.5, 3.6 and 3.16), so a
 * package with a `payments` setting is refused. Anything else is a data mistake and throws, so no
 * booking is made or shown from it.
 */
const checkPackage = (pkg: PackageFacts): void => {
  if (Object.hasOwn(pkg, 'payments')) throw new Error(`package ${pkg.name}: payments is not a package setting any more, every booking is paid in two parts`);
  if ((pkg.secondPhotographer !== undefined) !== pkg.tags.includes('SECOND'))
    throw new Error(`package ${pkg.name}: a second photographer setting and the SECOND tag go together`);
};

// What every booking made before 2026-11-23 was made with. Its facts carry neither retainer_percent nor
// etransfer_email, so they read as these values: the 50% retainer and the old e-transfer address. A
// later change of business.json never reaches a booking: new ones carry their own frozen values.
export const RETAINER_PERCENT_BEFORE_2026_11_23 = 50;
export const ETRANSFER_EMAIL_BEFORE_2026_11_23 = 'info@kashklicks.ca';

/** The retainer percent frozen with a booking (50 for a booking made before 2026-11-23). */
export const retainerPercentOf = (f: BookingFacts): number => f.retainer_percent ?? RETAINER_PERCENT_BEFORE_2026_11_23;
/** The e-transfer address frozen with a booking (the old address for a booking made before 2026-11-23). */
export const etransferEmailOf = (f: BookingFacts): string => f.etransfer_email ?? ETRANSFER_EMAIL_BEFORE_2026_11_23;

/**
 * The percents the clauses name for the usual retainer ("The retainer is 25% of your total", clauses 3.5
 * and 3.6), in clause file order. The clauses write it as fixed text, not as a placeholder.
 */
const clauseRetainerPercents = (): number[] => {
  const out: number[] = [];
  for (const sec of CLAUSES.sections)
    for (const item of sec.items)
      if (item.type === 'clause')
        for (const m of [item.text, ...item.bullets].join('\n').matchAll(/The retainer is (\d+)% of your total/g)) out.push(Number(m[1]));
  return out;
};

/** The business settings a new booking freezes. A broken value is a data mistake and throws. */
const businessPayments = (): { retainer_percent: number; etransfer_email: string; cashOnly: boolean } => {
  const p = BUSINESS.retainerPercent;
  if (typeof p !== 'number' || !Number.isInteger(p) || p < 1 || p > 99) throw new Error('business.json: retainerPercent must be a whole number from 1 to 99');
  // A percent the clauses do not name would give a section 1 retainer that its own clause 3.5 or 3.6 contradicts.
  const named = clauseRetainerPercents();
  if (named.length === 0 || named.some((n) => n !== p))
    throw new Error(`business.json: retainerPercent ${p} is not the percent the clauses name (${named.join(', ') || 'none'})`);
  const email = BUSINESS.etransferEmail;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('business.json: etransferEmail must be an email address');
  if (typeof BUSINESS.balanceCashOnly !== 'boolean') throw new Error('business.json: balanceCashOnly must be true or false');
  return { retainer_percent: p, etransfer_email: email, cashOnly: BUSINESS.balanceCashOnly };
};

/**
 * The package's fee for private work, or undefined. The fee goes together with the tag SHARE-B in the
 * share option (clause 15.2).
 */
const privateFeeOf = (pkg: PackageFacts): number | undefined => {
  const fee = pkg.privateFee;
  const shareB = pkg.sharing.share.tags.includes('SHARE-B');
  if (fee === undefined) {
    if (shareB) throw new Error(`package ${pkg.name}: the SHARE-B tag needs a privateFee`);
    return undefined;
  }
  if (!shareB) throw new Error(`package ${pkg.name}: a privateFee goes with the SHARE-B tag`);
  if (typeof fee !== 'number' || !Number.isFinite(fee) || fee < 1 || !wholeCents(fee))
    throw new Error(`package ${pkg.name}: privateFee must be a whole number of cents, at least 1`);
  return fee;
};

/** The fee of these facts, checked against the package: a package with a fee needs facts with one, and the other way round. */
const feeOf = (pkg: PackageFacts, f: BookingFacts): number | undefined => {
  const pkgFee = privateFeeOf(pkg);
  if ((pkgFee === undefined) !== (f.private_fee === undefined))
    throw new Error(`booking ${f.number}: the package and the booking do not agree on a fee for private work`);
  return f.private_fee;
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

/**
 * The unit price of an add-on row: its own contract-only price, or the site price as before.
 * A row with its own price must have an id that the site data does not have; anything else is a data mistake.
 */
const rowPrice = (pkg: PackageFacts, row: AddOnRow): number => {
  if (row.price === undefined) return siteAddOn(row.id!).price as number;
  if (row.id === null || SITE_ADD_ONS.some((a) => a.id === row.id) || typeof row.price !== 'number' || !Number.isFinite(row.price))
    throw new Error(`package ${pkg.name}, add-on row ${row.label}: a contract-only price needs its own id, one that add-ons.json does not have`);
  if (row.price < 1 || !wholeCents(row.price))
    throw new Error(`package ${pkg.name}, add-on row ${row.label}: a contract-only price must be a whole number of cents, at least 1`);
  return row.price;
};

/** A tick box id goes into mix ids (joined by +) and the PDF query (split on commas): plain ids only. */
const TICK_ID_RE = /^[a-z0-9-]+$/;

/** Replaces each {{NAME}} from vals. SIGN_DATE stays as the token. An unknown name throws. page.ts uses it too. */
export const fill = (template: string, vals: Record<string, string>): string =>
  template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (whole, name: string) => {
    if (name === 'SIGN_DATE') return whole;
    if (!Object.hasOwn(vals, name)) throw new BookingError('unfilled_placeholder', name);
    return vals[name];
  });

/** The {{NAME}} placeholders a template uses, in order. */
const placeholderNames = (template: string): string[] => [...template.matchAll(/\{\{([A-Z0-9_]+)\}\}/g)].map((m) => m[1]);

interface ResolvedTick {
  id: string;
  row: AddOnRow;
  amount: number; // the row's price: the unit price of a priced tick box, or the deposit
  deposit?: { rowLabel: string; row: string; note: string };
}

/**
 * The tick boxes of a package, checked against its add-on rows. A broken rule is a data mistake and
 * throws, like checkPackage(): at most 3, ids unique and plain (a to z, 0 to 9, hyphens), each id has
 * exactly one add-on row, never an hours add-on (hours set the times of the day), a price that is a whole
 * number of cents of at least 1, a priced one on a bookable row, a deposit on a row that is not bookable
 * and has its own price, and a deposit row that uses only PRICE (there is no final payment any more).
 */
const tickBoxesOf = (pkg: PackageFacts): ResolvedTick[] => {
  // Contract-only prices are checked first, for every row, so a broken row is named as such.
  for (const r of pkg.addOnRows) if (r.price !== undefined) rowPrice(pkg, r);
  const list = pkg.tickBoxes ?? [];
  if (!Array.isArray(list)) throw new Error(`package ${pkg.name}: tickBoxes must be a list`);
  if (list.length > 3) throw new Error(`package ${pkg.name}: at most 3 tick boxes`);
  const seen = new Set<string>();
  return list.map((tb: TickBoxData) => {
    const id = tb && typeof tb === 'object' ? tb.id : undefined;
    if (typeof id !== 'string' || id === '') throw new Error(`package ${pkg.name}: a tick box needs an id`);
    if (seen.has(id)) throw new Error(`package ${pkg.name}: tick box ${id} twice`);
    seen.add(id);
    const at = `package ${pkg.name}, tick box ${id}`;
    if (!TICK_ID_RE.test(id)) throw new Error(`${at}: an id may use only a to z, 0 to 9 and hyphens`);
    if (id === pkg.extraHoursAddOnId || id === pkg.secondPhotographer?.addOnId)
      throw new Error(`${at}: hours cannot be a tick box, they set the times of the day`);
    const rows = pkg.addOnRows.filter((r) => r.id === id);
    if (rows.length !== 1) throw new Error(`${at}: needs exactly one add-on row with this id`);
    const row = rows[0];
    const amount = rowPrice(pkg, row);
    // The site price of a priced tick box is checked here; a contract-only price already by rowPrice.
    if (!Number.isFinite(amount) || amount < 1 || !wholeCents(amount)) throw new Error(`${at}: its price must be a whole number of cents, at least 1`);
    if (tb.deposit === undefined) {
      if (row.bookable !== true) throw new Error(`${at}: a priced tick box needs a bookable row`);
      return { id, row, amount };
    }
    const d = tb.deposit;
    if (row.bookable !== false || row.price === undefined) throw new Error(`${at}: a deposit needs a row that is not bookable, with its own price`);
    if (!d || typeof d !== 'object' || typeof d.rowLabel !== 'string' || typeof d.row !== 'string' || typeof d.note !== 'string')
      throw new Error(`${at}: a deposit needs rowLabel, row and note`);
    if (placeholderNames(d.row).some((n) => n !== 'PRICE')) throw new Error(`${at}: the deposit row may use PRICE only`);
    if (hasMarkup(d.rowLabel) || hasMarkup(d.note)) throw new Error(`${at}: the deposit label and note take no placeholder`);
    return { id, row, amount, deposit: { rowLabel: d.rowLabel, row: d.row, note: d.note } };
  });
};

/**
 * The tick boxes of the package, and a check that stored facts agree with them (same idea as feeOf):
 * every tick box in the facts is one of the package, of the same kind. A mismatch throws.
 */
const ticksAgree = (pkg: PackageFacts, f: BookingFacts): ResolvedTick[] => {
  const ticks = tickBoxesOf(pkg);
  for (const t of f.tick_boxes ?? []) {
    const p = ticks.find((x) => x.id === t.id);
    if (!p) throw new Error(`booking ${f.number}: tick box ${t.id} is not a tick box of ${pkg.name}`);
    if ((p.deposit !== undefined) !== (t.kind === 'deposit')) throw new Error(`booking ${f.number}: tick box ${t.id} does not match its package`);
  }
  return ticks;
};

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

/**
 * The usual retainer: `percent` of the total, rounded up to the next dollar. Every caller passes the
 * percent frozen with the booking (retainerPercentOf): 25 for a booking made since 2026-11-23, 50 before.
 */
export const usualRetainer = (total: number, percent: number) => Math.ceil((total * percent) / 100);

/**
 * Three payments (the clause 3.6 of bookings made before 2026-11-23): after the retainer, a quarter of the
 * total rounded up to the next dollar, then the rest. Only factsFor uses it, for the stored facts of such
 * a booking (they carry second_payment); no new booking is paid in three parts.
 */
const laterPayments = (total: number, retainer: number) => {
  const second_payment = Math.ceil(total / 4);
  const final_payment = cents(total - retainer - second_payment);
  if (final_payment < 1) throw new BookingError('bad_price', 'price');
  return { second_payment, final_payment };
};

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
  checkPackage(pkg);
  const private_fee = privateFeeOf(pkg);
  const ticks = tickBoxesOf(pkg);
  // Frozen with the booking: the retainer percent and the e-transfer address of today's business settings.
  const { retainer_percent, etransfer_email, cashOnly } = businessPayments();

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
    const unit_price = rowPrice(pkg, row);
    // A contract-only add-on is booked once at most.
    const max = row.price === undefined ? (siteAddOn(row.id!).max ?? 1) : 1;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty < 1 || qty > max) throw new BookingError('bad_add_on', 'add_ons');
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
  if (o.retainer === undefined) retainer = usualRetainer(total, retainer_percent);
  else {
    if (typeof o.retainer !== 'number' || !Number.isFinite(o.retainer) || !wholeCents(o.retainer) || o.retainer < 1 || cents(o.retainer) >= total)
      throw new BookingError('bad_retainer', 'retainer');
    retainer = cents(o.retainer);
  }
  // The clause for a set retainer (3.16) is for bookings that are not weddings (NONWED): the wedding
  // clause 3.6 names the usual percent.
  if (pkg.tags.includes('WEDDING') && retainer !== usualRetainer(total, retainer_percent)) throw new BookingError('bad_retainer', 'retainer');
  const balance = cents(total - retainer);

  // Missing: the business setting (cash only). false lets this one booking pay the balance by e-transfer too.
  if (o.balance_cash !== undefined && typeof o.balance_cash !== 'boolean') throw new BookingError('bad_balance_cash', 'balance_cash');
  const balance_cash = o.balance_cash === undefined ? cashOnly : o.balance_cash;

  // What can still be ticked at signing: a tick box whose add-on is booked already is not offered again.
  const tick_boxes: TickBox[] = ticks
    .filter((t) => !add_ons.some((a) => a.id === t.id))
    .map((t) =>
      t.deposit
        ? { id: t.id, kind: 'deposit', label: t.row.label, amount: t.amount, deposit_label: t.deposit.rowLabel, deposit_note: t.deposit.note }
        : { id: t.id, kind: 'price', label: t.row.label, amount: t.amount },
    );

  const facts: BookingFacts = {
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
    retainer_percent,
    etransfer_email,
    hours,
    delivery_date: deliveryDate(pkg, event_date),
    notes,
    ...(second_hours === undefined ? {} : { second_hours }),
    ...(private_fee === undefined ? {} : { private_fee }),
    ...(tick_boxes.length === 0 ? {} : { tick_boxes }),
  };
  // Every mix must give sensible amounts too.
  for (const m of mixesOf(facts)) factsFor(facts, m.choice, m.extras);
  return facts;
}

/**
 * The facts of one mix: a sharing choice plus the extras ticked at signing. The one amounts function.
 * Nothing ticked, and share or a booking without a fee for private work: the facts as they are (the same
 * object). Private with a fee: the fee is added to the total, and the retainer (and, for a booking paid
 * in three parts, made before 2026-11-23, the later payments) are worked out again from the new total by
 * the same rules. Ticked extras (ids of f.tick_boxes, any order): priced ones join add_ons and the total,
 * deposits go to `deposits` and never into the total. A booking made with the usual retainer keeps the
 * usual rule, at the percent frozen with it (retainerPercentOf: 50 for a booking made before 2026-11-23);
 * a set retainer stays as it was set. Uses the stored facts only (no package lookup, no business
 * setting), never changes f. Facts that already carry the fee or extras throw.
 */
export function factsFor(f: BookingFacts, choice: Choice, extras: string[] = []): BookingFacts {
  if (f.sharing_fee !== undefined) throw new Error(`booking ${f.number}: the fee for private work is already in these facts`);
  if (f.extras !== undefined) throw new Error(`booking ${f.number}: the ticked extras are already in these facts`);
  if (!Array.isArray(extras)) throw new BookingError('bad_extras', 'extras');
  const percent = retainerPercentOf(f);
  // The usual rule follows the total of the mix; a set retainer stays. A booking paid in three parts
  // always had the usual retainer, so for it this is the usual retainer of the new total, as before.
  const retainerOf = (total: number) => (f.retainer === usualRetainer(f.total, percent) ? usualRetainer(total, percent) : f.retainer);
  if (extras.length === 0) {
    if (choice === 'share' || f.private_fee === undefined) return f;
    const total = cents(f.total + f.private_fee);
    const retainer = retainerOf(total);
    return {
      ...f,
      sharing_fee: f.private_fee,
      total,
      retainer,
      balance: cents(total - retainer),
      ...(f.second_payment === undefined ? {} : laterPayments(total, retainer)),
    };
  }
  const offered = f.tick_boxes ?? [];
  const picked = new Set<string>();
  for (const id of extras) {
    if (typeof id !== 'string' || picked.has(id) || !offered.some((t) => t.id === id)) throw new BookingError('bad_extras', 'extras');
    picked.add(id);
  }
  // Tick box order, whatever the order they came in.
  const ticked = offered.filter((t) => picked.has(t.id));
  const priced = ticked.filter((t) => t.kind === 'price');
  const deposits = ticked
    .filter((t) => t.kind === 'deposit')
    .map((t) => ({ id: t.id, label: t.deposit_label as string, amount: t.amount, note: t.deposit_note as string }));
  const fee = choice === 'private' ? f.private_fee : undefined;
  const total = cents(f.total + priced.reduce((sum, t) => sum + t.amount, 0) + (fee ?? 0));
  const retainer = retainerOf(total);
  return {
    ...f,
    add_ons: [...f.add_ons, ...priced.map((t) => ({ id: t.id, label: t.label, qty: 1, unit_price: t.amount, line_total: cents(t.amount) }))],
    total,
    retainer,
    balance: cents(total - retainer),
    ...(f.second_payment === undefined ? {} : laterPayments(total, retainer)),
    ...(fee === undefined ? {} : { sharing_fee: fee }),
    extras: ticked.map((t) => t.id),
    ...(deposits.length === 0 ? {} : { deposits }),
  };
}

// ---------------------------------------------------------------- rendering

// The retainer tag comes from the BOOKED facts, at their frozen percent: a set retainer that happens to
// equal the usual share of one mix's total stays a set retainer (clause 3.16) in every mix.
const activeTags = (pkg: PackageFacts, choice: Choice, booked: BookingFacts): Set<string> => {
  const retainerTag = booked.retainer === usualRetainer(booked.total, retainerPercentOf(booked)) ? 'RET-USUAL' : 'RET-SET';
  // Stored bookings made before balance_cash existed have none: they read as false.
  const balanceTag = booked.balance_cash === true ? 'BAL-CASH' : 'BAL-ANY';
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
 * The two payments after the retainer of a booking paid in three parts (made before 2026-11-23), as label
 * and sentence, or null for a booking without them (every booking made since). The summaries of such a
 * booking, the page after signing and the review step use these words.
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
  // A booking paid in three parts was made before 2026-11-23: its texts are stored and never made again.
  if (f.second_payment !== undefined) throw new Error(`booking ${f.number} is paid in three parts: its texts are stored, no new one is made`);
  if (pkg.balanceRowLabel === undefined) throw new Error(`package ${pkg.name} has no balance row label`);
  return [[pkg.balanceRowLabel, f.balance_cash === true ? `${money(f.balance)} in cash` : `${money(f.balance)} by e-transfer or cash`]];
};

/** One row per ticked deposit, after the payment rows: its label, and its package row text with PRICE. */
const depositRows = (f: BookingFacts, ticks: ResolvedTick[]): string[][] =>
  (f.deposits ?? []).map((d) => {
    const t = ticks.find((x) => x.id === d.id);
    if (!t || !t.deposit) throw new Error(`booking ${f.number}: deposit ${d.id} is not a deposit tick box of its package`);
    return [d.label, fill(t.deposit.row, { PRICE: money(d.amount) })];
  });

/** The section 1 row of the fee for private work. page.ts uses the same words for its price line. */
export const MARKETING_FEE_LABEL = 'Marketing fee for private work';

/** PRIVATE_FEE for the sharing row and the option labels, only for a booking with a fee. */
const feeValues = (f: BookingFacts): Record<string, string> => (f.private_fee === undefined ? {} : { PRIVATE_FEE: money(f.private_fee) });

/** 1 -> '1 hour', 10 -> '10 hours'. page.ts uses it too. */
export const hoursText = (n: number) => `${n} ${n === 1 ? 'hour' : 'hours'}`;

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

const bookingRows = (f: BookingFacts, pkg: PackageFacts, choice: Choice, ticks: ResolvedTick[]): string[][] => {
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
    ['Sharing choice (section 15)', fill(pkg.sharing[choice].row, feeValues(f))],
    ...(f.sharing_fee === undefined ? [] : [[MARKETING_FEE_LABEL, money(f.sharing_fee)]]),
    ['Total', money(f.total)],
    ['Retainer, due at signing', `${money(f.retainer)} by e-transfer`],
    ...paymentRows(f, pkg),
    ...depositRows(f, ticks),
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
    const vals = { ...(r.id === null && r.price === undefined ? {} : { PRICE: money(rowPrice(pkg, r)) }), OT_BLOCK: money(pkg.overtimeBlock) };
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

/** Everything one mix's sections are rendered from. */
interface Prepared {
  pkg: PackageFacts;
  choice: Choice;
  facts: BookingFacts; // the amounts of this mix
  active: Set<string>;
  vals: Record<string, string>;
  ticks: ResolvedTick[];
}

const prepare = (booked: BookingFacts, choice: Choice, extras: string[]): Prepared => {
  const pkg = packageFacts(booked.package_id);
  checkPackage(pkg);
  const fee = feeOf(pkg, booked);
  // The amounts of this mix: a fee for private work and ticked priced extras give a larger total.
  const facts = factsFor(booked, choice, extras);
  const ticks = ticksAgree(pkg, booked);
  const active = activeTags(pkg, choice, booked);
  const vals: Record<string, string> = {
    CLIENT_NAME: facts.client_name,
    CLIENT_EMAIL: facts.client_email,
    CLIENT_PHONE: facts.client_phone,
    PARTNER_NAME: facts.partner_name,
    BUSINESS_LEGAL_NAME: BUSINESS.legalName,
    BOOKING_ID: facts.number,
    PACKAGE_NAME: pkg.name,
    // Frozen with the booking, never today's business setting.
    ETRANSFER_EMAIL: etransferEmailOf(booked),
    DELIVERY_PROMISE: pkg.deliveryPromise,
    RETAINER: money(facts.retainer),
    ...otValues(pkg),
    ...engagementValues(pkg),
    ...(fee === undefined ? {} : { PRIVACY_FEE: money(fee) }),
  };
  return { pkg, choice, facts, active, vals, ticks };
};

type DocSection = AgreementDoc['sections'][number];

/**
 * One section of one mix. tokensBefore = sign date tokens in the sections before it: a second token
 * anywhere throws at the clause that holds it, as when the whole document is rendered in one go.
 */
const renderSection = (sec: SourceSection, p: Prepared, tokensBefore: number): { section: DocSection; tokens: number } => {
  const items: DocItem[] = [];
  let k = 0;
  let signDateTokens = tokensBefore;
  for (const it of sec.items) {
    if (it.type === 'block') {
      const name = (it as { name: string }).name;
      if (name === 'TABLE:BOOKING') items.push({ type: 'table', kind: 'booking', rows: bookingRows(p.facts, p.pkg, p.choice, p.ticks), bold: ['Total'] });
      else if (name === 'TABLE:ADDONS') items.push({ type: 'table', kind: 'addons', rows: addOnTableRows(p.pkg), bold: [] });
      else if (name === 'LIST:DELIVERABLES') items.push({ type: 'list', items: [...p.pkg.deliverables] });
      else throw new Error(`unknown block ${name} in section ${sec.num}`);
      continue;
    }
    if (!isVisible(it, p.active)) continue;
    k += 1;
    const text = fill(it.text, p.vals);
    const bullets = it.bullets.map((b) => fill(b, p.vals));
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
  return { section: { num: sec.num, title: sec.title, items }, tokens: signDateTokens - tokensBefore };
};

/** The document around its sections. Key order is part of the exact text. */
const docOf = (p: Prepared, sections: DocSection[]): AgreementDoc => ({
  title: CLAUSES.title,
  intro: CLAUSES.intro,
  clause_version: CLAUSES.version,
  choice: p.choice,
  number: p.facts.number,
  sections,
  business_signature: `Signed for ${BUSINESS.legalName}, operating as AD Photography and KashKlicks, on ${shortDate(new Date(p.facts.created_at))}`,
});

/** The document of one mix: a sharing choice plus the extras ticked at signing (nothing ticked by default). */
export function renderVariant(booked: BookingFacts, choice: Choice, extras: string[] = []): AgreementDoc {
  const p = prepare(booked, choice, extras);
  let tokens = 0;
  const sections = CLAUSES.sections.map((sec) => {
    const r = renderSection(sec, p, tokens);
    tokens += r.tokens;
    return r.section;
  });
  return docOf(p, sections);
}

const SECTIONS_OPEN = '"sections":[';

/** Exact split: JSON.stringify(doc) === head + sections.join(',') + tail. Throws if that is ever not true. */
export function docFragments(doc: AgreementDoc): { head: string; sections: string[]; tail: string } {
  const json = JSON.stringify(doc);
  const at = json.indexOf(SECTIONS_OPEN);
  const sections = doc.sections.map((s) => JSON.stringify(s));
  const head = json.slice(0, at + SECTIONS_OPEN.length);
  const tail = json.slice(head.length + sections.join(',').length);
  if (at < 0 || at !== json.lastIndexOf(SECTIONS_OPEN) || !tail.startsWith(']') || head + sections.join(',') + tail !== json)
    throw new Error(`document ${doc.number}: its text does not split into head, sections and tail`);
  return { head, sections, tail };
}

/** head and tail of a mix's document without rendering or joining its sections: cut around "sections":[]. */
const shellFragments = (p: Prepared): { head: string; tail: string } => {
  const json = JSON.stringify(docOf(p, []));
  const at = json.indexOf(`${SECTIONS_OPEN}]`);
  if (at < 0 || at !== json.lastIndexOf(SECTIONS_OPEN)) throw new Error(`document ${p.facts.number}: no single place for its sections`);
  return { head: json.slice(0, at + SECTIONS_OPEN.length), tail: json.slice(at + SECTIONS_OPEN.length) };
};

/**
 * Every mix of a booking: all subsets of facts.tick_boxes (tick box order) times share, private. Share
 * mixes first, subsets in binary order of the tick box list (none, 1st, 2nd, 1st+2nd, 3rd, ...), then
 * the private mixes in the same order. `share` and `private` always exist.
 */
export function mixesOf(booked: BookingFacts): { id: string; choice: Choice; extras: string[] }[] {
  const ids = (booked.tick_boxes ?? []).map((t) => t.id);
  if (ids.length > 3) throw new Error(`booking ${booked.number}: more than 3 tick boxes`);
  // Mix ids join the tick box ids with +: only plain, distinct ids give one id per mix.
  ids.forEach((id, i) => {
    if (typeof id !== 'string' || !TICK_ID_RE.test(id)) throw new Error(`booking ${booked.number}: tick box ${String(id)}: an id may use only a to z, 0 to 9 and hyphens`);
    if (ids.indexOf(id) !== i) throw new Error(`booking ${booked.number}: tick box ${id} twice`);
  });
  const subsets: string[][] = [];
  for (let mask = 0; mask < 1 << ids.length; mask += 1) subsets.push(ids.filter((_, i) => (mask & (1 << i)) !== 0));
  return (['share', 'private'] as const).flatMap((choice) => subsets.map((extras) => ({ id: mixId(choice, extras), choice, extras })));
}

const hasBookingTable = (sec: SourceSection) => sec.items.some((it) => it.type === 'block' && (it as SourceBlock).name === 'TABLE:BOOKING');

/** The placeholder names used by the clauses (text and bullets) of a section that these tags show, sorted. */
const visiblePlaceholders = (sec: SourceSection, active: Set<string>): string[] => {
  const names = new Set<string>();
  for (const it of sec.items) {
    if (it.type !== 'clause' || !isVisible(it, active)) continue;
    for (const s of [it.text, ...it.bullets]) for (const n of placeholderNames(s)) names.add(n);
  }
  return [...names].sort();
};

/**
 * All finished documents of a booking as a pool of unique fragments (exact JSON text) plus one index
 * list per mix: f = [head, the 23 sections in document order, tail]. docJsonFromSet(pool, f) gives
 * exactly JSON.stringify(renderVariant(booked, choice, extras)).
 * A section is rendered again only when something it is made from changes: the memo key is the section,
 * the active tags, the sign date tokens before it and the values of the placeholders its visible clauses
 * use (the deliverables list and the add-on table depend on the package only). A section with the
 * booking table is rendered for every mix. The memo lives inside this call only. stats.sectionRenders
 * counts the real section renders.
 */
export function buildVariantSet(
  booked: BookingFacts,
  stats?: { sectionRenders: number },
): { pool: string[]; mixes: { id: string; choice: Choice; extras: string[]; f: number[] }[] } {
  const pool: string[] = [];
  const at = new Map<string, number>();
  const intern = (s: string): number => {
    let i = at.get(s);
    if (i === undefined) {
      i = pool.length;
      pool.push(s);
      at.set(s, i);
    }
    return i;
  };
  // Memo key parts: a small id per set of active tags, and the placeholder names per section and tag set.
  const tagIds = new Map<string, number>();
  const names = new Map<string, string[]>();
  const rendered = new Map<string, { at: number; tokens: number }>(); // at = index of the fragment in the pool
  const render = (sec: SourceSection, p: Prepared, tokensBefore: number) => {
    if (stats) stats.sectionRenders += 1;
    const r = renderSection(sec, p, tokensBefore);
    return { at: intern(JSON.stringify(r.section)), tokens: r.tokens };
  };

  const mixes = mixesOf(booked).map((m) => {
    const p = prepare(booked, m.choice, m.extras);
    const tags = [...p.active].sort().join(' ');
    let tagId = tagIds.get(tags);
    if (tagId === undefined) {
      tagId = tagIds.size;
      tagIds.set(tags, tagId);
    }
    const shell = shellFragments(p);
    const f = [intern(shell.head)];
    let tokens = 0;
    CLAUSES.sections.forEach((sec, index) => {
      let r: { at: number; tokens: number } | undefined;
      if (hasBookingTable(sec)) r = render(sec, p, tokens);
      else {
        const namesKey = `${index}|${tagId}`;
        let used = names.get(namesKey);
        if (!used) {
          used = visiblePlaceholders(sec, p.active);
          names.set(namesKey, used);
        }
        const key = `${namesKey}|${tokens}|${JSON.stringify(used.map((n) => (Object.hasOwn(p.vals, n) ? p.vals[n] : null)))}`;
        r = rendered.get(key);
        if (!r) {
          r = render(sec, p, tokens);
          rendered.set(key, r);
        }
      }
      tokens += r.tokens;
      f.push(r.at);
    });
    f.push(intern(shell.tail));
    return { id: m.id, choice: m.choice, extras: m.extras, f };
  });
  return { pool, mixes };
}

/**
 * For page.ts (server side, only when the link is made): the package facts the page text of a booking
 * needs, read live from the data files. The facts are checked against the package as renderVariant does.
 * secondAdded: second photographer hours added on top of the package (missing for a package without one).
 * tickPrice: the price text of each offered tick box, its add-on row's priceText filled.
 */
export function pageFacts(f: BookingFacts): {
  ot: Record<string, string>;
  engagement: Record<string, string>;
  secondAdded?: number;
  tickPrice: Record<string, string>;
  sitePrice: (id: string) => string;
} {
  const pkg = packageFacts(f.package_id);
  checkPackage(pkg);
  feeOf(pkg, f);
  const ticks = ticksAgree(pkg, f);
  const tickPrice: Record<string, string> = {};
  for (const t of f.tick_boxes ?? []) {
    const row = ticks.find((x) => x.id === t.id)!.row;
    tickPrice[t.id] = fill(row.priceText, { PRICE: money(t.amount), OT_BLOCK: money(pkg.overtimeBlock) });
  }
  const sp = pkg.secondPhotographer;
  return {
    ot: otValues(pkg),
    engagement: engagementValues(pkg),
    ...(sp === undefined ? {} : { secondAdded: f.add_ons.find((a) => a.id === sp.addOnId)?.qty ?? 0 }),
    tickPrice,
    sitePrice: (id: string) => money(siteAddOn(id).price as number),
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
  feeOf(pkg, facts);
  // The only names a label may use. Anything else, or a {{ left over (the sign date), throws.
  const vals = { CLIENT_FIRST: facts.client_name.trim().split(/\s+/)[0] ?? '', PARTNER_NAME: facts.partner_name, ...feeValues(facts) };
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
