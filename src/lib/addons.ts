// Shared add-on resolution, formatting and totalling.
// Used by PackageAddOns.astro (build time) and the pricing configurator (client).
import addOnsData from '../data/add-ons.json';

export type AddOnUnit =
  | 'flat' | 'per-hour' | 'per-image' | 'per-item' | 'per-roll'
  | 'per-person' | 'per-year' | 'deposit' | 'quote' | 'at-cost'
  | 'included' | 'percent';

export interface AddOn {
  id: string;
  label: string;
  price: number | null;
  unit: AddOnUnit;
  categories: string[];
  max?: number;
  note?: string;
  refundable?: boolean;
  status?: 'locked' | 'proposed';
  source?: string;
}

export const ADD_ONS = addOnsData as AddOn[];
const BY_ID = new Map(ADD_ONS.map((a) => [a.id, a]));

export const getAddOn = (id: string): AddOn | undefined => BY_ID.get(id);

/** Units that are countable, so the picker shows a stepper rather than a toggle. */
const COUNTABLE: AddOnUnit[] = ['per-hour', 'per-image', 'per-item', 'per-roll', 'per-person', 'per-year'];
export const isCountable = (a: AddOn) => COUNTABLE.includes(a.unit);

/** A deposit is refunded, and a quote or pass-through has no number, so none of them total. */
export const countsTowardTotal = (a: AddOn) =>
  typeof a.price === 'number' && a.price > 0 && !['deposit', 'quote', 'at-cost', 'included'].includes(a.unit);

