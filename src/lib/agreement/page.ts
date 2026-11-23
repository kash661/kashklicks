// Server side only. The words the new agreement page shows around the legal text (the plain "main
// points" of each part, the glance, the tick boxes), and the amounts of one mix ready to show. Both are
// made when the link is made and stored with the booking: the page never does arithmetic and never builds
// wording. The text lives in src/data/agreement/page.json, read live on each call.
import pageJson from '../../data/agreement/page.json' with { type: 'json' };
import businessJson from '../../data/agreement/business.json' with { type: 'json' };
import { clockTime, longDate, money } from './format';
import { BookingError, MARKETING_FEE_LABEL, factsFor, fill, hoursText, laterPaymentRows, pageFacts } from './render';
import { PARTS } from './parts';
import type { BookingFacts, Choice, PageContent, StoredSummary } from './types';

// Declared in types.ts, so the page script can take it with `import type` without this file.
export type { PageContent };

// The shape of page.json. Any line may carry "when": shown only when that condition holds.
interface Line {
  text: string;
  when?: string;
}
interface PackagePage {
  title: string;
  lede: string[];
  glance: { label: string; value: string; when?: string }[];
  points: Record<string, Line[]>;
  totalLine: string;
  steps: { title: string; amount: string; note: string; when?: string }[];
  extras: { intro: string; bookedTitle: string; ticks: Record<string, string>; moreTitle: string; more: { id?: string; text: string; when?: string }[] };
  sharing: { legend: string; points: string[] };
}
interface PageFile {
  note: string;
  packages: Record<string, PackagePage>;
}
interface Business {
  legalName: string;
  tradeNames: string[];
  phone: string;
  email: string;
  etransferEmail: string;
  whoShoots: string;
}

const PAGE = pageJson as unknown as PageFile;
const BUSINESS = businessJson as unknown as Business;

const pageOf = (f: BookingFacts): PackagePage | null =>
  typeof f.package_id === 'string' && Object.hasOwn(PAGE.packages, f.package_id) ? PAGE.packages[f.package_id] : null;

/** The strict fill of the agreement: an unknown name throws, and nothing may be left (not even the sign date). */
const fillAll = (template: string, vals: Record<string, string>): string => {
  const s = fill(template, vals);
  if (s.includes('{{') || s.includes('}}')) throw new BookingError('unfilled_placeholder', 'page');
  return s;
};

/** The condition of a "when". An unknown condition throws. Always judged on the facts as booked. */
const conditionOf =
  (f: BookingFacts, secondAdded: number | undefined) =>
  (when: string): boolean => {
    if (when === 'notes') return Boolean(f.notes);
    if (when === 'second:all' || when === 'second:base' || when === 'second:part') {
      if (secondAdded === undefined || f.second_hours === undefined) return false;
      // The same three cases as the second photographer row of section 1.
      const which = secondAdded === 0 ? 'second:base' : f.second_hours === f.hours ? 'second:all' : 'second:part';
      return when === which;
    }
    if (when === 'bal:any') return f.balance_cash !== true;
    if (when === 'bal:cash') return f.balance_cash === true;
    if (when === 'fee') return f.private_fee !== undefined;
    if (when.startsWith('tickable:')) return (f.tick_boxes ?? []).some((t) => t.id === when.slice('tickable:'.length));
    if (when.startsWith('booked:')) return f.add_ons.some((a) => a.id === when.slice('booked:'.length));
    // For a "more" line of an add-on that can be booked once only: not offered again once it is booked.
    if (when.startsWith('open:')) return !f.add_ons.some((a) => a.id === when.slice('open:'.length));
    throw new Error(`page text of ${f.package_name}: unknown condition ${when}`);
  };

const keepWhen = <T extends { when?: string }>(lines: T[], holds: (when: string) => boolean): T[] =>
  lines.filter((l) => l.when === undefined || holds(l.when));

