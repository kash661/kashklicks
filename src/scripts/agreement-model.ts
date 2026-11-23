// One model of an unsigned booking, from either shape of the doc answer:
// - a booking made before sets: two full texts in `variants` (share, private), nothing to tick;
// - a booking with a set: a pool of exact text fragments plus one index list, hash and summary per mix.
// `hasSet` decides only where documents, hashes and summaries come from. `hasPage` (the answer carries
// page content) decides the layout. Everything is checked and rendered here, before anything is shown:
// if one piece is wrong the whole build throws, and the page shows the error view.
//
// Same import rule as agreement.ts: html.ts, hash.ts, token.ts, format.ts, set.ts, parts.ts and types only.
import { PARTS } from '../lib/agreement/parts';
import { docJsonFromSet, mixId } from '../lib/agreement/set';
import type { AgreementDoc, Choice, PageContent, StoredSummary } from '../lib/agreement/types';
import { CHOICES, bothVersions, frameOf, panelSectionHtml, undecidedCopy, type Section } from './agreement-doc';

export interface Labels {
  share_option: string;
  private_option: string;
  agree_label: string;
  intro_bullets: string[];
  after_signing: { title: string; text: string };
  name_expected: string;
}
export interface Base {
  ok: true;
  mode: 'test' | 'live';
  number: string;
  client_first: string;
  partner_first: string;
  client_name: string;
  partner_name: string;
  labels: Labels;
  summary: StoredSummary;
}
export interface StoredMix {
  f: number[];
  hash: string;
  summary: StoredSummary;
}
export interface ReadyPayload extends Base {
  status: 'sent' | 'opened';
  today: string;
  summary_private?: StoredSummary; // only a booking with a fee for private work
  variants?: Record<Choice, { doc_json: string; hash: string }>; // only a booking made before sets
  set?: { pool: string[]; mixes: Record<string, StoredMix> }; // only with v=2, a booking with a set
  page?: PageContent; // only with v=2, a booking whose package has page content
}

export type Tick = PageContent['extras']['ticks'][number];
export type Part = PageContent['parts'][number];

/** One mix as the page uses it. */
export interface Mix {
  id: string;
  doc_json: string; // the exact string that is hashed and signed
  hash: string; // the server's hash of it (used only without WebCrypto)
  summary: StoredSummary;
  /** Part number to the number of numbered clauses in that part's sections of this document. */
  counts: Map<number, number>;
  /** Section number to the section as a part panel shows it once this mix is chosen. */
  sections: Map<number, string>;
}

