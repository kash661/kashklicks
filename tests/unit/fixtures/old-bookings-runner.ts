// Runs the agreement routes on stored booking records and writes down every answer, byte for byte.
// Used twice: by make-old-bookings.mjs (with the code of an older commit, to record what it answered)
// and by agreement-old-bookings.unit.ts (with the code of today, which must answer the same).
// No imports from src: the caller passes the worker functions in. Invented people only.
import { createHash } from 'node:crypto';

/** The two worker functions the scenarios need, from whichever copy of the code is being run. */
export interface WorkerApi {
  handleAgreement: (
    request: Request,
    env: Record<string, unknown>,
    ctx: { waitUntil(p: Promise<unknown>): void },
    deps: { now?: () => Date; fetchImpl?: typeof fetch },
  ) => Promise<Response>;
  copyFields: (env: Record<string, unknown>, signed: any) => Record<string, string>;
}

export const ORIGIN = 'https://agreements-kashklicks.example.workers.dev'; // a preview host: test mode
export const ADMIN = 'admin-secret-for-tests-only';
/** When the records were made, and when every scenario runs (two days later, 11:30 am in Toronto). */
export const MADE_AT = '2026-11-10T15:00:00.000Z';
export const RUN_AT = '2026-11-12T16:30:00.000Z';
const SENT_AT = '2026-11-12T16:30:04.000Z';
// The same stand-in PDF as tests/unit/agreement-worker.unit.ts.
const FAKE_PDF_B64 = btoa(`%PDF-1.4\n${'x'.repeat(1200)}\n%%EOF`);

export type Step =
  | { kind: 'doc'; v?: string }
  // text_hash: the stored hash of the mix `hash_of` names (default: the mix that is signed).
  | { kind: 'sign'; choice: string; extras?: unknown; hash_of?: { choice: string; extras: string[] } }
  | { kind: 'pdf'; c: string; x?: string }
  | { kind: 'resend' };

export interface Scenario {
  name: string;
  record: string; // a key of the fixture's records
  steps: Step[];
}

export interface Observation {
  steps: { request: string; status: number; content_type: string | null; body: unknown }[];
  // Every KV key after the scenario: its value (JSON parsed when it is JSON text), metadata and expiry.
  kv: { key: string; value: unknown; metadata: unknown; ttl: number | null }[];
  d1: unknown[]; // the signed records, parsed
  calls: Record<string, string>[]; // the fields of every Apps Script call, in order
  copy_fields: Record<string, string> | null; // copyFields(env, the signed record), when one exists
}

/** JSON text that JSON.stringify gives back byte for byte; anything else stays text. */
const parsed = (text: string): unknown => {
  try {
    const v = JSON.parse(text);
    if (JSON.stringify(v) === text) return { json: v };
  } catch {
    // not JSON
  }
  return { text };
};

/** The stored hash of one mix: from the set of a newer record, or the two texts of an older one. */
const storedHash = (bk: any, choice: string, extras: string[]): string => {
  if (bk.set) return bk.set.mixes[[choice, ...extras].join('+')]?.hash ?? 'no-such-mix';
  return bk.variants?.[choice]?.hash ?? 'no-such-text';
};

/**
 * Makes one booking record the way the given code made it: POST /r/agreement/new at MADE_AT on an empty
 * test store whose number sequence is at `seq` already. The random token is then swapped for `token`
 * (a fixed fake one of the same shape), so the record holds no real token.
 */