/** The placeholders of page text that do not depend on a mix. */
const valuesOf = (f: BookingFacts, pf: ReturnType<typeof pageFacts>): Record<string, string> => {
  const vals: Record<string, string | undefined> = {
    EVENT_DATE: longDate(f.event_date),
    HOURS: hoursText(f.hours),
    START: clockTime(f.start_time),
    END: clockTime(f.end_time),
    PLACE: f.place.replace(/\.+$/, ''),
    // The line is "Also agreed: {{NOTES}}": a note typed without an end mark gets a full stop (section 1 keeps it as typed).
    NOTES: f.notes === '' || /[.!?]['")\]]*$/.test(f.notes) ? f.notes : `${f.notes}.`,
    WHO: BUSINESS.whoShoots,
    SECOND_HOURS: f.second_hours === undefined ? undefined : hoursText(f.second_hours),
    DELIVERY_DATE: longDate(f.delivery_date),
    ...pf.ot,
    ETRANSFER_EMAIL: BUSINESS.etransferEmail,
    ...pf.engagement,
    PRIVATE_FEE: f.private_fee === undefined ? undefined : money(f.private_fee),
    SECOND_DUE: f.second_due === undefined ? undefined : longDate(f.second_due),
    FINAL_DUE: f.final_due === undefined ? undefined : longDate(f.final_due),
    CLIENT_NAME: f.client_name,
    PARTNER_NAME: f.partner_name,
    BUSINESS_LEGAL_NAME: BUSINESS.legalName,
    TRADE_1: BUSINESS.tradeNames[0],
    TRADE_2: BUSINESS.tradeNames[1],
    BUSINESS_PHONE: BUSINESS.phone,
    BUSINESS_EMAIL: BUSINESS.email,
  };
  // A value that does not exist for this booking is left out, so a line that uses it throws.
  return Object.fromEntries(Object.entries(vals).filter((e): e is [string, string] => typeof e[1] === 'string'));
};

/** The page content of a booking, or null when page.json has no text for its package. */
export function pageContent(booked: BookingFacts): PageContent | null {
  const page = pageOf(booked);
  if (!page) return null;
  const pf = pageFacts(booked);
  const vals = valuesOf(booked, pf);
  const holds = conditionOf(booked, pf.secondAdded);
  const text = (t: string) => fillAll(t, vals);
  for (const key of Object.keys(page.points))
    if (!PARTS.some((p) => String(p.n) === key)) throw new Error(`page text of ${booked.package_name}: no part ${key}`);
  return {
    v: 1,
    title: text(page.title),
    lede: page.lede.map(text),
    glance: keepWhen(page.glance, holds).map((g) => ({ label: text(g.label), value: text(g.value) })),
    note: text(PAGE.note),
    parts: PARTS.map((part) => ({
      n: part.n,
      title: part.title,
      sections: [...part.sections],
      points: keepWhen(page.points[String(part.n)] ?? [], holds).map((l) => text(l.text)),
    })),
    extras: {
      intro: text(page.extras.intro),
      booked_title: text(page.extras.bookedTitle),
      // In the wording of the section 1 row "Add-ons chosen at booking".
      booked: booked.add_ons.map((a) => `${a.label}, ${a.qty} × ${money(a.unit_price)} = ${money(a.line_total)}`),
      ticks: (booked.tick_boxes ?? []).map((t) => {
        const blurb = page.extras.ticks[t.id];
        if (typeof blurb !== 'string') throw new Error(`page text of ${booked.package_name}: no blurb for tick box ${t.id}`);
        return { id: t.id, kind: t.kind, label: t.label, price: pf.tickPrice[t.id], blurb: text(blurb) };
      }),
      more_title: text(page.extras.moreTitle),
      more: keepWhen(page.extras.more, holds).map((m) => fillAll(m.text, m.id === undefined ? vals : { ...vals, PRICE: pf.sitePrice(m.id) })),
    },
    sharing: { legend: text(page.sharing.legend), points: page.sharing.points.map(text) },
  };
}

/**
 * The amounts and the amount wording of one mix, ready to show. The fields of today's summary keep
 * today's values and wording for the mix's facts (factsFor). A booking whose package has page content
 * also gets total_line, price_lines and steps, plus deposit and extra_labels when something is ticked.
 */
export function mixSummary(booked: BookingFacts, choice: Choice, extras: string[]): StoredSummary {
  return mixSummaries(booked, [{ choice, extras }])[0];
}

/**
 * mixSummary of every given mix, in order, in one call (the link is made with it). What depends on the
 * booking only (the date, the package checks, the conditions and the page values) is worked out once,
 * the first time a mix needs it, and kept inside this call only. Each mix still goes through factsFor.
 */
export function mixSummaries(booked: BookingFacts, mixes: readonly { choice: Choice; extras: string[] }[]): StoredSummary[] {
  const page = pageOf(booked);
  let date: string | undefined;
  let shared: { holds: (when: string) => boolean; vals: Record<string, string> } | undefined;
  return mixes.map(({ choice, extras }) => {
    const f = factsFor(booked, choice, extras);
    const deposits = f.deposits ?? [];
    if (deposits.length > 1) throw new Error(`booking ${f.number}: more than one deposit is not built yet`);
    const later = laterPaymentRows(f);
    // factsFor never changes the event date, so it is the same for every mix.
    date ??= longDate(f.event_date);
    const summary: StoredSummary = {
      package: f.package_name,
      date,
      total: money(f.total),
      retainer: money(f.retainer),
      balance: money(f.balance),
      balance_how: f.balance_cash === true ? 'in cash' : 'e-transfer or cash',
      etransfer_email: BUSINESS.etransferEmail,
      ...(later ? { later_payments: later } : {}),
    };
    if (!page) return summary;

    if (!shared) {
      const pf = pageFacts(booked);
      shared = { holds: conditionOf(booked, pf.secondAdded), vals: valuesOf(booked, pf) };
    }
    const vals: Record<string, string> = {
      ...shared.vals,
      TOTAL: money(f.total),
      RETAINER: money(f.retainer),
      BALANCE: money(f.balance),
      ...(f.second_payment === undefined ? {} : { SECOND: money(f.second_payment) }),
      ...(f.final_payment === undefined ? {} : { FINAL: money(f.final_payment) }),
    };
    const text = (t: string) => fillAll(t, vals);
    const ticked = (f.extras ?? []).map((id) => {
      const t = (booked.tick_boxes ?? []).find((x) => x.id === id);
      if (!t) throw new Error(`booking ${f.number}: no tick box ${id}`);
      return t.label;
    });
    return {
      ...summary,
      total_line: text(page.totalLine),
      price_lines: [
        { label: f.package_name, amount: money(f.package_price) },
        ...f.add_ons.map((a) => ({ label: a.qty === 1 ? a.label : `${a.label}, ${a.qty} × ${money(a.unit_price)}`, amount: money(a.line_total) })),
        ...(f.sharing_fee === undefined ? [] : [{ label: MARKETING_FEE_LABEL, amount: money(f.sharing_fee) }]),
      ],
      steps: keepWhen(page.steps, shared.holds).map((s) => ({ title: text(s.title), amount: text(s.amount), note: text(s.note) })),
      ...(deposits.length === 0 ? {} : { deposit: { label: deposits[0].label, amount: money(deposits[0].amount), note: deposits[0].note } }),
      ...(ticked.length === 0 ? {} : { extra_labels: ticked }),
    };
  });
}