export interface Model {
  hasSet: boolean;
  hasPage: boolean;
  page: PageContent | null;
  /** The tick boxes the page offers (page.extras.ticks with a set and page content, else none), in tick box order. */
  ticks: Tick[];
  /** The 7 parts: frozen with the booking when it has page content, else PARTS. */
  parts: Part[];
  /** Section numbers in document order. */
  order: number[];
  title: string;
  intro: string;
  business_signature: string;
  /** The mix of a choice and ticked ids (in tick box order). Every reachable mix exists. */
  mix(choice: Choice, ids: readonly string[]): Mix;
  /** Section number to the section as a panel shows it before a sharing choice, for these ticked ids. */
  undecided(ids: readonly string[]): Map<number, string>;
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isFull = (v: unknown): v is string => typeof v === 'string' && v !== '';
const strList = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const fail = (what: string): never => {
  throw new Error(`agreement page: ${what}`);
};
/** A list of objects whose given keys are all strings. */
const rowsOk = (v: unknown, keys: string[]): boolean => Array.isArray(v) && v.every((r) => isObj(r) && keys.every((k) => isStr(r[k])));

/** The page content as stored, checked field by field. Anything off throws. */
function checkPage(v: Record<string, any>): PageContent {
  const ok =
    isStr(v.title) &&
    strList(v.lede) &&
    rowsOk(v.glance, ['label', 'value']) &&
    isStr(v.note) &&
    Array.isArray(v.parts) &&
    v.parts.length === PARTS.length &&
    v.parts.every(
      (p: any, i: number) =>
        isObj(p) && p.n === i + 1 && isStr(p.title) && Array.isArray(p.sections) && p.sections.every(Number.isInteger) && strList(p.points),
    ) &&
    isObj(v.extras) &&
    isStr(v.extras.intro) &&
    isStr(v.extras.booked_title) &&
    strList(v.extras.booked) &&
    rowsOk(v.extras.ticks, ['id', 'kind', 'label', 'price', 'blurb']) &&
    isStr(v.extras.more_title) &&
    strList(v.extras.more) &&
    isObj(v.sharing) &&
    isStr(v.sharing.legend) &&
    strList(v.sharing.points);
  if (!ok) fail('page content is malformed');
  const ids = (v.extras.ticks as Tick[]).map((t) => t.id);
  // A mix id joins tick ids with +: only plain, distinct ids give one id per mix.
  if (ids.length > 3 || ids.some((id) => !/^[a-z0-9-]+$/.test(id)) || new Set(ids).size !== ids.length) fail('tick boxes are malformed');
  return v as PageContent;
}

/** A summary the page can show for a reachable mix. Anything it needs that is missing throws. */
function checkSummary(s: unknown, hasPage: boolean, id: string): StoredSummary {
  if (!isObj(s)) return fail(`mix ${id} has no summary`);
  const ok =
    ['package', 'date', 'total', 'retainer'].every((k) => isFull(s[k])) &&
    (!hasPage ||
      (isStr(s.total_line) &&
        Array.isArray(s.price_lines) &&
        s.price_lines.length > 0 &&
        rowsOk(s.price_lines, ['label', 'amount']) &&
        Array.isArray(s.steps) &&
        s.steps.length > 0 &&
        rowsOk(s.steps, ['title', 'amount', 'note']))) &&
    (s.later_payments === undefined || rowsOk(s.later_payments, ['label', 'text'])) &&
    // Without page content part 3 shows the balance when there are no later payments.
    (hasPage || (Array.isArray(s.later_payments) && s.later_payments.length > 0) || isFull(s.balance)) &&
    (s.deposit === undefined || rowsOk([s.deposit], ['label', 'amount', 'note'])) &&
    (s.extra_labels === undefined || strList(s.extra_labels));
  if (!ok) fail(`mix ${id} has a broken summary`);
  return s as StoredSummary;
}

/** Every subset of the tick ids, in tick box order (none, 1st, 2nd, 1st+2nd, ...). */
const subsetsOf = (ids: string[]): string[][] => {
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << ids.length; mask += 1) out.push(ids.filter((_, i) => (mask & (1 << i)) !== 0));
  return out;
};

interface RawMix {
  id: string;
  doc_json: string;
  hash: string;
  summary: unknown;
  doc: AgreementDoc;
  keys: string[]; // fragment key of each section, in document order
}