const money = (n: number) =>
  `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Customer facing one liner. No dashes anywhere, per the copy rule. */
export function formatAddOn(a: AddOn): string {
  const p = typeof a.price === 'number' ? money(a.price) : null;
  switch (a.unit) {
    case 'quote':       return `${a.label}, quoted for you`;
    case 'at-cost':     return p ? `${a.label}, at cost from ${p}` : `${a.label}, charged at cost`;
    case 'included':    return `${a.label}, included`;
    case 'deposit':     return `${a.label} ${p} refundable deposit`;
    case 'per-hour':    return `${a.label} ${p} per hour`;
    case 'per-person':  return `${a.label} ${p} per person`;
    case 'per-year':    return `${a.label} ${p} per year`;
    case 'per-image':
    case 'per-item':
    case 'per-roll':    return `${a.label} ${p} each`;
    case 'percent':     return `${a.label} ${a.price}% off`;
    default:            return `${a.label} ${p}`;
  }
}

/** Resolve the add-ons offered by a set of packages, in catalogue order, deduplicated. */
export function resolveAddOns(
  packages: Array<{ addOnIds?: string[]; category?: string }>,
  filterByCategory?: string
): AddOn[] {
  const pool = filterByCategory ? packages.filter((p) => p.category === filterByCategory) : packages;
  const ids = new Set(pool.flatMap((p) => p.addOnIds ?? []));
  return ADD_ONS.filter((a) => ids.has(a.id));
}

export interface Selection { id: string; qty?: number }

export interface Totals {
  /** What they will actually pay, add-ons only. */
  addOnsTotal: number;
  /** Shown separately because it comes back to them. */
  depositsHeld: number;
  /** Things with no number, surfaced as "I will quote this". */
  quoted: AddOn[];
  /** Pass-through costs set by someone else. */
  atCost: AddOn[];
}

export function totalAddOns(selections: Selection[]): Totals {
  const t: Totals = { addOnsTotal: 0, depositsHeld: 0, quoted: [], atCost: [] };
  for (const s of selections) {
    const a = BY_ID.get(s.id);
    if (!a) continue;
    const qty = isCountable(a) ? Math.max(1, Math.min(s.qty ?? 1, a.max ?? Infinity)) : 1;
    if (a.unit === 'quote') { t.quoted.push(a); continue; }
    if (a.unit === 'at-cost') { t.atCost.push(a); continue; }
    if (a.unit === 'deposit') { t.depositsHeld += (a.price ?? 0) * qty; continue; }
    if (countsTowardTotal(a)) t.addOnsTotal += (a.price as number) * qty;
  }
  return t;
}

export interface PricedPackage {
  price: number | null;
  salePrice?: number | null;
  /** The number is an hourly rate, so it is never a package total. */
  priceIsRate?: boolean;
  /** The number is a floor they will spend at least, so it totals but reads "from". */
  priceIsMinimum?: boolean;
}

/** Base price for a package, honouring the sale price and never treating a rate as a total. */
export function basePrice(pkg: PricedPackage): number | null {
  if (pkg.priceIsRate) return null;
  return pkg.salePrice ?? pkg.price ?? null;
}

/** How the number should read: a firm price, a floor, an hourly rate, or nothing at all. */
export function priceQualifier(pkg: PricedPackage): 'firm' | 'from' | 'rate' | 'none' {
  if (pkg.priceIsRate) return 'rate';
  if (pkg.priceIsMinimum) return 'from';
  return basePrice(pkg) === null ? 'none' : 'firm';
}

/**
 * Some packages only make sense for certain regions, e.g. the destination weekend.
 * They carry a `regions` list matching the contact form's event_region values
 * (toronto-gta / ontario / canada / international). Anywhere the visitor's region
 * is unknown, such as the standard service pages, they must stay hidden.
 */
export const isRegionGated = (pkg: { regions?: string[] }) => Array.isArray(pkg.regions);

export const visibleInRegion = (pkg: { regions?: string[] }, region?: string) =>
  !isRegionGated(pkg) || (!!region && pkg.regions!.includes(region));

/** Only the price part of an add-on, for a two column row: label left, price right. */
export function addOnPriceText(a: AddOn): string {
  const p = typeof a.price === 'number' ? money(a.price) : null;
  switch (a.unit) {
    case 'quote':       return 'quoted';
    case 'at-cost':     return p ? `at cost, from ${p}` : 'at cost';
    case 'included':    return 'included';
    case 'deposit':     return `${p} refundable deposit`;
    case 'per-hour':    return `${p} per hour`;
    case 'per-person':  return `${p} per person`;
    case 'per-year':    return `${p} per year`;
    case 'per-image':
    case 'per-item':
    case 'per-roll':    return `${p} each`;
    case 'percent':     return `${a.price}% off`;
    default:            return p ?? '';
  }
}

/**
 * Split a page's add-ons into three tiers, all in add-ons.json order, so
 * packages.json addOnIds stays the only source:
 *   general      in every package on the page (the shared list under the cards)
 *   groupShared  per group of 2+ packages (groupBy), in every package of that
 *                group but not general (a sub block of the shared list)
 *   specific     the rest, per package (inside that package's card)
 * Packages with no addOnIds, such as "Make It Yours", are ignored. Without
 * groupBy there is one group, so groupShared is empty.
 */
export function splitAddOns<P extends { id: string; addOnIds?: string[] }>(
  packages: P[],
  opts: { groupBy?: (p: P) => string } = {}
): { general: AddOn[]; groupShared: Map<string, AddOn[]>; specific: Map<string, AddOn[]> } {
  const pool = packages.filter((p) => (p.addOnIds?.length ?? 0) > 0);
  const inAll = (list: P[]) => {
    const sets = list.map((p) => new Set(p.addOnIds));
    return (id: string) => sets.length > 0 && sets.every((s) => s.has(id));
  };
  const isGeneral = inAll(pool);
  const general = ADD_ONS.filter((a) => isGeneral(a.id));

  const groups = new Map<string, P[]>();
  if (opts.groupBy) {
    for (const p of pool) {
      const k = opts.groupBy(p);
      groups.set(k, [...(groups.get(k) ?? []), p]);
    }
  }
  const groupShared = new Map<string, AddOn[]>();
  const groupTest = new Map<string, (id: string) => boolean>();
  for (const [k, members] of groups) {
    if (members.length < 2) continue;
    const test = inAll(members);
    const shared = ADD_ONS.filter((a) => test(a.id) && !isGeneral(a.id));
    if (shared.length) {
      groupShared.set(k, shared);
      groupTest.set(k, test);
    }
  }

  const specific = new Map<string, AddOn[]>();
  for (const p of pool) {
    const ids = new Set(p.addOnIds);
    const inGroup = opts.groupBy ? groupTest.get(opts.groupBy(p)) : undefined;
    specific.set(p.id, ADD_ONS.filter((a) => ids.has(a.id) && !isGeneral(a.id) && !(inGroup && inGroup(a.id))));
  }
  return { general, groupShared, specific };
}

export interface CardAddOn { id: string; label: string; priceText: string; note?: string }

/** The shape PricingCard's addOns prop takes. */
export const toCardAddOns = (list: AddOn[] = []): CardAddOn[] =>
  list.map((a) => ({ id: a.id, label: a.label, priceText: addOnPriceText(a), note: a.note }));