export async function makeRecord(api: Pick<WorkerApi, 'handleAgreement'>, input: Record<string, unknown>, seq: number, token: string): Promise<any> {
  const kv = new Map<string, string>([['agr:test:seq:2026', String(seq)]]);
  const env = {
    AGREEMENTS_KV: { get: async (key: string) => kv.get(key) ?? null, put: async (key: string, value: string) => void kv.set(key, value) },
    AGREEMENTS_DB: { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 1 } }) }) }) },
    FORMS_ADMIN_TOKEN: ADMIN,
  };
  const request = new Request(`${ORIGIN}/r/agreement/new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kk-admin': ADMIN },
    body: JSON.stringify(input),
  });
  const res = await api.handleAgreement(request, env, { waitUntil: () => undefined }, { now: () => new Date(MADE_AT) });
  const answer = (await res.json()) as { ok?: boolean; token?: string; error?: string };
  if (res.status !== 200 || answer.ok !== true || typeof answer.token !== 'string') throw new Error(`new booking refused: ${JSON.stringify(answer)}`);
  const record = JSON.parse(kv.get(`agr:test:bk:${answer.token}`)!);
  return { ...record, token };
}

/** Runs one scenario on a fresh store that holds only the record (and its number key). */
export async function runScenario(api: WorkerApi, record: any, scenario: Scenario): Promise<Observation> {
  const kv = new Map<string, { value: string | Uint8Array; metadata?: unknown; ttl?: number }>();
  kv.set(`agr:${record.mode}:bk:${record.token}`, {
    value: JSON.stringify(record),
    metadata: {
      number: record.number,
      client: record.facts.client_name,
      status: record.status,
      created_at: record.created_at,
      copy_status: record.copy.status,
      copy_attempts: record.copy.attempts,
    },
  });
  kv.set(`agr:${record.mode}:num:${record.number}`, { value: record.token });
  const kvApi = {
    async get(key: string, type?: string) {
      const v = kv.get(key)?.value;
      if (v === undefined) return null;
      const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v;
      if (type === 'arrayBuffer') return bytes.slice().buffer;
      return typeof v === 'string' ? v : new TextDecoder().decode(v);
    },
    async put(key: string, value: string | Uint8Array, opts: { metadata?: unknown; expirationTtl?: number } = {}) {
      kv.set(key, { value: typeof value === 'string' ? value : new Uint8Array(value), metadata: opts.metadata, ttl: opts.expirationTtl });
    },
  };
  const rows: { mode: string; token: string; number: string; record: string }[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind: (...v: string[]) => ({
          async run() {
            const clash = rows.some((r) => r.mode === v[0] && (r.token === v[1] || r.number === v[2]));
            if (!clash) rows.push({ mode: v[0], token: v[1], number: v[2], record: v[5] });
            return { meta: { changes: clash ? 0 : 1 } };
          },
          async first() {
            if (sql.startsWith('SELECT 1')) return rows.some((r) => r.mode === v[0] && r.number === v[1]) ? { 1: 1 } : null;
            const row = rows.find((r) => r.mode === v[0] && r.token === v[1]);
            return row ? { record: row.record } : null;
          },
        }),
      };
    },
  };
  const env = { AGREEMENTS_KV: kvApi, AGREEMENTS_DB: db, FORMS_ADMIN_TOKEN: ADMIN };
  const calls: Record<string, string>[] = [];
  const fetchImpl = (async (_url: unknown, init: RequestInit = {}) => {
    const fields = Object.fromEntries(new URLSearchParams(String(init.body ?? '')));
    calls.push(fields);
    const body = fields.action === 'agreement_pdf' ? { ok: true, pdf_base64: FAKE_PDF_B64 } : { ok: true, sent_at: SENT_AT };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };
  const deps = { now: () => new Date(RUN_AT), fetchImpl };
  const k = record.token;

  const out: Observation = { steps: [], kv: [], d1: [], calls, copy_fields: null };
  for (const step of scenario.steps) {
    let request: Request;
    let label: string;
    if (step.kind === 'doc') {
      label = `GET /r/agreement/doc${step.v === undefined ? '' : `?v=${step.v}`}`;
      request = new Request(`${ORIGIN}/r/agreement/doc?k=${k}${step.v === undefined ? '' : `&v=${step.v}`}`);
    } else if (step.kind === 'pdf') {
      label = `GET /r/agreement/pdf?c=${step.c}${step.x === undefined ? '' : `&x=${step.x}`}`;
      request = new Request(`${ORIGIN}/r/agreement/pdf?k=${k}&c=${step.c}${step.x === undefined ? '' : `&x=${step.x}`}`);
    } else if (step.kind === 'resend') {
      label = 'POST /r/agreement/resend';
      request = new Request(`${ORIGIN}/r/agreement/resend`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-kk-admin': ADMIN },
        body: JSON.stringify({ number: record.number }),
      });
    } else {
      const extras = Array.isArray(step.extras) ? (step.extras as string[]) : [];
      const of = step.hash_of ?? { choice: step.choice, extras };
      const body: Record<string, unknown> = {
        k,
        choice: step.choice,
        signed_name: record.facts.client_name,
        agree: true,
        text_hash: storedHash(record, of.choice, of.extras),
        ...(step.extras === undefined ? {} : { extras: step.extras }),
      };
      label = `POST /r/agreement/sign ${JSON.stringify({ choice: step.choice, extras: step.extras ?? null })}`;
      request = new Request(`${ORIGIN}/r/agreement/sign`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: ORIGIN,
          'user-agent': 'TestBrowser/1.0',
          'cf-connecting-ip': '203.0.113.7',
          'cf-ray': '8f00aa11bb22cc33-YYZ',
        },
        body: JSON.stringify(body),
      });
    }
    const res = await api.handleAgreement(request, env, ctx, deps);
    const type = res.headers.get('content-type');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    const body = type?.startsWith('application/json') ? parsed(text) : { bytes: bytes.length, disposition: res.headers.get('content-disposition') };
    while (pending.length) await pending.shift();
    out.steps.push({ request: label, status: res.status, content_type: type, body });
  }
  out.kv = [...kv.keys()].sort().map((key) => {
    const e = kv.get(key)!;
    return {
      key,
      value: typeof e.value === 'string' ? parsed(e.value) : { bytes: e.value.length },
      metadata: e.metadata ?? null,
      ttl: e.ttl ?? null,
    };
  });
  out.d1 = rows.map((r) => parsed(r.record));
  if (rows.length > 0) out.copy_fields = api.copyFields(env, JSON.parse(rows[0].record));
  return out;
}

// ------------------------------------------------------------------ packing: big values stored once

// The fixture would be megabytes if every answer were written out: the same agreement texts, sets and
// page contents come back in many answers. So:
// - a long string that is part of a record (a stored text, a fragment of a set) is kept once in
//   `strings` and referenced as { "@s": n };
// - a long string that only answers hold (a signed text, the HTML of a PDF) is kept as its SHA-256 and
//   length, { "@sha256": "...", "length": n }: equal hashes mean equal bytes;
// - an object or list whose packed JSON is long is kept once in `forms` and referenced as { "@o": n }.
// Key order is kept everywhere, so the packed JSON of an answer is equal only when its bytes are.

const LONG_STRING = 300;
const LONG_FORM = 300;

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export interface Packing {
  strings: string[];
  forms: unknown[];
}

const allStrings = (v: unknown, out: Set<string>) => {
  if (typeof v === 'string') {
    if (v.length > LONG_STRING) out.add(v);
  } else if (Array.isArray(v)) v.forEach((x) => allStrings(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => allStrings(x, out));
};

/** A packer: `pack` replaces big values by references, adding to the tables as it goes. */
export function packer(records: unknown) {
  const keep = new Set<string>();
  allStrings(records, keep);
  const p: Packing = { strings: [], forms: [] };
  const stringAt = new Map<string, number>();
  const formAt = new Map<string, number>();
  const pack = (v: unknown): unknown => {
    if (typeof v === 'string') {
      if (v.length <= LONG_STRING) return v;
      if (!keep.has(v)) return { '@sha256': sha256(v), length: v.length };
      let i = stringAt.get(v);
      if (i === undefined) {
        i = p.strings.length;
        p.strings.push(v);
        stringAt.set(v, i);
      }
      return { '@s': i };
    }
    if (v === null || typeof v !== 'object') return v;
    const form = Array.isArray(v) ? v.map(pack) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, pack(x)]));
    const key = JSON.stringify(form);
    if (key.length <= LONG_FORM) return form;
    let i = formAt.get(key);
    if (i === undefined) {
      i = p.forms.length;
      p.forms.push(form);
      formAt.set(key, i);
    }
    return { '@o': i };
  };
  return { pack, packing: p };
}

const refOf = (v: unknown, name: '@s' | '@o'): number | undefined => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).length !== 1) return undefined;
  const i = (v as Record<string, unknown>)[name];
  return typeof i === 'number' ? i : undefined;
};

/** Expands the object references; with strings: true the string references too (a record needs both). */
export function unpack(v: unknown, p: Packing, opts: { strings: boolean }): unknown {
  const o = refOf(v, '@o');
  if (o !== undefined) return unpack(p.forms[o], p, opts);
  const s = refOf(v, '@s');
  if (s !== undefined) return opts.strings ? p.strings[s] : v;
  if (Array.isArray(v)) return v.map((x) => unpack(x, p, opts));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x, p, opts)]));
  return v;
}

/** An answer of today's code in the shape of unpack(expected, { strings: false }): long strings as references or hashes. */
export function packStrings(v: unknown, p: Packing): unknown {
  const at = new Map(p.strings.map((s, i) => [s, i]));
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      if (x.length <= LONG_STRING) return x;
      const i = at.get(x);
      return i === undefined ? { '@sha256': sha256(x), length: x.length } : { '@s': i };
    }
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, walk(y)]));
    return x;
  };
  return walk(v);
}