/** Builds the whole model or throws. signDateText is put where the sign date will be (the page shows today's date). */
export function buildModel(p: ReadyPayload, signDateText: string): Model {
  const hasSet = p.set !== undefined;
  const hasPage = p.page !== undefined;
  if (hasSet && !isObj(p.set)) fail('the set is malformed');
  if (hasPage && !isObj(p.page)) fail('the page content is malformed');
  const page = hasPage ? checkPage(p.page as Record<string, any>) : null;
  const ticks: Tick[] = hasSet && page ? page.extras.ticks : [];
  const parts: Part[] = page ? page.parts : PARTS.map((x) => ({ n: x.n, title: x.title, sections: [...x.sections], points: [] }));

  // 1. Every mix: rebuild its text and parse it. Keep each section by the fragment it came from.
  const raw = new Map<string, RawMix>();
  const fragments = new Map<string, Section>(); // fragment key -> the section
  if (hasSet) {
    const { pool, mixes } = p.set as { pool: unknown; mixes: unknown };
    if (!Array.isArray(pool) || !isObj(mixes)) fail('the set is malformed');
    for (const id of Object.keys(mixes as object)) {
      const m = (mixes as Record<string, unknown>)[id];
      if (!isObj(m) || !Array.isArray(m.f) || !isStr(m.hash)) fail(`mix ${id} is malformed`);
      const mix = m as StoredMix;
      const doc_json = docJsonFromSet(pool as string[], mix.f);
      const doc = JSON.parse(doc_json) as AgreementDoc;
      const inner = mix.f.slice(1, -1);
      // Each section fragment is one whole JSON value, so the document holds exactly these sections.
      if (!Array.isArray(doc.sections) || doc.sections.length !== inner.length) fail(`mix ${id} does not split into its sections`);
      const keys = inner.map((i, j) => {
        const key = `p${i}`;
        if (!fragments.has(key)) fragments.set(key, JSON.parse((pool as string[])[i]) as Section);
        if (fragments.get(key)!.num !== doc.sections[j].num) fail(`mix ${id} does not split into its sections`);
        return key;
      });
      raw.set(id, { id, doc_json, hash: mix.hash, summary: mix.summary, doc, keys });
    }
  } else {
    for (const c of CHOICES) {
      const v = p.variants?.[c];
      if (!isObj(v) || !isStr(v.doc_json) || !isStr(v.hash)) fail(`no ${c} text`);
      const doc = JSON.parse(v!.doc_json) as AgreementDoc;
      if (!Array.isArray(doc.sections)) fail(`the ${c} text has no sections`);
      const keys = doc.sections.map((s, j) => {
        const key = `${c}:${j}`;
        fragments.set(key, s);
        return key;
      });
      // A booking made before sets: the private amounts are summary_private when it has a fee.
      const summary = c === 'private' ? (p.summary_private ?? p.summary) : p.summary;
      raw.set(c, { id: c, doc_json: v!.doc_json, hash: v!.hash, summary, doc, keys });
    }
  }
  if (!raw.size) fail('no texts');

  // 2. All documents share the frame that is shown once.
  const first = raw.values().next().value as RawMix;
  const frame = frameOf(first.doc);
  for (const m of raw.values()) if (frameOf(m.doc) !== frame) fail(`mix ${m.id} differs outside its sections`);
  const order = first.doc.sections.map((s) => s.num);

  // 3. The parts cover every section of the document exactly once.
  const inParts = parts.flatMap((x) => x.sections);
  if (inParts.length !== order.length || new Set(inParts).size !== inParts.length || !inParts.every((n) => order.includes(n)))
    fail('the parts do not cover the document');

  // 4. Every section fragment renders once, now: later renders only pick from these strings.
  const html = new Map<string, string>();
  const masked = new Map<string, string>(); // the panel HTML with the sharing row undecided
  for (const [key, sec] of fragments) {
    const h = panelSectionHtml(sec, signDateText);
    html.set(key, h);
    const copy = undecidedCopy(sec);
    masked.set(key, copy ? panelSectionHtml(copy, signDateText) : h);
  }

  // 5. Every mix the controls can reach exists and can be shown.
  const tickIds = ticks.map((t) => t.id);
  const ready = new Map<string, Mix>();
  const subsets = subsetsOf(tickIds);
  for (const c of CHOICES)
    for (const ids of subsets) {
      const id = hasSet ? mixId(c, ids) : c;
      const m = raw.get(id);
      if (!m) return fail(`mix ${id} is missing`);
      const summary = checkSummary(m.summary, hasPage, id);
      const byNum = new Map(m.doc.sections.map((s, j) => [s.num, { sec: s, key: m.keys[j] }]));
      const counts = new Map<number, number>();
      for (const part of parts)
        counts.set(
          part.n,
          part.sections.reduce((n, num) => n + byNum.get(num)!.sec.items.filter((it) => it.type === 'clause' && isFull(it.n)).length, 0),
        );
      const sections = new Map(order.map((num) => [num, html.get(byNum.get(num)!.key)!]));
      ready.set(mixId(c, ids), { id, doc_json: m.doc_json, hash: m.hash, summary, counts, sections });
    }

  // 6. Before a choice, for each set of ticks: a section that reads the same both ways (sharing row
  //    undecided) shows once; any other shows both versions.
  const both = new Map<string, string>();
  const undecided = new Map<string, Map<number, string>>();
  for (const ids of subsets) {
    const [a, b] = CHOICES.map((c) => raw.get(hasSet ? mixId(c, ids) : c)!);
    const keyOf = (m: RawMix) => new Map(m.doc.sections.map((s, j) => [s.num, m.keys[j]]));
    const ka = keyOf(a);
    const kb = keyOf(b);
    const view = new Map<number, string>();
    for (const num of order) {
      const x = ka.get(num)!;
      const y = kb.get(num)!;
      if (masked.get(x) === masked.get(y)) view.set(num, masked.get(x)!);
      else {
        const pair = `${x}|${y}`;
        if (!both.has(pair)) both.set(pair, bothVersions({ share: html.get(x)!, private: html.get(y)! }));
        view.set(num, both.get(pair)!);
      }
    }
    undecided.set(ids.join('+'), view);
  }

  const canonical = (ids: readonly string[]) => tickIds.filter((id) => ids.includes(id));
  return {
    hasSet,
    hasPage,
    page,
    ticks,
    parts,
    order,
    title: first.doc.title,
    intro: first.doc.intro,
    business_signature: first.doc.business_signature,
    mix(choice, ids) {
      const m = ready.get(mixId(choice, canonical(ids)));
      if (!m) throw new Error(`agreement page: no mix ${mixId(choice, ids as string[])}`);
      return m;
    },
    undecided(ids) {
      return undecided.get(canonical(ids).join('+'))!;
    },
  };
}
