import { test, expect } from '@playwright/test';
import { handleAgreement } from '../../src/worker/agreement';
import { APPS_SCRIPT_URL, callAppsScript } from '../../src/worker/shared';
import { copyFields, signedPdfHtml } from '../../src/worker/agreement-copy';
import { storedVariant } from '../../src/worker/agreement-store';
import { pdfDraftDocument } from '../../src/lib/agreement/html';
import worker from '../../src/worker';
import { sha256Hex } from '../../src/lib/agreement/hash';
import { SIGN_DATE_TOKEN, buildBookingFacts, factsFor, mixesOf, renderVariant } from '../../src/lib/agreement/render';
import { docJsonFromSet, mixId } from '../../src/lib/agreement/set';
import { mixSummary, pageContent } from '../../src/lib/agreement/page';
import pageJson from '../../src/data/agreement/page.json' with { type: 'json' };
import clausesJson from '../../src/data/agreement/clauses.json' with { type: 'json' };
import agreementPackages from '../../src/data/agreement/packages.json' with { type: 'json' };
import { unpack } from './fixtures/old-bookings-runner';
import oldBookingsJson from './fixtures/old-bookings.json' with { type: 'json' };

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

const LIVE = 'https://kashklicks.ca';
const TEST = 'https://agreements-kashklicks.example.workers.dev';
const ADMIN = 'admin-secret-for-tests-only';
const START = new Date('2026-11-10T15:00:00Z'); // 10:00 am in Toronto
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

// The summary of the pilot, share, nothing ticked. Re-pinned for the payment change (spec 2026-11-23,
// sections 5.2, 5.3 and 5.5): 126.00 / 375.25 in cash, the retainer by e-transfer to the new address.
const NEW_ETRANSFER = 'kashklicks.ca@gmail.com';
const PILOT_SUMMARY = {
  package: 'The Civil Ceremony',
  date: 'Saturday 12 December 2026',
  total: '$501.25',
  retainer: '$126.00',
  balance: '$375.25',
  balance_how: 'in cash',
  etransfer_email: NEW_ETRANSFER,
  total_line: 'Your total is $501.25. It stays the same even if my website prices change later.',
  price_lines: [{ label: 'The Civil Ceremony', amount: '$501.25' }],
  steps: [
    { title: 'When you sign', amount: '$126.00', note: 'By e-transfer. Your date is held once this arrives.' },
    { title: 'On or before your ceremony day', amount: '$375.25', note: 'In cash, before I start shooting.' },
  ],
};

/**
 * A booking stored before the payment change, exactly as the code of that time made it
 * (tests/unit/fixtures/old-bookings.json, see agreement-old-bookings.unit.ts): its facts read as 50% and
 * the old e-transfer address. Names: civil-noset, wedding-noset-fee (three payments, the fee),
 * wedding-set and civil-set (sets with three tick boxes), civil-set-retainer-cash, and the -bare ones.
 */
const oldRecord = (name: string) => unpack((oldBookingsJson as any).records[name], oldBookingsJson as any, { strings: true }) as any;

// ------------------------------------------------------------------ fakes

interface Entry {
  value: string | Uint8Array; // bytes for a cached PDF
  metadata?: unknown;
  expirationTtl?: number;
}

class FakeKV {
  store = new Map<string, Entry>();
  puts: string[] = [];
  /** Key prefixes whose reads or writes throw. */
  failGets: string[] = [];
  failPuts: string[] = [];
  /** While set, reads see this old copy of the store (a stale edge cache). */
  snapshot: Map<string, Entry> | null = null;
  freeze() {
    this.snapshot = new Map(this.store);
  }
  async get(key: string, type?: 'text' | 'arrayBuffer'): Promise<any> {
    if (this.failGets.some((p) => key.startsWith(p))) throw new Error('KV GET failed: 500');
    const v = (this.snapshot ?? this.store).get(key)?.value ?? null;
    if (v === null) return null;
    const bytes = typeof v === 'string' ? new TextEncoder().encode(v) : v;
    if (type === 'arrayBuffer') return bytes.slice().buffer;
    return typeof v === 'string' ? v : new TextDecoder().decode(v);
  }
  async put(key: string, value: string | Uint8Array, opts: { metadata?: unknown; expirationTtl?: number } = {}): Promise<void> {
    if (this.failPuts.some((p) => key.startsWith(p))) throw new Error('KV PUT failed: 429');
    this.puts.push(key);
    this.store.set(key, { value: typeof value === 'string' ? value : new Uint8Array(value), metadata: opts.metadata, expirationTtl: opts.expirationTtl });
  }
  async list(opts: { prefix?: string } = {}) {
    const prefix = opts.prefix ?? '';
    const keys = [...this.store.keys()]
      .filter((k) => k.startsWith(prefix))
      .sort()
      .map((name) => ({ name, metadata: this.store.get(name)!.metadata }));
    return { keys, list_complete: true };
  }
  json(key: string): any {
    const v = this.store.get(key)?.value;
    return v === undefined ? undefined : JSON.parse(v);
  }
  putsOf(key: string): number {
    return this.puts.filter((k) => k === key).length;
  }
}

// The exact statements the routes may run (migrations/0001_signed_agreements.sql).
const SELECT_SQL = 'SELECT record FROM signed_agreements WHERE mode = ?1 AND token = ?2';
const NUMBER_SQL = 'SELECT 1 FROM signed_agreements WHERE mode = ?1 AND number = ?2';
const INSERT_SQL =
  'INSERT INTO signed_agreements (mode, token, number, signed_at, final_hash, record) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING';

interface Row {
  mode: string;
  token: string;
  number: string;
  signed_at: string;
  final_hash: string;
  record: string;
}

/** Enforces PRIMARY KEY (mode, token), UNIQUE (mode, number) and the mode CHECK, like SQLite. */
class FakeD1 {
  rows: Row[] = [];
  inserts = 0;
  /** One-shot switches for the next insert or select. */
  next: { insert?: 'throw-before' | 'throw-after'; select?: 'throw' | 'empty' } = {};
  prepare(sql: string) {
    if (sql !== SELECT_SQL && sql !== INSERT_SQL && sql !== NUMBER_SQL) throw new Error(`unexpected SQL: ${sql}`);
    return {
      bind: (...values: unknown[]) => ({
        run: async () => this.run(sql, values as string[]),
        first: async <T>() => this.first(sql, values as string[]) as T | null,
      }),
    };
  }
  private run(sql: string, [mode, token, number, signed_at, final_hash, record]: string[]) {
    if (sql !== INSERT_SQL) throw new Error('run() is only used for the insert');
    this.inserts += 1;
    const fault = this.next.insert;
    this.next.insert = undefined;
    if (fault === 'throw-before') throw new Error('D1_ERROR: network connection lost');
    if (mode !== 'live' && mode !== 'test') throw new Error('CHECK constraint failed');
    const clash = this.rows.some((r) => r.mode === mode && (r.token === token || r.number === number));
    if (!clash) this.rows.push({ mode, token, number, signed_at, final_hash, record });
    if (fault === 'throw-after') throw new Error('D1_ERROR: timed out');
    return { meta: { changes: clash ? 0 : 1 } };
  }
  private first(sql: string, [mode, token]: string[]) {
    if (sql === NUMBER_SQL) return this.rows.some((r) => r.mode === mode && r.number === token) ? { 1: 1 } : null;
    if (sql !== SELECT_SQL) throw new Error('first() is only used for the selects');
    const fault = this.next.select;
    this.next.select = undefined;
    if (fault === 'throw') throw new Error('D1_ERROR: read failed');
    if (fault === 'empty') return null;
    const row = this.rows.find((r) => r.mode === mode && r.token === token);
    return row ? { record: row.record } : null;
  }
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Call {
  url: string;
  method: string;
  redirect?: string;
  fields: Record<string, string>;
}

function setup(opts: { kv?: boolean; db?: boolean; admin?: string | null } = {}) {
  const kv = new FakeKV();
  const db = new FakeD1();
  const env = {
    AGREEMENTS_KV: opts.kv === false ? undefined : (kv as unknown as KVNamespace),
    AGREEMENTS_DB: opts.db === false ? undefined : db,
    FORMS_ADMIN_TOKEN: opts.admin === null ? undefined : (opts.admin ?? ADMIN),
  };
  let clock = new Date(START);
  const calls: Call[] = [];
  // The stub answer sees the call, so a test can answer the copy and the notice differently.
  let reply: (c: Call) => Promise<Response> = async () => jsonResponse({ ok: true, sent_at: '2026-11-10T15:00:04.000Z' });
  const fetchImpl = (async (url: string | URL | Request, init: RequestInit = {}) => {
    const c: Call = {
      url: String(url),
      method: init.method ?? 'GET',
      redirect: init.redirect,
      fields: Object.fromEntries(new URLSearchParams(String(init.body ?? ''))),
    };
    calls.push(c);
    return reply(c);
  }) as typeof fetch;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => void pending.push(p) };

  const call = async (
    origin: string,
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ) => {
    const init: RequestInit = { method, headers: { ...headers } };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      (init.headers as Record<string, string>)['content-type'] = 'application/json';
    }
    const res = await handleAgreement(new Request(origin + path, init), env, ctx, { now: () => clock, fetchImpl });
    return { status: res.status, body: (await res.json()) as any, headers: res.headers };
  };

  /** A GET whose answer may not be JSON (the PDF route). */
  const raw = async (origin: string, path: string, method = 'GET') => {
    const res = await handleAgreement(new Request(origin + path, { method }), env, ctx, { now: () => clock, fetchImpl });
    const bytes = new Uint8Array(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, headers: res.headers, bytes, body: type.startsWith('application/json') ? JSON.parse(new TextDecoder().decode(bytes)) : null };
  };

  const admin = (origin: string, path: string, body: unknown, token: string | null = ADMIN) =>
    call(origin, 'POST', path, body, token === null ? {} : { 'x-kk-admin': token });

  const create = async (origin: string, over: Record<string, unknown> = {}) => {
    const r = await admin(origin, '/r/agreement/new', { ...PILOT, ...over });
    expect(r.status).toBe(200);
    return r.body as { number: string; token: string; mode: string };
  };

  const browser = (origin: string) => ({
    origin,
    'user-agent': 'TestBrowser/1.0',
    'cf-connecting-ip': '203.0.113.7',
    'cf-ray': '8f00aa11bb22cc33-YYZ',
  });

  const doc = (origin: string, k: string) => call(origin, 'GET', `/r/agreement/doc?k=${k}`);

  const sign = (origin: string, k: string, over: Record<string, unknown> = {}, headers = browser(origin)) =>
    call(origin, 'POST', '/r/agreement/sign', { k, choice: 'share', signed_name: 'Priya Sharma', agree: true, ...over }, headers);

  const mode = (origin: string) => (origin === TEST ? 'test' : 'live');
  const booking = (origin: string, token: string) => kv.json(`agr:${mode(origin)}:bk:${token}`);
  /** The signed record from D1, the only truth. */
  const signedRecord = (origin: string, token: string) => {
    const row = db.rows.find((r) => r.mode === mode(origin) && r.token === token);
    return row ? JSON.parse(row.record) : undefined;
  };
  /** The stored text of one mix as the worker reads it: from the set, or from the two variants of a booking made before sets. */
  const variantOf = (
    origin: string,
    token: string,
    choice: 'share' | 'private' = 'share',
    extras: string[] = [],
  ): { doc_json: string; hash: string; summary?: any } => {
    const bk = booking(origin, token);
    if (!bk.set) return bk.variants[choice];
    const m = bk.set.mixes[mixId(choice, extras)];
    return { doc_json: docJsonFromSet(bk.set.pool, m.f), hash: m.hash as string, summary: m.summary };
  };
  /** extras in tick box order. */
  const hashOf = (origin: string, token: string, choice: 'share' | 'private' = 'share', extras: string[] = []) =>
    variantOf(origin, token, choice, extras).hash;

  /** Sign with the right hash for the chosen mix (over.extras in tick box order). */
  const signOk = (origin: string, token: string, over: Record<string, unknown> = {}) =>
    sign(origin, token, {
      text_hash: hashOf(origin, token, (over.choice as 'share' | 'private') ?? 'share', (over.extras as string[] | undefined) ?? []),
      ...over,
    });

  /** Stores a booking made before the payment change (oldRecord), status sent, and returns it. */
  const putOld = (name: string) => {
    const rec = oldRecord(name);
    kv.store.set(`agr:${rec.mode}:bk:${rec.token}`, {
      value: JSON.stringify(rec),
      metadata: { number: rec.number, client: rec.facts.client_name, status: rec.status, created_at: rec.created_at, copy_status: rec.copy.status, copy_attempts: rec.copy.attempts },
    });
    kv.store.set(`agr:${rec.mode}:num:${rec.number}`, { value: rec.token });
    return rec;
  };

  /** Rewrites a stored booking into the shape of a booking made before sets (see legacy). */
  const toOld = (origin: string, token: string) => {
    const key = `agr:${mode(origin)}:bk:${token}`;
    const old = legacy(booking(origin, token));
    kv.store.set(key, { ...kv.store.get(key)!, value: JSON.stringify(old) });
    return old;
  };

  const settle = async () => {
    while (pending.length) await pending.shift();
  };

  return {
    kv,
    db,
    env,
    calls,
    pending,
    call,
    raw,
    admin,
    create,
    doc,
    sign,
    signOk,
    booking,
    signedRecord,
    variantOf,
    hashOf,
    toOld,
    putOld,
    settle,
    browser,
    advance: (ms: number) => void (clock = new Date(clock.getTime() + ms)),
    now: () => clock,
    replyWith: (fn: (c: Call) => Promise<Response>) => void (reply = fn),
    /** The actions Apps Script was asked for, in order. */
    actions: () => calls.map((c) => c.fields.action),
  };
}

/** Collects console.error calls for a test that expects a logged failure. */
const silenceErrors = () => {
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => void logged.push(args);
  return { logged, restore: () => void (console.error = original) };
};

// ------------------------------------------------------------------ bookings made before sets

/** The keys a stored summary had before page content existed. */
const OLD_SUMMARY_KEYS = ['package', 'date', 'total', 'retainer', 'balance', 'balance_how', 'etransfer_email', 'later_payments'];
const oldSummary = (s: Record<string, unknown>) => Object.fromEntries(Object.entries(s).filter(([k]) => OLD_SUMMARY_KEYS.includes(k)));

/**
 * A booking record in the shape stored before sets: the two nothing ticked texts in full (they are byte
 * identical to what that code made), the share summary and, with a fee, the private one, in their old
 * shape. No set, no page, no tick boxes in the facts.
 */
const legacy = (rec: any) => {
  const { set, page: _page, ...rest } = rec;
  const { tick_boxes: _ticks, ...facts } = rest.facts;
  const v = (id: string) => ({ doc_json: docJsonFromSet(set.pool, set.mixes[id].f), hash: set.mixes[id].hash });
  return {
    ...rest,
    facts,
    variants: { share: v('share'), private: v('private') },
    summary: oldSummary(set.mixes.share.summary),
    ...(facts.private_fee === undefined ? {} : { summary_private: oldSummary(set.mixes.private.summary) }),
  };
};

// ------------------------------------------------------------------ admin: new

test('new booking needs the admin token', async () => {
  const t = setup();
  expect(await t.admin(TEST, '/r/agreement/new', PILOT, null)).toMatchObject({ status: 401, body: { ok: false, error: 'unauthorized' } });
  expect(await t.admin(TEST, '/r/agreement/new', PILOT, 'wrong')).toMatchObject({ status: 401, body: { ok: false, error: 'unauthorized' } });
  expect(await t.admin(TEST, '/r/agreement/new', PILOT, `${ADMIN}x`)).toMatchObject({ status: 401 });
  expect(t.kv.puts).toEqual([]);

  const unset = setup({ admin: null });
  expect(await unset.admin(TEST, '/r/agreement/new', PILOT)).toMatchObject({ status: 503, body: { ok: false, error: 'admin_unavailable' } });
  expect(await unset.admin(TEST, '/r/agreement/new', PILOT, '')).toMatchObject({ status: 503, body: { error: 'admin_unavailable' } });

  // A rejected booking never uses up a number.
  const bad = await t.admin(TEST, '/r/agreement/new', { ...PILOT, client_email: 'not-an-email' });
  expect(bad).toMatchObject({ status: 400, body: { ok: false, error: 'bad_email', field: 'client_email' } });
  expect(await t.admin(TEST, '/r/agreement/new', { ...PILOT, package_id: 'nope' })).toMatchObject({
    status: 400,
    body: { error: 'package_not_ready', field: 'package_id' },
  });
  expect(t.kv.puts).toEqual([]);
  expect((await t.create(TEST)).number).toBe('KK-TEST-2026-001');
});

test('new booking stores every mix of its text and returns the link', async () => {
  const t = setup();
  const r = await t.admin(TEST, '/r/agreement/new', PILOT);
  expect(r.status).toBe(200);
  expect(r.headers.get('content-type')).toBe('application/json; charset=utf-8');
  expect(r.headers.get('cache-control')).toBe('no-store');
  const { token } = r.body;
  expect(token).toMatch(TOKEN_RE);
  expect(r.body).toEqual({
    ok: true,
    number: 'KK-TEST-2026-001',
    token,
    path: `/welcome/agreement/?k=${token}`,
    mode: 'test',
    // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): 25%, cash only by default.
    total: 501.25,
    retainer: 126,
    balance: 375.25,
    balance_cash: true,
    // What can still be ticked at signing. The amounts above are nothing ticked, share.
    tick_boxes: [
      { id: 'drone', kind: 'price', label: 'Drone and aerial frames', amount: 76.25 },
      { id: 'extra-retouched', kind: 'price', label: 'Five extra retouched images', amount: 26.25 },
      { id: 'raw-photos-civil', kind: 'price', label: 'RAW photos', amount: 69.25 },
    ],
  });
  expect(r.body.path).toMatch(/^\/welcome\/agreement\/\?k=[A-Za-z0-9_-]{43}$/);

  const key = `agr:test:bk:${token}`;
  const rec = t.kv.json(key);
  expect(t.kv.store.get(key)!.metadata).toEqual({
    number: 'KK-TEST-2026-001',
    client: 'Priya Sharma',
    status: 'sent',
    created_at: START.toISOString(),
    copy_status: 'none',
    copy_attempts: 0,
  });
  expect(t.kv.store.get(key)!.expirationTtl).toBe(2592000);
  expect(rec).toMatchObject({
    v: 1,
    mode: 'test',
    token,
    number: 'KK-TEST-2026-001',
    status: 'sent',
    created_at: START.toISOString(),
    copy: { status: 'none', attempts: 0 },
  });
  expect(rec.facts.client_name).toBe('Priya Sharma');
  expect(rec.facts.number).toBe('KK-TEST-2026-001');
  // Byte for byte the facts of the engine for this number, key order included.
  expect(JSON.stringify(rec.facts)).toBe(JSON.stringify(buildBookingFacts(PILOT, { number: 'KK-TEST-2026-001', createdAt: START })));
  // A set replaces the two full texts: 2 choices x 8 subsets of the 3 tick boxes.
  expect(rec).not.toHaveProperty('variants');
  expect(Object.keys(rec.set.mixes)).toEqual(mixesOf(rec.facts).map((m) => m.id));
  expect(Object.keys(rec.set.mixes)).toHaveLength(16);
  for (const m of mixesOf(rec.facts)) {
    const v = t.variantOf(TEST, token, m.choice, m.extras);
    expect(v.hash).toBe(await sha256Hex(v.doc_json));
    expect(v.doc_json.split(SIGN_DATE_TOKEN)).toHaveLength(2);
    const parsed = JSON.parse(v.doc_json);
    expect(parsed.choice).toBe(m.choice);
    expect(parsed.number).toBe('KK-TEST-2026-001');
    expect(rec.clause_version).toBe(parsed.clause_version);
  }
  expect(t.hashOf(TEST, token, 'share')).not.toBe(t.hashOf(TEST, token, 'private'));
  expect(t.kv.store.get('agr:test:num:KK-TEST-2026-001')!.value).toBe(token);
  expect(t.kv.store.get('agr:test:seq:2026')!.value).toBe('1');

  expect((await t.create(TEST)).number).toBe('KK-TEST-2026-002');

  const live = await t.create(LIVE);
  expect(live.number).toBe('KK-2026-001');
  expect(live.mode).toBe('live');
  expect(t.kv.store.get(`agr:live:bk:${live.token}`)!.expirationTtl).toBeUndefined();

  // A number that already exists is skipped.
  await t.kv.put('agr:live:num:KK-2026-002', 'someone-else');
  expect((await t.create(LIVE)).number).toBe('KK-2026-003');
  expect(t.kv.store.get('agr:live:seq:2026')!.value).toBe('3');
});

test('new booking refuses a text that has no single place for the sign date, before anything is stored', async () => {
  // Signing fills the date into exactly one place (fillSignDate), so a mix without it could never be signed.
  const clause = (clausesJson as any).sections[0].items.find((i: { id?: string }) => i.id === '0.5');
  const before = clause.text;
  expect(before).toContain(SIGN_DATE_TOKEN);
  const quiet = silenceErrors();
  try {
    clause.text = before.replace(SIGN_DATE_TOKEN, 'on the day you sign');
    for (const input of [PILOT, WEDDING]) {
      const t = setup();
      const r = await t.admin(TEST, '/r/agreement/new', input);
      expect(r, input.package_id).toMatchObject({ status: 500, body: { ok: false, error: 'server_error' } });
      expect(t.kv.puts, input.package_id).toEqual([]);
    }
    expect(String(quiet.logged[0]?.[1])).toContain('has no single sign date');
  } finally {
    clause.text = before;
    quiet.restore();
  }
  expect((await setup().admin(TEST, '/r/agreement/new', PILOT)).status).toBe(200);
});

test('live and test records never share keys', async () => {
  const t = setup();
  const live = await t.create(LIVE);
  const test_ = await t.create(TEST);
  expect(live.number).toBe('KK-2026-001');
  expect(test_.number).toBe('KK-TEST-2026-001');
  await t.signOk(TEST, test_.token);
  await t.settle();

  const { keys } = await t.kv.list();
  expect(keys.length).toBeGreaterThan(0);
  for (const { name } of keys) {
    expect(name.startsWith('agr:live:') || name.startsWith('agr:test:')).toBe(true);
    const entry = t.kv.store.get(name)!;
    // Every test key expires except the sequence, so test numbers never start over.
    if (name.startsWith('agr:test:') && !name.startsWith('agr:test:seq:')) expect(entry.expirationTtl, name).toBeGreaterThan(0);
    else expect(entry.expirationTtl, name).toBeUndefined();
  }
  expect((await t.kv.list({ prefix: 'agr:live:' })).keys.map((k) => k.name)).toEqual(
    [`agr:live:bk:${live.token}`, 'agr:live:num:KK-2026-001', 'agr:live:seq:2026'].sort(),
  );
  expect((await t.kv.list({ prefix: 'agr:test:signed:' })).keys).toHaveLength(1);

  // A token only works on the host of its own mode.
  expect(await t.doc(TEST, live.token)).toMatchObject({ status: 404, body: { ok: false, error: 'not_found' } });
  expect(await t.doc(LIVE, test_.token)).toMatchObject({ status: 404, body: { ok: false, error: 'not_found' } });
  expect(await t.admin(LIVE, '/r/agreement/void', { number: 'KK-TEST-2026-001' })).toMatchObject({ status: 404 });
});

test('a test number is never used twice, even after its keys expired', async () => {
  const t = setup();
  const a = await t.create(TEST);
  await t.signOk(TEST, a.token);
  await t.settle();
  expect(t.kv.store.get('agr:test:seq:2026')!.expirationTtl).toBeUndefined();

  // 30 days on: the test number key is gone, and the D1 row stays.
  t.kv.store.delete('agr:test:num:KK-TEST-2026-001');
  const b = await t.create(TEST);
  expect(b.number).toBe('KK-TEST-2026-002');

  // Even with the sequence gone too (keys written before this change expired), D1 decides.
  for (const key of [...t.kv.store.keys()]) if (key.startsWith('agr:test:')) t.kv.store.delete(key);
  const c = await t.create(TEST);
  expect(c.number).toBe('KK-TEST-2026-002'); // 002 was never signed, so it is free again
  await t.signOk(TEST, c.token);
  await t.settle();
  t.kv.store.delete('agr:test:num:KK-TEST-2026-002');
  t.kv.store.delete('agr:test:seq:2026');
  const d = await t.create(TEST);
  expect(d.number).toBe('KK-TEST-2026-003');
  expect(await t.signOk(TEST, d.token)).toMatchObject({ status: 200, body: { status: 'signed', number: 'KK-TEST-2026-003' } });
});

// ------------------------------------------------------------------ doc

test('doc: unknown token 404, void 410, first open sets opened', async () => {
  const t = setup();
  expect(await t.doc(TEST, 'A'.repeat(43))).toMatchObject({ status: 404, body: { ok: false, error: 'not_found' } });
  expect(await t.doc(TEST, 'short')).toMatchObject({ status: 404, body: { error: 'not_found' } });
  expect(await t.call(TEST, 'GET', '/r/agreement/doc')).toMatchObject({ status: 404, body: { error: 'not_found' } });

  const { token } = await t.create(TEST);
  const plain = (v: { doc_json: string; hash: string }) => ({ doc_json: v.doc_json, hash: v.hash });
  const variants = { share: plain(t.variantOf(TEST, token, 'share')), private: plain(t.variantOf(TEST, token, 'private')) };
  t.advance(30_000);
  const r = await t.doc(TEST, token);
  expect(r.status).toBe(200);
  // Without v=2: today's shape, the two nothing ticked texts rebuilt from the set.
  expect(r.body).toEqual({
    ok: true,
    status: 'opened',
    mode: 'test',
    today: '10 November 2026',
    number: 'KK-TEST-2026-001',
    client_first: 'Priya',
    partner_first: 'Arjun',
    client_name: 'Priya Sharma',
    partner_name: 'Arjun Mehta',
    variants,
    labels: { ...r.body.labels, name_expected: 'Priya Sharma' },
    summary: PILOT_SUMMARY,
  });
  expect(Object.keys(r.body.labels).sort()).toEqual(
    ['after_signing', 'agree_label', 'intro_bullets', 'name_expected', 'private_option', 'share_option'].sort(),
  );
  expect(r.body.labels.agree_label).toContain('Arjun Mehta');

  const opened = t.booking(TEST, token);
  expect(opened.status).toBe('opened');
  expect(opened.opened_at).toBe(t.now().toISOString());
  expect(t.kv.store.get(`agr:test:bk:${token}`)!.metadata).toMatchObject({ status: 'opened' });

  // A second open changes nothing.
  const firstOpen = opened.opened_at;
  t.advance(60_000);
  const putsBefore = t.kv.puts.length;
  expect((await t.doc(TEST, token)).body.status).toBe('opened');
  expect(t.booking(TEST, token).opened_at).toBe(firstOpen);
  expect(t.kv.puts.length).toBe(putsBefore);

  // Void needs the admin token, then the link answers 410.
  expect(await t.admin(TEST, '/r/agreement/void', { number: 'KK-TEST-2026-001' }, null)).toMatchObject({ status: 401 });
  expect(await t.admin(TEST, '/r/agreement/void', { number: 'KK-TEST-2026-999' })).toMatchObject({
    status: 404,
    body: { error: 'not_found' },
  });
  expect(await t.admin(TEST, '/r/agreement/void', { number: 42 })).toMatchObject({ status: 400, body: { error: 'bad_number' } });
  expect(await t.admin(TEST, '/r/agreement/void', { number: 'KK-TEST-2026-001' })).toMatchObject({
    status: 200,
    body: { ok: true, number: 'KK-TEST-2026-001', status: 'void' },
  });
  expect(t.booking(TEST, token).status).toBe('void');
  expect(await t.doc(TEST, token)).toMatchObject({ status: 410, body: { ok: false, error: 'void' } });
});

// ------------------------------------------------------------------ sign

test('sign refuses another origin', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const putsBefore = t.kv.puts.length;
  const hash = t.hashOf(TEST, token);
  expect(await t.sign(TEST, token, { text_hash: hash }, { ...t.browser(TEST), origin: 'https://evil.example' })).toMatchObject({
    status: 403,
    body: { ok: false, error: 'forbidden' },
  });
  expect(await t.sign(TEST, token, { text_hash: hash }, { 'user-agent': 'curl' })).toMatchObject({ status: 403 });
  // The live site refuses a preview origin.
  const live = await t.create(LIVE);
  expect(await t.sign(LIVE, live.token, { text_hash: t.hashOf(LIVE, live.token) }, t.browser(TEST))).toMatchObject({ status: 403 });
  expect(t.kv.puts.length).toBe(putsBefore + 3); // only the live booking's three keys
  expect(t.signedRecord(TEST, token)).toBeUndefined();
});

test('sign refuses a changed text', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  expect(await t.sign(TEST, token, { text_hash: 'f'.repeat(64) })).toMatchObject({ status: 409, body: { ok: false, error: 'text_changed' } });
  // The hash of the other variant is a changed text too.
  expect(await t.sign(TEST, token, { choice: 'share', text_hash: t.hashOf(TEST, token, 'private') })).toMatchObject({
    status: 409,
    body: { error: 'text_changed' },
  });
  expect(await t.sign(TEST, token, {})).toMatchObject({ status: 409, body: { error: 'text_changed' } });
  expect(t.signedRecord(TEST, token)).toBeUndefined();
  expect(t.booking(TEST, token).status).toBe('sent');
});

test('sign needs the box ticked and a real choice', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const hash = t.hashOf(TEST, token);
  for (const agree of [false, 'true', 1, undefined]) {
    expect(await t.sign(TEST, token, { text_hash: hash, agree })).toMatchObject({ status: 400, body: { ok: false, error: 'must_agree' } });
  }
  for (const choice of ['both', '', null, 'SHARE']) {
    expect(await t.sign(TEST, token, { text_hash: hash, choice })).toMatchObject({ status: 400, body: { ok: false, error: 'bad_choice' } });
  }
  expect(await t.sign(TEST, 'B'.repeat(43), { text_hash: hash })).toMatchObject({ status: 404, body: { error: 'not_found' } });
  expect(await t.sign(TEST, 'bad token', { text_hash: hash })).toMatchObject({ status: 404 });
  expect(t.signedRecord(TEST, token)).toBeUndefined();
});

test('typed name matching', async () => {
  const t = setup();
  const a = await t.create(TEST);
  // Only the named client signs: the partner's own name has its own answer.
  expect(await t.signOk(TEST, a.token, { signed_name: 'Arjun Mehta' })).toMatchObject({ status: 400, body: { ok: false, error: 'partner_cannot_sign' } });
  expect(await t.signOk(TEST, a.token, { signed_name: '  arjun  MEHTA ' })).toMatchObject({ status: 400, body: { error: 'partner_cannot_sign' } });
  expect(await t.signOk(TEST, a.token, { signed_name: 'Arjun' })).toMatchObject({ status: 400, body: { error: 'name_mismatch' } });
  expect(await t.signOk(TEST, a.token, { signed_name: 'Priya' })).toMatchObject({ status: 400, body: { error: 'name_mismatch' } });
  expect(await t.signOk(TEST, a.token, { signed_name: '' })).toMatchObject({ status: 400, body: { error: 'name_mismatch' } });
  expect(await t.signOk(TEST, a.token, { signed_name: 42 })).toMatchObject({ status: 400, body: { error: 'name_mismatch' } });
  expect(t.signedRecord(TEST, a.token)).toBeUndefined();
  const ok = await t.signOk(TEST, a.token, { signed_name: '  priya  SHARMA ' });
  expect(ok).toMatchObject({ status: 200, body: { status: 'signed' } });
  expect(t.signedRecord(TEST, a.token).signed_name).toBe('priya SHARMA');

  // An apostrophe splits a word, so it is not the same as no apostrophe.
  const b = await t.create(TEST, { client_name: "Priya O'Sharma" });
  expect(await t.signOk(TEST, b.token, { signed_name: 'Priya OSharma' })).toMatchObject({ status: 400, body: { error: 'name_mismatch' } });
  expect(await t.signOk(TEST, b.token, { signed_name: 'priya o sharma' })).toMatchObject({ status: 200 });

  // Accents and hyphens normalise.
  const c = await t.create(TEST, { client_name: 'Priyá Sharma-Mehta' });
  expect(await t.signOk(TEST, c.token, { signed_name: 'PRIYA sharma mehta' })).toMatchObject({ status: 200 });
  const d = await t.create(TEST, { client_name: 'Priya Sharma Mehta' });
  expect(await t.signOk(TEST, d.token, { signed_name: 'Príya Sharma-Méhta' })).toMatchObject({ status: 200 });

  // Two people with the same name: the client's name signs.
  const e = await t.create(TEST, { partner_name: 'Priya Sharma' });
  expect(await t.signOk(TEST, e.token, { signed_name: 'Priya Sharma' })).toMatchObject({ status: 200 });
  await t.settle();
});

test('sign writes the record once and fills the date', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  t.advance(5 * 60_000); // signed at 10:05 am Toronto time
  const presented = t.variantOf(TEST, token, 'private');
  const r = await t.signOk(TEST, token, { choice: 'private' });
  expect(r.status).toBe(200);

  const key = `agr:test:signed:${token}`;
  expect(t.kv.putsOf(key)).toBe(1);
  const s = t.signedRecord(TEST, token);
  expect(s.final_doc_json).not.toContain('{{');
  expect(s.final_doc_json).toContain('This agreement is dated 10 November 2026.');
  expect(s.final_hash).toBe(await sha256Hex(s.final_doc_json));
  expect(s.final_doc_json.replace('10 November 2026', SIGN_DATE_TOKEN)).toBe(presented.doc_json);
  expect(s).toEqual({
    v: 1,
    mode: 'test',
    token,
    number: 'KK-TEST-2026-001',
    choice: 'private',
    signed_name: 'Priya Sharma',
    signed_at: '2026-11-10T15:05:00.000Z',
    signed_date_text: '10 November 2026',
    presented_hash: presented.hash,
    final_doc_json: s.final_doc_json,
    final_hash: s.final_hash,
    clause_version: t.booking(TEST, token).clause_version,
    facts: t.booking(TEST, token).facts,
    link_created_at: START.toISOString(),
    ip: '203.0.113.7',
    user_agent: 'TestBrowser/1.0',
    cf_ray: '8f00aa11bb22cc33-YYZ',
    country: null,
    labels: t.booking(TEST, token).labels,
    summary: presented.summary,
    // A booking with a set: the ticked ids (none) and the page content it was shown.
    extras: [],
    page: t.booking(TEST, token).page,
  });
  expect(s.page.title).toBe('Your agreement');

  expect(r.body).toEqual({
    ok: true,
    status: 'signed',
    mode: 'test',
    number: 'KK-TEST-2026-001',
    client_first: 'Priya',
    partner_first: 'Arjun',
    client_name: 'Priya Sharma',
    partner_name: 'Arjun Mehta',
    signed: {
      choice: 'private',
      signed_name: 'Priya Sharma',
      date: '10 November 2026',
      time: '10:05 am',
      final_doc_json: s.final_doc_json,
      final_hash: s.final_hash,
    },
    extras: [],
    summary: PILOT_SUMMARY,
    labels: { ...r.body.labels, name_expected: 'Priya Sharma' },
    copy: { status: 'pending', to: 'priya@example.com' },
  });

  const bk = t.booking(TEST, token);
  expect(bk.status).toBe('signed');
  expect(bk.signed_at).toBe('2026-11-10T15:05:00.000Z');
  expect(t.kv.store.get(`agr:test:bk:${token}`)!.metadata).toMatchObject({ status: 'signed' });
  await t.settle();
  expect(t.booking(TEST, token).copy).toMatchObject({ status: 'sent', attempts: 1 });

  // A signed link shows the signed state on its next visit.
  const again = await t.doc(TEST, token);
  expect(again.status).toBe(200);
  expect(again.body).toEqual({ ...r.body, copy: { status: 'sent', to: 'priya@example.com' } });
});

test('second sign returns the same record', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const first = await t.signOk(TEST, token);
  const record = t.signedRecord(TEST, token);
  t.advance(5_000);
  const second = await t.signOk(TEST, token, { choice: 'private', signed_name: 'priya sharma' });
  expect(second.status).toBe(200);
  expect(second.body.already).toBe(true);
  expect(second.body.signed).toEqual(first.body.signed);
  expect(t.signedRecord(TEST, token)).toEqual(record);
  expect(t.signedRecord(TEST, token).signed_at).toBe(START.toISOString());
  expect(t.kv.putsOf(`agr:test:signed:${token}`)).toBe(1);
  // Even a wrong hash or an unticked box on a signed link returns the record.
  expect(await t.sign(TEST, token, { text_hash: 'x', agree: false })).toMatchObject({ status: 200, body: { already: true } });
  await t.settle();
  expect(t.calls).toHaveLength(1);
});

test('a visit during a slow copy call does not start a second one', async () => {
  const t = setup();
  let release!: () => void;
  t.replyWith(() => new Promise<Response>((done) => (release = () => done(jsonResponse({ ok: true, sent_at: 'x' })))));
  const { token } = await t.create(TEST);
  await t.signOk(TEST, token);
  // The page polls while the copy is pending; Apps Script has not answered yet.
  for (const wait of [5_000, 5_000, 5_000]) {
    t.advance(wait);
    expect((await t.doc(TEST, token)).body.copy.status).toBe('pending');
    expect((await t.signOk(TEST, token)).body.already).toBe(true);
  }
  expect(t.booking(TEST, token).copy).toMatchObject({ status: 'pending', attempts: 1 });
  release();
  await t.settle();
  expect(t.calls).toHaveLength(1);
  expect(t.booking(TEST, token).copy.status).toBe('sent');
});

test('sign after void is 410', async () => {
  const t = setup();
  const { token, number } = await t.create(TEST);
  await t.admin(TEST, '/r/agreement/void', { number });
  expect(await t.signOk(TEST, token)).toMatchObject({ status: 410, body: { ok: false, error: 'void' } });
  expect(t.signedRecord(TEST, token)).toBeUndefined();

  // A signed booking cannot be voided.
  const b = await t.create(TEST);
  await t.signOk(TEST, b.token);
  expect(await t.admin(TEST, '/r/agreement/void', { number: b.number })).toMatchObject({
    status: 409,
    body: { ok: false, error: 'already_signed' },
  });
  expect(t.booking(TEST, b.token).status).toBe('signed');
  await t.settle();
});

test('signing survives an Apps Script failure', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    t.replyWith(async () => {
      throw new Error('network down');
    });
    const { token } = await t.create(TEST);
    const r = await t.signOk(TEST, token);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('signed');
    expect(r.body.copy).toEqual({ status: 'pending', to: 'priya@example.com' });
    expect(t.pending).toHaveLength(1);
    await t.settle();
    expect(t.calls).toHaveLength(1);
    const bk = t.booking(TEST, token);
    expect(bk.status).toBe('signed');
    expect(bk.copy).toEqual({ status: 'pending', attempts: 1, last_attempt_at: START.toISOString() });
    expect(t.signedRecord(TEST, token)).toBeDefined();
    expect(errors.logged.length).toBeGreaterThan(0);

    // An { ok: false } answer is a failure too.
    t.replyWith(async () => jsonResponse({ ok: false, error: 'send_failed: quota' }));
    const b = await t.create(TEST);
    await t.signOk(TEST, b.token);
    await t.settle();
    expect(t.booking(TEST, b.token).copy).toMatchObject({ status: 'pending', attempts: 1 });
  } finally {
    errors.restore();
  }
});

test('a later visit retries the copy', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    t.replyWith(async () => jsonResponse({}, 500));
    const { token } = await t.create(TEST);
    await t.signOk(TEST, token);
    await t.settle();
    expect(t.calls).toHaveLength(1);

    // Too soon: no retry.
    t.advance(30_000);
    expect((await t.doc(TEST, token)).body.copy).toEqual({ status: 'pending', to: 'priya@example.com' });
    await t.settle();
    expect(t.calls).toHaveLength(1);

    // Over 60 s later: one more call, and this one works.
    t.advance(31_000);
    t.replyWith(async () => jsonResponse({ ok: true, sent_at: '2026-11-10T15:01:02.000Z' }));
    const visit = await t.doc(TEST, token);
    expect(visit.body.copy.status).toBe('pending');
    expect(t.pending).toHaveLength(1);
    await t.settle();
    expect(t.calls).toHaveLength(2);
    expect(t.booking(TEST, token).copy).toEqual({
      status: 'sent',
      attempts: 2,
      last_attempt_at: '2026-11-10T15:01:01.000Z',
      sent_at: '2026-11-10T15:01:02.000Z',
    });
    t.advance(120_000);
    expect((await t.doc(TEST, token)).body.copy).toEqual({ status: 'sent', to: 'priya@example.com' });
    await t.settle();
    expect(t.calls).toHaveLength(2);

    // After five failed attempts a visit stops trying.
    t.replyWith(async () => jsonResponse({ ok: false, error: 'down' }));
    const b = await t.create(TEST);
    await t.signOk(TEST, b.token);
    await t.settle();
    for (let i = 0; i < 6; i += 1) {
      t.advance(61_000);
      await t.doc(TEST, b.token);
      await t.settle();
    }
    expect(t.booking(TEST, b.token).copy).toMatchObject({ status: 'pending', attempts: 5 });
    // Five copy attempts in all (the owner notices are counted in their own tests).
    expect(t.actions().filter((a) => a === 'agreement_signed')).toHaveLength(2 + 5);
  } finally {
    errors.restore();
  }
});

test('copy call carries the contract fields', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  await t.signOk(TEST, token);
  await t.settle();
  expect(t.calls).toHaveLength(1);
  const [c] = t.calls;
  expect(c.url).toBe(APPS_SCRIPT_URL);
  expect(c.method).toBe('POST');
  expect(c.redirect).toBe('manual');
  const f = c.fields;
  expect(Object.keys(f).sort()).toEqual(
    ['action', 'token', 'test', 'booking_number', 'to_email', 'email_subject', 'email_body', 'pdf_html', 'pdf_name', 'row_json'].sort(),
  );
  expect(f.action).toBe('agreement_signed');
  expect(f.token).toBe(ADMIN);
  expect(f.test).toBe('1');
  expect(f.booking_number).toBe('KK-TEST-2026-001');
  expect(f.to_email).toBe('priya@example.com');
  expect(f.email_subject).toBe('Your signed agreement with AD Photography (KK-TEST-2026-001)');
  expect(f.email_body).toBe(
    [
      'Hi Priya,',
      '',
      'Thank you for signing. Your signed agreement is attached as a PDF. Please keep it.',
      '',
      // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): 25%, the new address, cash only.
      'Next step: send the retainer of $126.00 by Interac e-transfer to kashklicks.ca@gmail.com. Please put your booking number, KK-TEST-2026-001, in the message. Your date is held once the retainer arrives.',
      '',
      'The balance of $375.25 is due on or before the day, in cash.',
      '',
      'If anything looks wrong, just reply to this email.',
      '',
      'Warmly,',
      'Kash',
      'AD Photography',
      'kashklicks.ca',
    ].join('\n'),
  );
  expect(f.email_subject + f.email_body).not.toMatch(/[–—]/);
  expect(f.pdf_html.startsWith('<!doctype html>')).toBe(true);
  expect(f.pdf_html).toContain('Signed by Priya Sharma, for themselves and for Arjun Mehta, on 10 November 2026 at 10:00 am (Toronto time)');
  const s = t.signedRecord(TEST, token);
  expect(f.pdf_html).toContain(`Text fingerprint ${s.final_hash}`);
  expect(f.pdf_name).toBe('AD Photography agreement KK-TEST-2026-001.pdf');
  expect(JSON.parse(f.row_json)).toEqual({
    'Signed at': START.toISOString(),
    'Booking number': 'KK-TEST-2026-001',
    Client: 'Priya Sharma',
    Partner: 'Arjun Mehta',
    Email: 'priya@example.com',
    Phone: '416 555 0142',
    Package: 'The Civil Ceremony',
    'Event date': '2026-12-12',
    Total: '$501.25',
    Retainer: '$126.00',
    Balance: '$375.25',
    Sharing: 'share',
    'Signed name': 'Priya Sharma',
    'Text hash': s.final_hash,
    'Clause version': s.clause_version,
    Notes: 'Family group photos after the ceremony, inside your 2 hours.',
  });


  // The live site sends an empty test flag.
  const live = await t.create(LIVE);
  await t.signOk(LIVE, live.token);
  await t.settle();
  expect(t.calls[1].fields.test).toBe('');
  expect(t.calls[1].fields.email_subject).toBe('Your signed agreement with AD Photography (KK-2026-001)');

  // A booking made before the change keeps its amounts and the old address in the email (spec 2026-11-23, section 5.1).
  // Its own store: it has the same number as the first booking above.
  const o = setup();
  const old = o.putOld('civil-noset');
  expect((await o.sign(TEST, old.token, { text_hash: old.variants.share.hash })).status).toBe(200);
  await o.settle();
  expect(o.calls).toHaveLength(1);
  const oldBody = o.calls[0].fields.email_body;
  expect(oldBody).toContain(`Next step: send the retainer of $251.00 by Interac e-transfer to info@kashklicks.ca. Please put your booking number, ${old.number}, in the message.`);
  expect(oldBody).toContain('The balance of $250.25 is due on or before the day, by e-transfer or cash.');
  expect(oldBody).not.toContain(NEW_ETRANSFER);
  expect(JSON.parse(o.calls[0].fields.row_json)).toMatchObject({ Total: '$501.25', Retainer: '$251.00', Balance: '$250.25' });
});

test('a booking with its own retainer carries it to the client and the copy', async () => {
  const t = setup();
  const r = await t.admin(TEST, '/r/agreement/new', { ...PILOT, retainer: 51.25 });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ ok: true, total: 501.25, retainer: 51.25, balance: 450 });
  const opened = await t.doc(TEST, r.body.token);
  expect(opened.body.summary.retainer).toBe('$51.25');
  expect(opened.body.summary.balance).toBe('$450.00');

  await t.signOk(TEST, r.body.token);
  await t.settle();
  expect(t.calls).toHaveLength(1);
  expect(t.calls[0].fields.email_body).toContain('send the retainer of $51.25');
  expect(t.calls[0].fields.email_body).toContain('The balance of $450.00');

  expect(await t.admin(TEST, '/r/agreement/new', { ...PILOT, retainer: 0 })).toMatchObject({
    status: 400,
    body: { ok: false, error: 'bad_retainer', field: 'retainer' },
  });
});

test('a booking can say the balance is paid in cash only', async () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.6): cash only is the default now
  // (the business setting balanceCashOnly); balance_cash: false lets one booking pay the balance by e-transfer too.
  const t = setup();
  const r = await t.admin(TEST, '/r/agreement/new', { ...PILOT, balance_cash: true });
  expect(r.status).toBe(200);
  expect(r.body).toMatchObject({ ok: true, balance: 375.25, balance_cash: true });
  expect((await t.doc(TEST, r.body.token)).body.summary.balance_how).toBe('in cash');

  await t.signOk(TEST, r.body.token);
  await t.settle();
  expect(t.calls).toHaveLength(1);
  expect(t.calls[0].fields.email_body).toContain('The balance of $375.25 is due on or before the day, in cash.');
  expect(t.calls[0].fields.email_body).not.toContain('by e-transfer or cash');

  // The default booking is the same as saying true.
  const d = await t.admin(TEST, '/r/agreement/new', PILOT);
  expect(d.body.balance_cash).toBe(true);
  expect((await t.doc(TEST, d.body.token)).body.summary.balance_how).toBe('in cash');
  expect(t.variantOf(TEST, d.body.token).doc_json).toBe(t.variantOf(TEST, r.body.token).doc_json.replaceAll('KK-TEST-2026-001', 'KK-TEST-2026-002'));

  // balance_cash: false shows clause 3.10 and not 3.17, in every mix, and the summary and the email say either way.
  const any = await t.admin(TEST, '/r/agreement/new', { ...PILOT, balance_cash: false });
  expect(any.body).toMatchObject({ ok: true, balance: 375.25, balance_cash: false });
  expect((await t.doc(TEST, any.body.token)).body.summary.balance_how).toBe('e-transfer or cash');
  for (const m of mixesOf(t.booking(TEST, any.body.token).facts)) {
    const text = t.variantOf(TEST, any.body.token, m.choice, m.extras).doc_json;
    expect(text, m.id).toContain('You can pay the balance by e-transfer or in cash.');
    expect(text, m.id).not.toContain('You pay the balance in cash, not by e-transfer.');
    expect(t.variantOf(TEST, d.body.token, m.choice, m.extras).doc_json, m.id).toContain('You pay the balance in cash, not by e-transfer.');
  }
  await t.signOk(TEST, any.body.token);
  await t.settle();
  expect(t.calls[t.calls.length - 1].fields.email_body).toContain('The balance of $375.25 is due on or before the day, by e-transfer or cash.');

  expect(await t.admin(TEST, '/r/agreement/new', { ...PILOT, balance_cash: 'yes' })).toMatchObject({
    status: 400,
    body: { ok: false, error: 'bad_balance_cash', field: 'balance_cash' },
  });
});

test('a booking stored before balance_cash existed signs as before', async () => {
  const t = setup();
  // Made before sets too: two full texts and the summary. Re-pinned for the payment change (spec
  // 2026-11-23, section 5.6): a real booking made by the code of that time (50%), no more a new one rewritten.
  const old = t.putOld('civil-noset');
  const token = old.token;
  const key = `agr:test:bk:${token}`;
  delete old.facts.balance_cash;
  delete old.summary.balance_how;
  t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(old) });

  const opened = await t.doc(TEST, token);
  expect(opened.status).toBe(200);
  expect(opened.body.summary.balance_how).toBeUndefined();
  expect(opened.body.summary.balance).toBe('$250.25');
  await t.sign(TEST, token, { text_hash: old.variants.share.hash });
  await t.settle();
  expect(t.calls[0].fields.email_body).toContain('The balance of $250.25 is due on or before the day, by e-transfer or cash.');
});

test('resend runs the copy step now', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    const { token, number } = await t.create(TEST);
    expect(await t.admin(TEST, '/r/agreement/resend', { number }, null)).toMatchObject({ status: 401 });
    expect(await t.admin(TEST, '/r/agreement/resend', { number })).toMatchObject({ status: 409, body: { ok: false, error: 'not_signed' } });
    t.replyWith(async () => jsonResponse({ ok: false, error: 'down' }));
    await t.signOk(TEST, token);
    await t.settle();
    // The refused copy sent the owner notice, which failed too.
    expect(t.actions()).toEqual(['agreement_signed', 'agreement_notice']);

    // No 60 s wait for a resend.
    t.replyWith(async () => jsonResponse({ ok: true, already: true, sent_at: '2026-11-10T15:00:09.000Z' }));
    const r = await t.admin(TEST, '/r/agreement/resend', { number });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      copy: { status: 'sent', attempts: 2, last_attempt_at: START.toISOString(), sent_at: '2026-11-10T15:00:09.000Z', notice_sent: false },
      already: true,
    });
    expect(t.actions()).toEqual(['agreement_signed', 'agreement_notice', 'agreement_signed']);
    expect(t.booking(TEST, token).copy.status).toBe('sent');
  } finally {
    errors.restore();
  }
});

// ------------------------------------------------------------------ a copy that fails is never silent

test('KV metadata carries the copy state', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    const { token } = await t.create(TEST);
    const meta = () => t.kv.store.get(`agr:test:bk:${token}`)!.metadata as Record<string, unknown>;
    expect(meta()).toMatchObject({ copy_status: 'none', copy_attempts: 0 });
    t.replyWith(async () => jsonResponse({}, 500));
    await t.signOk(TEST, token);
    expect(meta()).toMatchObject({ status: 'signed', copy_status: 'pending', copy_attempts: 1 });
    await t.settle();
    expect(meta()).toMatchObject({ copy_status: 'pending', copy_attempts: 1 });
    t.advance(61_000);
    t.replyWith(async () => jsonResponse({ ok: true, sent_at: '2026-11-10T15:01:02.000Z' }));
    await t.doc(TEST, token);
    await t.settle();
    expect(meta()).toEqual({
      number: 'KK-TEST-2026-001',
      client: 'Priya Sharma',
      status: 'signed',
      created_at: START.toISOString(),
      copy_status: 'sent',
      copy_attempts: 2,
    });
  } finally {
    errors.restore();
  }
});

const NOTICE_SUBJECT = 'Signed, but the copy was not sent: Priya Sharma (KK-TEST-2026-001)';
const noticeBody = (reason: string) =>
  `Priya Sharma signed booking KK-TEST-2026-001 on 10 November 2026 at 10:00 am (Toronto time), but the PDF copy could not be sent to priya@example.com. Reason: ${reason}. Ask Claude to resend it.`;

test('a copy refused by Apps Script sends the owner one notice', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    t.replyWith(async (c) => jsonResponse(c.fields.action === 'agreement_notice' ? { ok: true } : { ok: false, error: 'contracts_headers' }));
    const { token } = await t.create(TEST);
    await t.signOk(TEST, token);
    await t.settle();
    expect(t.actions()).toEqual(['agreement_signed', 'agreement_notice']);
    const n = t.calls[1].fields;
    expect(n).toEqual({ action: 'agreement_notice', token: ADMIN, test: '1', subject: NOTICE_SUBJECT, body: noticeBody('contracts_headers') });
    expect(n.subject + n.body).not.toMatch(/[–—]/);
    expect(t.booking(TEST, token).copy).toMatchObject({ status: 'pending', attempts: 1, notice_sent: true });

    // Later attempts that fail the same way send no second notice, up to and past the cap.
    for (let i = 0; i < 6; i += 1) {
      t.advance(61_000);
      await t.doc(TEST, token);
      await t.settle();
    }
    expect(t.booking(TEST, token).copy).toMatchObject({ status: 'pending', attempts: 5, notice_sent: true });
    expect(t.actions().filter((a) => a === 'agreement_notice')).toHaveLength(1);
    expect(t.actions().filter((a) => a === 'agreement_signed')).toHaveLength(5);

    // The live site sends its notice with an empty test flag.
    const live = await t.create(LIVE);
    await t.signOk(LIVE, live.token);
    await t.settle();
    const liveNotice = t.calls[t.calls.length - 1].fields;
    expect(liveNotice.action).toBe('agreement_notice');
    expect(liveNotice.test).toBe('');
    expect(liveNotice.subject).toBe('Signed, but the copy was not sent: Priya Sharma (KK-2026-001)');
  } finally {
    errors.restore();
  }
});

test('no notice when the copy call itself fails', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    t.replyWith(async () => {
      throw new Error('network down');
    });
    const { token } = await t.create(TEST);
    await t.signOk(TEST, token);
    await t.settle();
    t.replyWith(async () => jsonResponse({}, 502));
    t.advance(61_000);
    await t.doc(TEST, token);
    await t.settle();
    expect(t.actions()).toEqual(['agreement_signed', 'agreement_signed']);
    expect(t.booking(TEST, token).copy).toMatchObject({ status: 'pending', attempts: 2 });
    expect(t.booking(TEST, token).copy.notice_sent).toBeUndefined();
  } finally {
    errors.restore();
  }
});

test('a notice that failed is tried once more on the attempt that reaches the cap', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    let notices = 0;
    t.replyWith(async (c) => {
      if (c.fields.action !== 'agreement_notice') return jsonResponse({ ok: false, error: 'send_failed: quota' });
      notices += 1;
      if (notices === 1) throw new Error('network down'); // the first notice is lost
      return jsonResponse({ ok: true });
    });
    const { token } = await t.create(TEST);
    // The notice failure is logged, never thrown: the sign answers as usual.
    expect((await t.signOk(TEST, token)).body).toMatchObject({ status: 'signed', copy: { status: 'pending' } });
    await t.settle();
    expect(t.actions()).toEqual(['agreement_signed', 'agreement_notice']);
    expect(t.booking(TEST, token).copy.notice_sent).toBe(false);

    // Attempts 2 to 4: no notice.
    for (let i = 0; i < 3; i += 1) {
      t.advance(61_000);
      await t.doc(TEST, token);
      await t.settle();
    }
    expect(t.actions().filter((a) => a === 'agreement_notice')).toHaveLength(1);

    // Attempt 5 reaches the cap with no notice sent: one more try, and this one works.
    t.advance(61_000);
    await t.doc(TEST, token);
    await t.settle();
    expect(t.booking(TEST, token).copy).toMatchObject({ status: 'pending', attempts: 5, notice_sent: true });
    expect(t.actions().slice(-2)).toEqual(['agreement_signed', 'agreement_notice']);
    expect(t.calls[t.calls.length - 1].fields.body).toBe(noticeBody('send_failed: quota'));

    // Past the cap nothing more is tried.
    const before = t.calls.length;
    t.advance(61_000);
    await t.doc(TEST, token);
    await t.settle();
    expect(t.calls).toHaveLength(before);
    expect(errors.logged.some((args) => String(args[0]).includes('notice'))).toBe(true);
  } finally {
    errors.restore();
  }
});

// ------------------------------------------------------------------ labels and summary frozen with the booking

test('labels and summary are stored with the booking and copied into the signed record', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const bk = t.booking(TEST, token);
  const opened = await t.doc(TEST, token);
  // One summary per mix, in the set; the doc answer gives the nothing ticked share one.
  const summary = bk.set.mixes.share.summary;
  expect(bk).not.toHaveProperty('summary');
  expect(bk.labels).toEqual(opened.body.labels);
  expect(summary).toEqual(opened.body.summary);
  expect(bk.labels.name_expected).toBe('Priya Sharma');
  expect(bk.labels.intro_bullets[0]).toBe('Priya signs for both of you.');
  // Re-pinned for the payment change (spec 2026-11-23, section 5.2): the new address, frozen with the booking.
  expect(summary.etransfer_email).toBe(NEW_ETRANSFER);
  expect(bk.facts.etransfer_email).toBe(NEW_ETRANSFER);
  expect(bk.facts.retainer_percent).toBe(25);
  for (const m of Object.values<any>(bk.set.mixes)) expect(m.summary.etransfer_email).toBe(NEW_ETRANSFER);
  // Clause 3.9 of every stored text names it too; a booking made before keeps the old clause and address.
  // Re-pinned for spec 2026-11-23, section 5.8: clause 3.9 adds that any other e-transfer goes to the same address.
  for (const m of mixesOf(bk.facts))
    expect(t.variantOf(TEST, token, m.choice, m.extras).doc_json, m.id).toContain(
      'You pay the retainer by Interac e-transfer to kashklicks.ca@gmail.com. Any other payment by e-transfer goes to the same address. Please put your booking number in the message.',
    );
  const old = oldRecord('civil-noset');
  expect(old.variants.share.doc_json).toContain('You can pay by Interac e-transfer to info@kashklicks.ca. Please put your booking number in the message.');
  expect(old.summary.etransfer_email).toBe('info@kashklicks.ca');

  await t.signOk(TEST, token);
  await t.settle();
  const s = t.signedRecord(TEST, token);
  expect(s.labels).toEqual(bk.labels);
  expect(s.summary).toEqual(summary);
});

test('a link keeps working from its stored values when the package data changes later', async () => {
  const t = setup();
  const a = await t.create(TEST);
  const b = await t.create(TEST);
  await t.signOk(TEST, b.token);
  await t.settle();

  // As if the package were renamed in the data files: computing labels now would throw package_not_ready.
  // A booking with a set keeps one summary per mix; a signed record and an old booking keep one summary.
  const retire = (rec: any) => {
    rec.facts = { ...rec.facts, package_id: 'retired-package' };
    rec.labels = { ...rec.labels, agree_label: 'The words shown when this link was made.' };
    const old = (s: any) => ({ ...s, etransfer_email: 'old-address@example.com' });
    if (rec.set) for (const m of Object.values<any>(rec.set.mixes)) m.summary = old(m.summary);
    else rec.summary = old(rec.summary);
    return rec;
  };
  const putBk = (token: string) => {
    const key = `agr:test:bk:${token}`;
    t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(retire(t.booking(TEST, token))) });
  };
  putBk(a.token);
  putBk(b.token);
  const row = t.db.rows.find((r) => r.token === b.token)!;
  row.record = JSON.stringify(retire(JSON.parse(row.record)));

  const unsigned = await t.doc(TEST, a.token);
  expect(unsigned.status).toBe(200);
  expect(unsigned.body.labels.agree_label).toBe('The words shown when this link was made.');
  expect(unsigned.body.summary.etransfer_email).toBe('old-address@example.com');

  const signed = await t.doc(TEST, b.token);
  expect(signed.status).toBe(200);
  expect(signed.body.status).toBe('signed');
  expect(signed.body.labels).toEqual(JSON.parse(row.record).labels);
  expect(signed.body.summary).toEqual(JSON.parse(row.record).summary);
  expect(signed.body.labels.agree_label).toBe('The words shown when this link was made.');

  // The set and the page content are stored values too: v=2, and a sign with ticked extras, look nothing up.
  const v2 = await t.call(TEST, 'GET', `/r/agreement/doc?k=${a.token}&v=2`);
  expect(v2.status).toBe(200);
  expect(v2.body.set).toEqual(t.booking(TEST, a.token).set);
  expect(v2.body.page).toEqual(t.booking(TEST, a.token).page);
  expect(v2.body.summary.etransfer_email).toBe('old-address@example.com');
  // Sent in another order: the worker puts them in tick box order.
  const ticked = await t.sign(TEST, a.token, { extras: ['raw-photos-civil', 'drone'], text_hash: t.hashOf(TEST, a.token, 'share', ['drone', 'raw-photos-civil']) });
  expect(ticked.status).toBe(200);
  expect(ticked.body.extras).toEqual(['drone', 'raw-photos-civil']);
  expect(ticked.body.summary.etransfer_email).toBe('old-address@example.com');
  const rec = t.signedRecord(TEST, a.token);
  expect(rec.facts.package_id).toBe('retired-package');
  expect(rec.facts.total).toBe(646.75);
  expect(rec.labels.agree_label).toBe('The words shown when this link was made.');
  expect((await t.doc(TEST, a.token)).status).toBe(200);

  // The same for a booking made before sets.
  const c = await t.create(TEST);
  t.toOld(TEST, c.token);
  putBk(c.token);
  expect((await t.doc(TEST, c.token)).body.summary.etransfer_email).toBe('old-address@example.com');
  expect(await t.signOk(TEST, c.token)).toMatchObject({ status: 200, body: { status: 'signed', extras: [] } });
  await t.settle();
});

test('a booking and a signed record made before labels were stored still load', async () => {
  const t = setup();
  const a = await t.create(TEST);
  const b = await t.create(TEST);
  // Those bookings were made before sets too.
  t.toOld(TEST, a.token);
  t.toOld(TEST, b.token);
  const expected = (await t.doc(TEST, a.token)).body;
  await t.signOk(TEST, b.token);
  await t.settle();

  // The shape of the two TEST bookings made before this change: no labels, no summary.
  const strip = (rec: any) => {
    delete rec.labels;
    delete rec.summary;
    return rec;
  };
  for (const token of [a.token, b.token]) {
    const key = `agr:test:bk:${token}`;
    t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(strip(t.booking(TEST, token))) });
  }
  const row = t.db.rows.find((r) => r.token === b.token)!;
  row.record = JSON.stringify(strip(JSON.parse(row.record)));

  const unsigned = await t.doc(TEST, a.token);
  expect(unsigned.status).toBe(200);
  expect(unsigned.body.labels).toEqual(expected.labels);
  expect(unsigned.body.summary).toEqual(expected.summary);
  const signed = await t.doc(TEST, b.token);
  expect(signed.status).toBe(200);
  expect(signed.body.labels).toEqual(expected.labels);
  expect(signed.body.summary).toEqual(expected.summary);

  // Signing an old booking stores the labels it was shown.
  const c = await t.create(TEST);
  const key = `agr:test:bk:${c.token}`;
  t.toOld(TEST, c.token);
  t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(strip(t.booking(TEST, c.token))) });
  await t.signOk(TEST, c.token);
  await t.settle();
  expect(t.signedRecord(TEST, c.token).labels).toEqual(expected.labels);
  expect(t.signedRecord(TEST, c.token).summary).toEqual(expected.summary);
});

// ------------------------------------------------------------------ not yet

const FIX = 'Please spell my partner as Arjun K. Mehta.';

test('not yet sends the message to the owner and keeps the link usable', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const say = (message: unknown, k = token) => t.call(TEST, 'POST', '/r/agreement/not-yet', { k, message }, t.browser(TEST));
  expect(
    await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: FIX }, { origin: 'https://evil.example' }),
  ).toMatchObject({ status: 403 });
  t.advance(4 * 3600_000 + 41 * 60_000); // 2:41 pm in Toronto
  // The notice is awaited: it has gone out by the time the answer comes back.
  expect(await say(FIX)).toMatchObject({ status: 200, body: { ok: true } });
  expect(t.calls).toHaveLength(1);
  expect(t.calls[0].fields).toEqual({
    action: 'agreement_notice',
    token: ADMIN,
    test: '1',
    subject: 'Agreement: Priya Sharma asks for a change (KK-TEST-2026-001)',
    body: [
      'Priya Sharma does not want to sign yet. They wrote this on 10 November 2026 at 2:41 pm (Toronto time):',
      '',
      FIX,
      '',
      'Nothing is signed. Booking KK-TEST-2026-001.',
      'Their email: priya@example.com',
      'Their phone: 416 555 0142',
    ].join('\n'),
  });
  const bk = t.booking(TEST, token);
  expect(bk.not_yet_at).toBe('2026-11-10T19:41:00.000Z');
  expect(bk.not_yet_messages).toEqual([{ at: '2026-11-10T19:41:00.000Z', text: FIX, sent: true, tries: 1 }]);

  // The link still opens and can still be signed; then not yet is refused.
  expect(await t.doc(TEST, token)).toMatchObject({ status: 200, body: { status: 'opened' } });
  expect(await t.signOk(TEST, token)).toMatchObject({ status: 200, body: { status: 'signed' } });
  expect(await say(FIX)).toMatchObject({ status: 409, body: { error: 'already_signed' } });
  expect(await say(FIX, 'C'.repeat(43))).toMatchObject({ status: 404, body: { error: 'not_found' } });
  await t.settle();
});

test('not yet: a void link is 410, and the token and state come before the message', async () => {
  const t = setup();
  const { token, number } = await t.create(TEST);
  const say = (message: unknown, k = token) => t.call(TEST, 'POST', '/r/agreement/not-yet', { k, message }, t.browser(TEST));
  expect(await say(undefined, 'C'.repeat(43))).toMatchObject({ status: 404 });
  await t.admin(TEST, '/r/agreement/void', { number });
  expect(await say(FIX)).toMatchObject({ status: 410, body: { error: 'void' } });
  expect(await say('')).toMatchObject({ status: 410 });
  const signed = await t.create(TEST);
  await t.signOk(TEST, signed.token);
  expect(await say('', signed.token)).toMatchObject({ status: 409, body: { error: 'already_signed' } });
  await t.settle();
  expect(t.actions()).toEqual(['agreement_signed']);
});

test('not yet refuses a message that is missing, not text, too short or too long', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const bad = { status: 400, body: { ok: false, error: 'bad_message' } };
  expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token }, t.browser(TEST))).toMatchObject(bad);
  for (const message of [42, null, ['a long enough text'], 'ab', '  ab  ', 'x'.repeat(1001), '\u0000\u0001\u0007\u001F\u007F\u009F', '\n\n\n'])
    expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message }, t.browser(TEST)), JSON.stringify(message)).toMatchObject(bad);
  expect(t.calls).toHaveLength(0);
  expect(t.booking(TEST, token).not_yet_messages).toBeUndefined();
  // 1000 characters is the most.
  expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: 'x'.repeat(1000) }, t.browser(TEST))).toMatchObject({
    status: 200,
  });
});

test('not yet keeps newlines and cleans the rest', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const raw = '  Two things:\r\n1. the date\r\r\r\r2. the\u0000 place\u0007\n\n\n\nThanks\t!  ';
  expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: raw }, t.browser(TEST))).toMatchObject({ status: 200 });
  const clean = 'Two things:\n1. the date\n\n2. the place\n\nThanks !';
  expect(t.booking(TEST, token).not_yet_messages[0].text).toBe(clean);
  expect(t.calls[0].fields.body).toContain(`(Toronto time):\n\n${clean}\n\nNothing is signed.`);
});

test('not yet sends the same message once within 10 minutes', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const say = (message: string) => t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message }, t.browser(TEST));
  expect(await say(FIX)).toMatchObject({ status: 200, body: { ok: true } });
  t.advance(4 * 60_000);
  expect(await say(`  ${FIX}  `)).toMatchObject({ status: 200, body: { ok: true } });
  expect(t.calls).toHaveLength(1);
  expect(t.booking(TEST, token).not_yet_messages).toHaveLength(1);
  // Another message goes out at once.
  expect(await say('And the place is wrong too.')).toMatchObject({ status: 200 });
  expect(t.calls).toHaveLength(2);
  // The same message again after 10 minutes is a new message.
  t.advance(11 * 60_000);
  expect(await say('And the place is wrong too.')).toMatchObject({ status: 200 });
  expect(t.calls).toHaveLength(3);
  expect(t.booking(TEST, token).not_yet_messages.map((m: { text: string }) => m.text)).toEqual([
    FIX,
    'And the place is wrong too.',
    'And the place is wrong too.',
  ]);
});

test('not yet takes at most 5 messages in 24 hours and keeps the newest 10', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const say = (message: string) => t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message }, t.browser(TEST));
  for (let i = 1; i <= 5; i += 1) {
    expect(await say(`Change number ${i}`)).toMatchObject({ status: 200 });
    t.advance(60_000);
  }
  expect(await say('Change number 6')).toMatchObject({ status: 429, body: { ok: false, error: 'too_many' } });
  expect(t.calls).toHaveLength(5);
  expect(t.booking(TEST, token).not_yet_messages).toHaveLength(5);
  // A day after the first, one more fits.
  t.advance(24 * 3600_000 - 5 * 60_000);
  expect(await say('Change number 6')).toMatchObject({ status: 200 });
  expect(await say('Change number 7')).toMatchObject({ status: 429 });
  // Over days, the booking keeps only the newest 10.
  for (let day = 0; day < 2; day += 1) {
    t.advance(25 * 3600_000);
    for (let i = 0; i < 5; i += 1) expect(await say(`Day ${day} change ${i}`)).toMatchObject({ status: 200 });
  }
  const kept = t.booking(TEST, token).not_yet_messages.map((m: { text: string }) => m.text);
  expect(kept).toHaveLength(10);
  expect(kept[0]).toBe('Day 0 change 0');
  expect(kept[9]).toBe('Day 1 change 4');
});

test('not yet: a tab becomes one space, so words do not join', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: 'the\tdate\t\tis wrong' }, t.browser(TEST))).toMatchObject({
    status: 200,
  });
  expect(t.booking(TEST, token).not_yet_messages[0].text).toBe('the date  is wrong');
});

test('not yet sends a message that was not delivered again', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const say = () => t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: FIX }, t.browser(TEST));
  const stored = () => t.booking(TEST, token).not_yet_messages;
  const errors = silenceErrors();
  try {
    t.replyWith(async () => jsonResponse({ ok: false, error: 'bad_request' }));
    expect(await say()).toMatchObject({ status: 502, body: { error: 'not_delivered' } });
    expect(stored()).toEqual([{ at: START.toISOString(), text: FIX, sent: false, tries: 1 }]);
  } finally {
    errors.restore();
  }
  // The same text again, now with a working script: one more call, and still one entry.
  t.replyWith(async () => jsonResponse({ ok: true }));
  t.advance(60_000);
  expect(await say()).toMatchObject({ status: 200, body: { ok: true } });
  expect(t.calls).toHaveLength(2);
  expect(stored()).toEqual([{ at: START.toISOString(), text: FIX, sent: true, tries: 2 }]);
  // The notice says when they wrote it.
  expect(t.calls[1].fields.body).toContain('They wrote this on 10 November 2026 at 10:00 am (Toronto time):');
  // A third press within 10 minutes: delivered, so nothing is sent.
  t.advance(60_000);
  expect(await say()).toMatchObject({ status: 200, body: { ok: true } });
  expect(t.calls).toHaveLength(2);
  expect(stored()).toHaveLength(1);
});

test('not yet tries a message that is never delivered at most 5 times', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const say = () => t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: FIX }, t.browser(TEST));
  const errors = silenceErrors();
  try {
    t.replyWith(async () => jsonResponse({ ok: false, error: 'bad_request' }));
    for (let i = 1; i <= 5; i += 1) {
      expect(await say(), `try ${i}`).toMatchObject({ status: 502, body: { error: 'not_delivered' } });
      t.advance(60_000);
    }
    expect(t.calls).toHaveLength(5);
    expect(await say()).toMatchObject({ status: 429, body: { ok: false, error: 'too_many' } });
    expect(t.calls).toHaveLength(5);
    expect(t.booking(TEST, token).not_yet_messages).toEqual([{ at: START.toISOString(), text: FIX, sent: false, tries: 5 }]);
  } finally {
    errors.restore();
  }
});

test('not yet: an entry stored without delivery state counts as not sent, with 1 try', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const key = `agr:test:bk:${token}`;
  const old = t.booking(TEST, token);
  old.not_yet_at = START.toISOString();
  old.not_yet_messages = [{ at: START.toISOString(), text: FIX }];
  t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(old) });
  t.advance(60_000);
  expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: FIX }, t.browser(TEST))).toMatchObject({ status: 200 });
  expect(t.calls).toHaveLength(1);
  expect(t.booking(TEST, token).not_yet_messages).toEqual([{ at: START.toISOString(), text: FIX, sent: true, tries: 2 }]);
});

test('not yet answers 502 when the notice did not go out, and keeps the message', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const say = (message: string) => t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message }, t.browser(TEST));
  const errors = silenceErrors();
  try {
    t.replyWith(async () => jsonResponse({ ok: false, error: 'bad_request' }));
    expect(await say(FIX)).toMatchObject({ status: 502, body: { ok: false, error: 'not_delivered' } });
    t.replyWith(async () => new Response('down', { status: 500 }));
    expect(await say('Second try, other words.')).toMatchObject({ status: 502, body: { error: 'not_delivered' } });
    expect(errors.logged.filter((args) => String(args[0]).includes('notice not sent'))).toHaveLength(2);
  } finally {
    errors.restore();
  }
  expect(t.booking(TEST, token).not_yet_messages.map((m: { text: string }) => m.text)).toEqual([FIX, 'Second try, other words.']);
});

// ------------------------------------------------------------------ the PDF copy

const FAKE_PDF = new Uint8Array(Buffer.from(`%PDF-1.4\n${'x'.repeat(1200)}\n%%EOF`, 'latin1'));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const pdfAnswer = (base64: string | undefined = b64(FAKE_PDF)) => async (c: { fields: Record<string, string> }) =>
  c.fields.action === 'agreement_pdf' ? jsonResponse({ ok: true, pdf_base64: base64 }) : jsonResponse({ ok: true, sent_at: '2026-11-10T15:00:04.000Z' });

test('pdf: the unsigned copy of either variant downloads, made from the draft HTML', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  t.replyWith(pdfAnswer());
  for (const c of ['share', 'private'] as const) {
    const r = await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=${c}`);
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(FAKE_PDF);
    expect(Object.fromEntries(r.headers)).toEqual({
      'content-type': 'application/pdf',
      'content-disposition': 'attachment; filename="AD Photography agreement KK-TEST-2026-001 (not signed).pdf"',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': 'noindex, nofollow',
    });
    const call = t.calls[t.calls.length - 1];
    expect(Object.keys(call.fields).sort()).toEqual(['action', 'pdf_html', 'test', 'token']);
    expect(call.fields).toMatchObject({ action: 'agreement_pdf', token: ADMIN, test: '1' });
    expect(call.fields.pdf_html).toContain('<p class="agr-draft">Copy to read. Not signed.</p>');
    expect(call.fields.pdf_html).toContain(`<p>Sharing choice shown in this copy: ${c}. You choose when you sign.</p>`);
    expect(call.fields.pdf_html).toContain('This agreement is dated 10 November 2026.');
    expect(call.fields.pdf_html).not.toContain('Signed by');
  }
  expect(t.calls).toHaveLength(2);
  const key = (name: string) => `agr:test:pdf:${token}:${name}`;
  for (const c of ['share', 'private']) {
    expect(t.kv.store.get(key(`${c}:2026-11-10`))!.value).toEqual(FAKE_PDF);
    expect(t.kv.store.get(key(`${c}:2026-11-10`))!.expirationTtl).toBe(172800);
  }
  // The live site sends an empty test flag.
  const live = await t.create(LIVE);
  expect((await t.raw(LIVE, `/r/agreement/pdf?k=${live.token}&c=share`)).status).toBe(200);
  expect(t.calls[t.calls.length - 1].fields.test).toBe('');
});

test('pdf: a second call the same day comes from KV, the next day is made again', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  t.replyWith(pdfAnswer());
  const get = () => t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share`);
  expect((await get()).status).toBe(200);
  t.advance(6 * 3600_000);
  const again = await get();
  expect(again.status).toBe(200);
  expect(again.bytes).toEqual(FAKE_PDF);
  expect(again.headers.get('content-disposition')).toBe('attachment; filename="AD Photography agreement KK-TEST-2026-001 (not signed).pdf"');
  expect(t.calls).toHaveLength(1);
  t.advance(24 * 3600_000);
  expect((await get()).status).toBe(200);
  expect(t.calls).toHaveLength(2);
  expect(t.calls[1].fields.pdf_html).toContain('This agreement is dated 11 November 2026.');
  expect(t.kv.store.has(`agr:test:pdf:${token}:share:2026-11-11`)).toBe(true);
});

test('pdf: the signed copy is the emailed copy, whatever c says', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  await t.signOk(TEST, token, { choice: 'private', text_hash: t.hashOf(TEST, token, 'private') });
  await t.settle();
  t.replyWith(pdfAnswer());
  const before = t.calls.length;
  for (const q of ['', '&c=share', '&c=nonsense']) {
    const r = await t.raw(TEST, `/r/agreement/pdf?k=${token}${q}`);
    expect(r.status, q).toBe(200);
    expect(r.headers.get('content-disposition')).toBe('attachment; filename="AD Photography agreement KK-TEST-2026-001.pdf"');
    expect(r.bytes).toEqual(FAKE_PDF);
  }
  // Made once, cached for 30 days.
  expect(t.calls.length - before).toBe(1);
  expect(t.calls[before].fields.pdf_html).toBe(signedPdfHtml(t.signedRecord(TEST, token)));
  expect(t.kv.store.get(`agr:test:pdf:${token}:signed`)!.expirationTtl).toBe(2592000);
});

test('pdf: unknown token 404, void 410, bad choice 400, wrong method 405', async () => {
  const t = setup();
  const { token, number } = await t.create(TEST);
  t.replyWith(pdfAnswer());
  expect(await t.raw(TEST, `/r/agreement/pdf?k=${'C'.repeat(43)}&c=share`)).toMatchObject({ status: 404, body: { ok: false, error: 'not_found' } });
  for (const q of ['', '&c=', '&c=Share', '&c=both'])
    expect(await t.raw(TEST, `/r/agreement/pdf?k=${token}${q}`), q).toMatchObject({ status: 400, body: { ok: false, error: 'bad_choice' } });
  expect(await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share`, 'POST')).toMatchObject({ status: 405 });
  await t.admin(TEST, '/r/agreement/void', { number });
  expect(await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share`)).toMatchObject({ status: 410, body: { ok: false, error: 'void' } });
  expect(t.calls).toHaveLength(0);
});

test('pdf: anything but a real PDF answers 502 and caches nothing', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const get = () => t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share`);
  const small = new Uint8Array(Buffer.from(`%PDF-1.4 ${'x'.repeat(980)}`, 'latin1')); // 989 bytes
  const notPdf = new Uint8Array(Buffer.from(`<html>${'x'.repeat(1200)}`, 'latin1'));
  const answers: ((c: { fields: Record<string, string> }) => Promise<Response>)[] = [
    async () => new Response('down', { status: 500 }),
    async () => jsonResponse({ ok: false, error: 'pdf_failed: Conversion failed.' }),
    async () => jsonResponse({ ok: true }),
    async () => jsonResponse({ ok: true, pdf_base64: 42 }),
    pdfAnswer('not base64 at all!'),
    pdfAnswer(b64(notPdf)),
    pdfAnswer(b64(small)),
  ];
  const errors = silenceErrors();
  try {
    for (const [i, answer] of answers.entries()) {
      t.replyWith(answer);
      expect(await get(), `answer ${i}`).toMatchObject({ status: 502, body: { ok: false, error: 'pdf_unavailable' } });
    }
    expect(errors.logged.filter((args) => String(args[0]).includes('pdf not made'))).toHaveLength(answers.length);
  } finally {
    errors.restore();
  }
  expect([...t.kv.store.keys()].filter((k) => k.includes(':pdf:'))).toEqual([]);
  expect(t.calls).toHaveLength(answers.length);
});

test('pdf: the booking record is never changed, and a failed cache write still serves the PDF', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  t.replyWith(pdfAnswer());
  const key = `agr:test:bk:${token}`;
  const before = t.kv.store.get(key)!.value;
  const errors = silenceErrors();
  try {
    t.kv.failPuts = ['agr:test:pdf:'];
    const r = await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=private`);
    expect(r.status).toBe(200);
    expect(r.bytes).toEqual(FAKE_PDF);
    expect(errors.logged.some((args) => String(args[0]).includes('pdf cache write failed'))).toBe(true);
  } finally {
    errors.restore();
  }
  expect(t.kv.store.get(key)!.value).toBe(before);
  expect(t.booking(TEST, token).status).toBe('sent');
  expect(t.booking(TEST, token).opened_at).toBeUndefined();
});

// ------------------------------------------------------------------ D1: the write-once signed record

test('the migration creates the signed table and the number index', async () => {
  const { readFile } = await import('node:fs/promises');
  const sql = await readFile(new URL('../../migrations/0001_signed_agreements.sql', import.meta.url), 'utf8');
  expect(sql).toBe(
    [
      'CREATE TABLE IF NOT EXISTS signed_agreements (',
      "  mode TEXT NOT NULL CHECK (mode IN ('live', 'test')),",
      '  token TEXT NOT NULL,',
      '  number TEXT NOT NULL,',
      '  signed_at TEXT NOT NULL,',
      '  final_hash TEXT NOT NULL,',
      '  record TEXT NOT NULL,',
      '  PRIMARY KEY (mode, token)',
      ');',
      'CREATE UNIQUE INDEX IF NOT EXISTS signed_agreements_number ON signed_agreements (mode, number);',
      '',
    ].join('\n'),
  );
});

test('two signs with stale KV: the first choice stands', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const privateHash = t.hashOf(TEST, token, 'private');
  t.kv.freeze(); // the second request's edge cache still has the pre-sign booking and no signed: key
  const first = await t.signOk(TEST, token, { choice: 'share' });
  expect(first.body.signed.choice).toBe('share');
  t.advance(2_000);
  const second = await t.sign(TEST, token, { choice: 'private', text_hash: privateHash });
  expect(second.status).toBe(200);
  expect(second.body.already).toBe(true);
  expect(second.body.signed).toEqual(first.body.signed);
  expect(t.db.rows).toHaveLength(1);
  expect(JSON.parse(t.db.rows[0].record).choice).toBe('share');
  await t.settle();
  expect(t.calls).toHaveLength(1);
  expect(t.calls[0].fields.pdf_html).toContain('Sharing choice: share.');
  expect(JSON.parse(t.calls[0].fields.row_json).Sharing).toBe('share');
});

test('a sign that loses the insert answers from the winning row', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  await t.signOk(TEST, token, { choice: 'share' });
  await t.settle();
  const putsBefore = t.kv.puts.length;
  const pendingBefore = t.pending.length;
  // Both requests saw "not signed" (the first select is stale); the insert decides.
  t.kv.freeze();
  t.db.next.select = 'empty';
  t.advance(1_000);
  const late = await t.signOk(TEST, token, { choice: 'private' });
  expect(late.status).toBe(200);
  expect(late.body.already).toBe(true);
  expect(late.body.signed.choice).toBe('share');
  expect(t.db.inserts).toBe(2);
  expect(t.db.rows).toHaveLength(1);
  expect(t.kv.puts.length).toBe(putsBefore); // no booking update, no backup write
  expect(t.pending.length).toBe(pendingBefore); // no copy call
  await t.settle();
  expect(t.calls).toHaveLength(1);
});

test('the insert throws but the row landed: still signed, from the row', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    const { token } = await t.create(TEST);
    t.db.next.insert = 'throw-after';
    const r = await t.signOk(TEST, token);
    expect(r.status).toBe(200);
    expect(r.body.already).toBeUndefined();
    expect(r.body.signed.final_hash).toBe(t.signedRecord(TEST, token).final_hash);
    expect(t.db.rows).toHaveLength(1);
    expect(t.booking(TEST, token).status).toBe('signed');
    expect(t.pending).toHaveLength(1);
    await t.settle();
    expect(t.calls).toHaveLength(1);
  } finally {
    errors.restore();
  }
});

test('the insert throws and nothing landed: 503 and no change', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    const { token } = await t.create(TEST);
    const before = t.kv.store.get(`agr:test:bk:${token}`)!.value;
    const putsBefore = t.kv.puts.length;
    t.db.next.insert = 'throw-before';
    expect(await t.signOk(TEST, token)).toMatchObject({ status: 503, body: { ok: false, error: 'storage_unavailable' } });
    expect(t.db.rows).toHaveLength(0);
    expect(t.kv.store.get(`agr:test:bk:${token}`)!.value).toBe(before);
    expect(t.kv.puts.length).toBe(putsBefore);
    expect(t.pending).toHaveLength(0);
    // The read back failing is a 503 too, with nothing written.
    t.db.next.select = undefined;
    const b = await t.create(TEST);
    const bPuts = t.kv.puts.length;
    const realFirst = t.db.prepare.bind(t.db);
    let selects = 0;
    t.db.prepare = ((sql: string) => {
      const stmt = realFirst(sql);
      if (sql !== SELECT_SQL) return stmt;
      selects += 1;
      if (selects === 2) t.db.next.select = 'throw';
      return stmt;
    }) as typeof t.db.prepare;
    expect(await t.signOk(TEST, b.token)).toMatchObject({ status: 503, body: { error: 'storage_unavailable' } });
    expect(t.db.rows).toHaveLength(1); // the row is durable; the next visit shows it signed
    expect(t.kv.puts.length).toBe(bPuts);
    expect(t.pending).toHaveLength(0);
  } finally {
    errors.restore();
  }
});

test('a failed booking write after the insert: still signed, and the next visit repairs it', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    const { token } = await t.create(TEST);
    t.kv.failPuts = [`agr:test:bk:${token}`];
    const r = await t.signOk(TEST, token);
    expect(r).toMatchObject({ status: 200, body: { status: 'signed', copy: { status: 'pending' } } });
    await t.settle();
    expect(t.calls).toHaveLength(1); // the copy went out, but the booking could not record it
    expect(t.booking(TEST, token).status).toBe('sent');
    t.kv.failPuts = [];

    t.replyWith(async () => jsonResponse({ ok: true, already: true, sent_at: '2026-11-10T15:00:04.000Z' }));
    const visit = await t.doc(TEST, token);
    expect(visit).toMatchObject({ status: 200, body: { status: 'signed', signed: { choice: 'share' } } });
    await t.settle();
    expect(t.calls).toHaveLength(2);
    expect(t.booking(TEST, token)).toMatchObject({ status: 'signed', signed_at: START.toISOString(), copy: { status: 'sent', attempts: 1 } });
    t.advance(120_000);
    await t.doc(TEST, token);
    await t.settle();
    expect(t.calls).toHaveLength(2);
  } finally {
    errors.restore();
  }
});

test('doc trusts the D1 row over a booking that still says opened', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  await t.doc(TEST, token);
  const opened = t.kv.store.get(`agr:test:bk:${token}`)!;
  const r = await t.signOk(TEST, token, { choice: 'private' });
  await t.settle();
  t.kv.store.set(`agr:test:bk:${token}`, opened); // KV lost the update
  expect(JSON.parse(opened.value).status).toBe('opened');
  const visit = await t.doc(TEST, token);
  expect(visit.status).toBe(200);
  expect(visit.body).toMatchObject({ status: 'signed', signed: r.body.signed });
  await t.settle();
  expect(t.booking(TEST, token).status).toBe('signed');
});

test('live and test never mix: the same token gives two separate rows', async () => {
  const t = setup();
  const testB = await t.create(TEST);
  const liveB = await t.create(LIVE);
  // Put the live booking under the test booking's token.
  const rec = t.kv.json(`agr:live:bk:${liveB.token}`);
  t.kv.store.set(`agr:live:bk:${testB.token}`, { value: JSON.stringify({ ...rec, token: testB.token }) });
  expect(await t.signOk(TEST, testB.token)).toMatchObject({ status: 200, body: { number: 'KK-TEST-2026-001', mode: 'test' } });
  expect(await t.signOk(LIVE, testB.token, { choice: 'private' })).toMatchObject({ status: 200, body: { number: 'KK-2026-001', mode: 'live' } });
  expect(t.db.rows.map((r) => [r.mode, r.token, r.number])).toEqual([
    ['test', testB.token, 'KK-TEST-2026-001'],
    ['live', testB.token, 'KK-2026-001'],
  ]);
  expect((await t.doc(TEST, testB.token)).body.signed.choice).toBe('share');
  expect((await t.doc(LIVE, testB.token)).body.signed.choice).toBe('private');
  await t.settle();
  expect(t.calls.map((c) => c.fields.test)).toEqual(['1', '']);
});

test('void and resend decide on the D1 row', async () => {
  const t = setup();
  const { token, number } = await t.create(TEST);
  expect(await t.admin(TEST, '/r/agreement/resend', { number })).toMatchObject({ status: 409, body: { error: 'not_signed' } });
  await t.signOk(TEST, token);
  await t.settle();
  // Even if KV lost the signed status, D1 says signed.
  const bk = t.booking(TEST, token);
  await t.kv.put(`agr:test:bk:${token}`, JSON.stringify({ ...bk, status: 'opened' }));
  expect(await t.admin(TEST, '/r/agreement/void', { number })).toMatchObject({ status: 409, body: { ok: false, error: 'already_signed' } });
  // A fresh send has no `already`.
  t.replyWith(async () => jsonResponse({ ok: true, sent_at: '2026-11-10T15:00:09.000Z' }));
  const r = await t.admin(TEST, '/r/agreement/resend', { number });
  expect(r.status).toBe(200);
  expect(r.body.already).toBeUndefined();
  expect(r.body.copy.status).toBe('sent');
});

test('missing AGREEMENTS_DB answers 503, and not yet still works', async () => {
  const t = setup({ db: false });
  const unavailable = { status: 503, body: { ok: false, error: 'storage_unavailable' } };
  expect(await t.admin(TEST, '/r/agreement/new', PILOT)).toMatchObject(unavailable);
  expect(t.kv.puts).toEqual([]);
  // A booking made while D1 was there.
  const withDb = setup();
  const { token, number } = await withDb.create(TEST);
  (withDb.env as { AGREEMENTS_DB?: unknown }).AGREEMENTS_DB = undefined;
  expect(await withDb.doc(TEST, token)).toMatchObject(unavailable);
  expect(await withDb.signOk(TEST, token)).toMatchObject(unavailable);
  expect(await withDb.admin(TEST, '/r/agreement/void', { number })).toMatchObject(unavailable);
  expect(await withDb.admin(TEST, '/r/agreement/resend', { number })).toMatchObject(unavailable);
  expect(await withDb.call(TEST, 'POST', '/r/agreement/not-yet', { k: token, message: 'Please fix the date.' }, withDb.browser(TEST))).toMatchObject({
    status: 200,
    body: { ok: true },
  });
  await withDb.settle();
  expect(withDb.calls.map((c) => c.fields.action)).toEqual(['agreement_notice']);
});

test('a storage read that throws answers 503', async () => {
  const t = setup();
  const errors = silenceErrors();
  try {
    const { token, number } = await t.create(TEST);
    t.kv.failGets = ['agr:test:bk:'];
    expect(await t.doc(TEST, token)).toMatchObject({ status: 503, body: { ok: false, error: 'storage_unavailable' } });
    expect(await t.sign(TEST, token, { text_hash: 'x' })).toMatchObject({ status: 503 });
    t.kv.failGets = ['agr:test:num:'];
    expect(await t.admin(TEST, '/r/agreement/void', { number })).toMatchObject({ status: 503 });
    expect(await t.admin(TEST, '/r/agreement/new', PILOT)).toMatchObject({ status: 503 });
    t.kv.failGets = [];
    t.db.next.select = 'throw';
    expect(await t.doc(TEST, token)).toMatchObject({ status: 503, body: { error: 'storage_unavailable' } });
    expect((await t.doc(TEST, token)).status).toBe(200);
  } finally {
    errors.restore();
  }
});

// ------------------------------------------------------------------ plumbing

test('storage_unavailable without the KV binding', async () => {
  const t = setup({ kv: false });
  const unavailable = { status: 503, body: { ok: false, error: 'storage_unavailable' } };
  expect(await t.admin(TEST, '/r/agreement/new', PILOT)).toMatchObject(unavailable);
  expect(await t.admin(LIVE, '/r/agreement/void', { number: 'KK-2026-001' })).toMatchObject(unavailable);
  expect(await t.admin(LIVE, '/r/agreement/resend', { number: 'KK-2026-001' })).toMatchObject(unavailable);
  expect(await t.doc(LIVE, 'A'.repeat(43))).toMatchObject(unavailable);
  expect(await t.sign(LIVE, 'A'.repeat(43), { text_hash: 'x' })).toMatchObject(unavailable);
  expect(await t.call(LIVE, 'POST', '/r/agreement/not-yet', { k: 'A'.repeat(43) }, t.browser(LIVE))).toMatchObject(unavailable);
  expect(t.calls).toHaveLength(0);
});

test('wrong method, big bodies and bad bodies are refused', async () => {
  const t = setup();
  expect(await t.call(LIVE, 'GET', '/r/agreement/sign')).toMatchObject({ status: 405, body: { ok: false, error: 'method_not_allowed' } });
  expect(await t.call(LIVE, 'POST', '/r/agreement/doc', {}, t.browser(LIVE))).toMatchObject({ status: 405 });
  expect(await t.call(LIVE, 'GET', '/r/agreement/new')).toMatchObject({ status: 405 });
  expect(await t.call(LIVE, 'GET', '/r/agreement/nope')).toMatchObject({ status: 404, body: { ok: false, error: 'not_found' } });
  const big = JSON.stringify({ ...PILOT, notes: 'x'.repeat(17000) });
  expect(await t.admin(LIVE, '/r/agreement/new', big)).toMatchObject({ status: 413, body: { ok: false, error: 'too_large' } });
  expect(await t.call(LIVE, 'POST', '/r/agreement/sign', big, t.browser(LIVE))).toMatchObject({ status: 413 });
  for (const bad of ['[1,2]', 'not json', '"text"', 'null', '']) {
    expect(await t.admin(LIVE, '/r/agreement/new', bad)).toMatchObject({ status: 400, body: { ok: false, error: 'bad_body' } });
  }
  expect(t.kv.puts).toEqual([]);
});

test('callAppsScript follows the redirect and returns null on any failure', async () => {
  const seen: { url: string; method: string; redirect?: string; body?: string }[] = [];
  const stub = (answer: (n: number) => Response | Promise<Response>) =>
    (async (url: string | URL | Request, init: RequestInit = {}) => {
      seen.push({ url: String(url), method: init.method ?? 'GET', redirect: init.redirect, body: init.body ? String(init.body) : undefined });
      return answer(seen.length);
    }) as typeof fetch;

  const echo = 'https://script.googleusercontent.com/macros/echo?user_content_key=abc';
  const redirected = await callAppsScript(
    { action: 'agreement_ping', token: 't&=x' },
    { fetchImpl: stub((n) => (n === 1 ? new Response(null, { status: 302, headers: { location: echo } }) : jsonResponse({ ok: true, agreements: 1 }))) },
  );
  expect(redirected).toEqual({ ok: true, agreements: 1 });
  expect(seen[0]).toEqual({ url: APPS_SCRIPT_URL, method: 'POST', redirect: 'manual', body: 'action=agreement_ping&token=t%26%3Dx' });
  expect(seen[1]).toMatchObject({ url: echo, method: 'GET' });

  expect(await callAppsScript({ a: '1' }, { fetchImpl: stub(() => jsonResponse({ ok: false, error: 'x' })) })).toEqual({ ok: false, error: 'x' });
  expect(await callAppsScript({ a: '1' }, { fetchImpl: stub(() => jsonResponse({ ok: true }, 500)) })).toBeNull();
  expect(await callAppsScript({ a: '1' }, { fetchImpl: stub(() => new Response('<html>oops</html>')) })).toBeNull();
  expect(await callAppsScript({ a: '1' }, { fetchImpl: stub(() => jsonResponse([1, 2])) })).toBeNull();
  expect(await callAppsScript({ a: '1' }, { fetchImpl: stub(() => new Response(null, { status: 302 })) })).toBeNull();
  expect(
    await callAppsScript({ a: '1' }, {
      fetchImpl: stub(() => {
        throw new Error('offline');
      }),
    }),
  ).toBeNull();
  // A hung upstream is cut off by the timeout.
  const hung = (async (_url: string | URL | Request, init: RequestInit = {}) =>
    new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch;
  const started = Date.now();
  expect(await callAppsScript({ a: '1' }, { fetchImpl: hung, timeoutMs: 30 })).toBeNull();
  expect(Date.now() - started).toBeLessThan(2000);
});

test('existing routes still work', async () => {
  const kv = new FakeKV();
  const env = {
    ASSETS: { fetch: async () => new Response('asset') },
    AGREEMENTS_KV: kv as unknown as KVNamespace,
    AGREEMENTS_DB: new FakeD1(),
    FORMS_ADMIN_TOKEN: ADMIN,
  } as any;
  const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as any;

  const ping = await worker.fetch(new Request(`${LIVE}/__diag/ping`, { headers: { 'cf-ray': 'r1' } }), env, ctx);
  expect(ping.status).toBe(200);
  expect(await ping.json()).toMatchObject({ ok: true, ray: 'r1' });

  // The onboarding route still answers itself (no trailing-slash 301).
  const onboarding = await worker.fetch(new Request(`${LIVE}/r/onboarding`, { method: 'POST', body: 'x=1' }), env, ctx);
  expect(onboarding.status).toBe(403);
  expect(await onboarding.json()).toEqual({ ok: false, error: 'forbidden' });
  const intake = await worker.fetch(new Request(`${LIVE}/r/intake`), env, ctx);
  expect(intake.status).toBe(405);

  // The agreement routes are wired above the trailing-slash 301.
  const agr = await worker.fetch(new Request(`${LIVE}/r/agreement/doc?k=${'A'.repeat(43)}`), env, ctx);
  expect(agr.status).toBe(404);
  expect(await agr.json()).toEqual({ ok: false, error: 'not_found' });

  const page = await worker.fetch(new Request(`${LIVE}/about`), env, ctx);
  expect(page.status).toBe(301);
  expect(page.headers.get('location')).toBe(`${LIVE}/about/`);
});

// ------------------------------------------------------------------ a wedding: three payments

// Invented people only.
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
// The later payments of the wedding booked before the payment change (oldRecord('wedding-noset-fee'), second
// photographer hours only, $3,010.00): what its summary and its email still say.
const OLD_WEDDING_LATER = [
  {
    label: 'Second payment',
    text: '$753.00 by e-transfer. Due 7 days after I deliver your engagement session gallery. If you have not had your engagement session by Tuesday 30 March 2027, it is due on that date.',
  },
  { label: 'Final payment', text: '$752.00 by e-transfer. Due by Saturday 15 May 2027, which is 14 days before your wedding.' },
];

test('a wedding booking answers with its two payments, and a wedding booked before still with its three', async () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): a new wedding is paid in two
  // parts, 25% by e-transfer and the balance in cash on the day (was 1,566 / 783 / 782.25, three parts).
  const t = setup();
  const r = await t.admin(TEST, '/r/agreement/new', WEDDING);
  expect(r.status).toBe(200);
  expect(r.body).toEqual({
    ok: true,
    number: 'KK-TEST-2026-001',
    token: r.body.token,
    path: `/welcome/agreement/?k=${r.body.token}`,
    mode: 'test',
    total: 3131.25,
    retainer: 783,
    balance: 2348.25,
    balance_cash: true,
    private_fee: 75,
    private_total: 3206.25,
    private_retainer: 802,
    // RAW photos are booked, so they are not a tick box any more.
    tick_boxes: [
      { id: 'instax-guest-prints', kind: 'price', label: 'Instax guest prints', amount: 60 },
      { id: 'guest-camera', kind: 'deposit', label: 'Guest camera', amount: 100 },
    ],
  });
  const opened = await t.doc(TEST, r.body.token);
  expect(opened.body.summary).toEqual({
    package: 'The Full Day',
    date: 'Saturday 29 May 2027',
    total: '$3,131.25',
    retainer: '$783.00',
    balance: '$2,348.25',
    balance_how: 'in cash',
    etransfer_email: NEW_ETRANSFER,
    total_line: 'Your total is $3,131.25. It stays the same even if my website prices change later.',
    price_lines: [
      { label: 'The Full Day', amount: '$2,301.25' },
      { label: 'Second photographer, extra hours, 7 × $101.25', amount: '$708.75' },
      { label: 'RAW photos', amount: '$121.25' },
    ],
    steps: [
      { title: 'When you sign', amount: '$783.00', note: 'By e-transfer. Your date is held once this arrives.' },
      { title: 'On your wedding day', amount: '$2,348.25', note: 'In cash, before I start shooting.' },
    ],
  });
  const facts = t.booking(TEST, r.body.token).facts;
  expect(facts).toMatchObject({ second_hours: 10, retainer_percent: 25, etransfer_email: NEW_ETRANSFER });
  for (const k of ['second_payment', 'final_payment', 'second_due', 'final_due']) expect(facts, k).not.toHaveProperty(k);
  for (const m of Object.values<any>(t.booking(TEST, r.body.token).set.mixes)) expect(m.summary).not.toHaveProperty('later_payments');

  // A wedding booked before the change keeps its three payments, in its stored summary and its stored text.
  const o = setup();
  const old = o.putOld('wedding-noset-fee');
  const oldOpened = await o.doc(TEST, old.token);
  expect(oldOpened.body.summary).toEqual(old.summary);
  expect(oldOpened.body.summary.later_payments).toEqual(OLD_WEDDING_LATER);
  expect(oldOpened.body.summary).toMatchObject({ total: '$3,010.00', retainer: '$1,505.00', etransfer_email: 'info@kashklicks.ca' });
  expect(oldOpened.body.variants.share.doc_json).toBe(old.variants.share.doc_json);
  expect(old.variants.share.doc_json).toContain('Second payment');

  // The civil booking has none of it.
  const civil = await t.admin(TEST, '/r/agreement/new', PILOT);
  expect(civil.body).not.toHaveProperty('second_payment');
  expect(civil.body).not.toHaveProperty('final_payment');
  expect((await t.doc(TEST, civil.body.token)).body.summary).not.toHaveProperty('later_payments');
  expect(civil.body).not.toHaveProperty('private_fee');
  expect(await t.doc(TEST, civil.body.token)).not.toHaveProperty('body.summary_private');
});

test('a wedding the agreement has no clause for is refused before a number is used', async () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.6): balance_cash and a wedding soon
  // after booking (no 60 day limit) are accepted now; a set retainer is still refused, and so is a past date.
  const t = setup();
  for (const [over, error, field] of [
    [{ balance_cash: 'yes' }, 'bad_balance_cash', 'balance_cash'],
    [{ retainer: 1000 }, 'bad_retainer', 'retainer'],
    [{ event_date: '2026-11-09' }, 'bad_date', 'event_date'],
    [{ add_ons: [{ id: 'second-photographer', qty: 8 }] }, 'bad_add_on', 'add_ons'],
    [{ add_ons: [{ id: 'priority-delivery-wedding', qty: 1 }] }, 'bad_add_on', 'add_ons'],
  ] as const) {
    expect(await t.admin(TEST, '/r/agreement/new', { ...WEDDING, ...over }), error).toMatchObject({ status: 400, body: { ok: false, error, field } });
  }
  expect(t.kv.puts).toEqual([]);
  // Accepted now: cash only or either way, and a wedding 30 days ahead.
  expect(await t.admin(TEST, '/r/agreement/new', { ...WEDDING, balance_cash: true })).toMatchObject({ status: 200, body: { balance_cash: true } });
  expect(await t.admin(TEST, '/r/agreement/new', { ...WEDDING, balance_cash: false })).toMatchObject({ status: 200, body: { balance_cash: false } });
  const soon = await t.admin(TEST, '/r/agreement/new', { ...WEDDING, event_date: '2026-12-10' });
  expect(soon).toMatchObject({ status: 200, body: { ok: true, total: 3131.25, retainer: 783, balance: 2348.25 } });
  expect(soon.body).not.toHaveProperty('second_payment');
});

test('a package with a payments setting is refused, before a number is used', async () => {
  // Spec 2026-11-23, section 5.3: no package is paid in three parts any more.
  const pkg = (agreementPackages as Record<string, any>)['wedding-full'];
  const t = setup();
  const quiet = silenceErrors();
  try {
    pkg.payments = 'three-part';
    expect(await t.admin(TEST, '/r/agreement/new', WEDDING)).toMatchObject({ status: 500, body: { ok: false, error: 'server_error' } });
    expect(t.kv.puts).toEqual([]);
    expect(String(quiet.logged[0]?.[1])).toContain('payments is not a package setting any more');
  } finally {
    delete pkg.payments;
    quiet.restore();
  }
  expect((await t.admin(TEST, '/r/agreement/new', WEDDING)).status).toBe(200);
});

test('the email after signing a wedding names the retainer and the balance; a wedding booked before, its second and final payment', async () => {
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): a new wedding pays the
  // retainer by e-transfer to the new address and the balance in cash; the email balance line is the one
  // of every two payment booking. A wedding booked before keeps the email it had (three payments).
  const t = setup();
  // Not t.create: that merges in the civil booking's price and notes.
  const { token } = (await t.admin(TEST, '/r/agreement/new', WEDDING)).body;
  const signed = await t.signOk(TEST, token, { signed_name: 'Elena Marchetti' });
  expect(signed.status).toBe(200);
  expect(signed.body.summary).not.toHaveProperty('later_payments');
  await t.settle();
  expect(t.calls).toHaveLength(1);
  const f = t.calls[0].fields;
  expect(f.email_body).toBe(
    [
      'Hi Elena,',
      '',
      'Thank you for signing. Your signed agreement is attached as a PDF. Please keep it.',
      '',
      'Next step: send the retainer of $783.00 by Interac e-transfer to kashklicks.ca@gmail.com. Please put your booking number, KK-TEST-2026-001, in the message. Your date is held once the retainer arrives.',
      '',
      'The balance of $2,348.25 is due on or before the day, in cash.',
      '',
      'If anything looks wrong, just reply to this email.',
      '',
      'Warmly,',
      'Kash',
      'AD Photography',
      'kashklicks.ca',
    ].join('\n'),
  );
  expect(f.email_body).not.toMatch(/second payment|final payment/i);
  expect(f.email_subject + f.email_body).not.toMatch(/[–—]/);
  // The Contracts row keeps its columns. Balance is what is left after the retainer.
  const row = JSON.parse(f.row_json);
  expect(Object.keys(row)).toEqual([
    'Signed at', 'Booking number', 'Client', 'Partner', 'Email', 'Phone', 'Package', 'Event date',
    'Total', 'Retainer', 'Balance', 'Sharing', 'Signed name', 'Text hash', 'Clause version', 'Notes',
  ]);
  expect(row).toMatchObject({ Package: 'The Full Day', 'Event date': '2027-05-29', Total: '$3,131.25', Retainer: '$783.00', Balance: '$2,348.25' });
  expect(f.pdf_html).toContain('Balance, due on your wedding day');
  expect(f.pdf_html).not.toContain('Second payment');
  expect(f.pdf_html).not.toContain('Final payment');

  // A wedding booked before the change: the email of that time, word for word.
  const o = setup();
  const old = o.putOld('wedding-noset-fee');
  const oldSigned = await o.sign(TEST, old.token, { signed_name: 'Elena Marchetti', text_hash: old.variants.share.hash });
  expect(oldSigned.status).toBe(200);
  expect(oldSigned.body.summary.later_payments).toEqual(OLD_WEDDING_LATER);
  await o.settle();
  const g = o.calls[0].fields;
  expect(g.email_body).toBe(
    [
      'Hi Elena,',
      '',
      'Thank you for signing. Your signed agreement is attached as a PDF. Please keep it.',
      '',
      `Next step: send the retainer of $1,505.00 by Interac e-transfer to info@kashklicks.ca. Please put your booking number, ${old.number}, in the message. Your date is held once the retainer arrives.`,
      '',
      'The second payment of $753.00 is due 7 days after I deliver your engagement session gallery. If you have not had your engagement session by Tuesday 30 March 2027, it is due on that date.',
      '',
      'The final payment of $752.00 is due by Saturday 15 May 2027.',
      '',
      'If anything looks wrong, just reply to this email.',
      '',
      'Warmly,',
      'Kash',
      'AD Photography',
      'kashklicks.ca',
    ].join('\n'),
  );
  expect(g.email_body).not.toMatch(/balance/i);
  expect(JSON.parse(g.row_json)).toMatchObject({ Total: '$3,010.00', Retainer: '$1,505.00', Balance: '$1,505.00' });
  expect(g.pdf_html).toContain('Second payment');
  expect(g.pdf_html).toContain('Final payment');
});

// ------------------------------------------------------------------ a wedding: the marketing fee for private work

const WEDDING_SECOND_ONLY = { ...WEDDING, add_ons: [{ id: 'second-photographer', qty: 7 }] };

test('a wedding booking stores the private summary next to the share one', async () => {
  const t = setup();
  const r = await t.admin(TEST, '/r/agreement/new', WEDDING_SECOND_ONLY);
  // Re-pinned for the payment change (spec 2026-11-23, section 5.5): 753.00 / 2,257.00, private 3,085.00: 772.00 / 2,313.00.
  expect(r.body).toMatchObject({ total: 3010, retainer: 753, balance: 2257, private_fee: 75, private_total: 3085, private_retainer: 772 });
  expect(r.body).not.toHaveProperty('second_payment');
  expect(r.body).not.toHaveProperty('final_payment');
  const bk = t.booking(TEST, r.body.token);
  expect(bk.facts.private_fee).toBe(75);
  expect(bk.facts.total).toBe(3010);
  // One summary per mix, in the set: `share` and `private` are the nothing ticked ones.
  expect(bk).not.toHaveProperty('summary');
  expect(bk).not.toHaveProperty('summary_private');
  const share = bk.set.mixes.share.summary;
  const priv = bk.set.mixes.private.summary;
  expect(share).toMatchObject({ total: '$3,010.00', retainer: '$753.00', balance: '$2,257.00' });
  expect(priv).toEqual({
    package: 'The Full Day',
    date: 'Saturday 29 May 2027',
    total: '$3,085.00',
    retainer: '$772.00',
    balance: '$2,313.00',
    balance_how: 'in cash',
    etransfer_email: NEW_ETRANSFER,
    total_line: 'Your total is $3,085.00. It stays the same even if my website prices change later.',
    price_lines: [
      { label: 'The Full Day', amount: '$2,301.25' },
      { label: 'Second photographer, extra hours, 7 × $101.25', amount: '$708.75' },
      { label: 'Marketing fee for private work', amount: '$75.00' },
    ],
    steps: [
      { title: 'When you sign', amount: '$772.00', note: 'By e-transfer. Your date is held once this arrives.' },
      { title: 'On your wedding day', amount: '$2,313.00', note: 'In cash, before I start shooting.' },
    ],
  });
  const opened = await t.doc(TEST, r.body.token);
  expect(opened.body.summary).toEqual(share);
  expect(opened.body.summary_private).toEqual(priv);
});

const signedWedding = async (choice: 'share' | 'private') => {
  const t = setup();
  const { token } = (await t.admin(TEST, '/r/agreement/new', WEDDING_SECOND_ONLY)).body;
  const signed = await t.signOk(TEST, token, { signed_name: 'Elena Marchetti', choice });
  expect(signed.status).toBe(200);
  await t.settle();
  expect(t.calls).toHaveLength(1);
  return { t, token, signed, f: t.calls[0].fields, rec: t.signedRecord(TEST, token) };
};

test('signing a wedding as private records the private amounts, in the email and the sheet row too', async () => {
  const { signed, f, rec, t, token } = await signedWedding('private');
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): 3,085.00 = 772.00 + 2,313.00 in cash.
  expect(rec.facts).toMatchObject({ total: 3085, retainer: 772, balance: 2313, sharing_fee: 75, private_fee: 75, retainer_percent: 25 });
  expect(rec.facts).not.toHaveProperty('second_payment');
  expect(rec.summary.retainer).toBe('$772.00');
  expect(rec.summary.total).toBe('$3,085.00');
  expect(signed.body.summary.retainer).toBe('$772.00');
  // The booking keeps the share facts; the signed record holds the signed choice.
  expect(t.booking(TEST, token).facts.total).toBe(3010);
  expect(f.email_body).toContain('send the retainer of $772.00 by Interac e-transfer to kashklicks.ca@gmail.com');
  expect(f.email_body).toContain('The balance of $2,313.00 is due on or before the day, in cash.');
  expect(f.email_body).not.toMatch(/second payment|final payment/i);
  expect(f.email_body).not.toMatch(/[–—]/);
  const row = JSON.parse(f.row_json);
  expect(row).toMatchObject({ Total: '$3,085.00', Retainer: '$772.00', Balance: '$2,313.00', Sharing: 'private' });
  expect(Object.keys(row)).toEqual([
    'Signed at', 'Booking number', 'Client', 'Partner', 'Email', 'Phone', 'Package', 'Event date',
    'Total', 'Retainer', 'Balance', 'Sharing', 'Signed name', 'Text hash', 'Clause version', 'Notes',
  ]);
  expect(f.pdf_html).toContain('Marketing fee for private work');
  // A later visit answers from the signed record.
  const again = await t.doc(TEST, token);
  expect(again.body.summary.total).toBe('$3,085.00');
});

test('signing a wedding as share keeps the amounts without the fee', async () => {
  const { f, rec } = await signedWedding('share');
  // Re-pinned for the payment change (spec 2026-11-23, section 5.5): 3,010.00 = 753.00 + 2,257.00 in cash.
  expect(rec.facts).toMatchObject({ total: 3010, retainer: 753, balance: 2257 });
  expect(rec.facts).not.toHaveProperty('second_payment');
  expect(rec.facts).not.toHaveProperty('sharing_fee');
  expect(rec.summary.retainer).toBe('$753.00');
  expect(f.email_body).toContain('send the retainer of $753.00');
  expect(f.email_body).toContain('The balance of $2,257.00 is due on or before the day, in cash.');
  expect(f.email_body).not.toMatch(/second payment|final payment/i);
  expect(JSON.parse(f.row_json)).toMatchObject({ Total: '$3,010.00', Retainer: '$753.00', Balance: '$2,257.00', Sharing: 'share' });
  expect(f.pdf_html).not.toContain('Marketing fee for private work');
});

test('a wedding stored before the fee existed signs as before', async () => {
  const t = setup();
  const { token } = (await t.admin(TEST, '/r/agreement/new', WEDDING_SECOND_ONLY)).body;
  const key = `agr:test:bk:${token}`;
  // Made before sets too: two full texts and the summary.
  const old = t.toOld(TEST, token);
  delete old.facts.private_fee;
  delete old.summary_private;
  t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(old) });
  expect(await t.doc(TEST, token)).not.toHaveProperty('body.summary_private');
  await t.signOk(TEST, token, { signed_name: 'Elena Marchetti', choice: 'private' });
  await t.settle();
  const rec = t.signedRecord(TEST, token);
  expect(rec.facts.total).toBe(3010);
  expect(rec.facts).not.toHaveProperty('sharing_fee');
  expect(rec.summary).toEqual(old.summary);
});

test('a wedding stored before sets, with its fee, signs as private with its stored private summary', async () => {
  // Every booking in KV before this build has this shape: two full texts, summary and summary_private.
  // Re-pinned for the payment change (spec 2026-11-23, section 5.6): a real booking made by the code of that
  // time (three payments, 50%), no more a new booking rewritten into the old shape.
  const t = setup();
  const old = t.putOld('wedding-noset-fee');
  const token = old.token;
  expect(old.facts.private_fee).toBe(75);
  expect(old.summary_private).toBeDefined();
  expect(old.summary_private).not.toEqual(old.summary);
  // One stored field changed, so a summary worked out again would show.
  old.summary_private.etransfer_email = 'old-address@example.com';
  const key = `agr:test:bk:${token}`;
  t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(old) });
  const opened = await t.doc(TEST, token);
  expect(opened.status).toBe(200);
  expect(opened.body.summary_private.etransfer_email).toBe('old-address@example.com');
  const signed = await t.sign(TEST, token, { signed_name: 'Elena Marchetti', choice: 'private', text_hash: old.variants.private.hash });
  expect(signed.status).toBe(200);
  await t.settle();
  const rec = t.signedRecord(TEST, token);
  // The stored private summary, not the share one and not one worked out again.
  expect(rec.summary).toEqual(old.summary_private);
  expect(rec.summary.etransfer_email).toBe('old-address@example.com');
  expect(rec.summary.retainer).toBe('$1,543.00');
  expect(signed.body.summary).toEqual(old.summary_private);
  expect(signed.body.summary.etransfer_email).toBe('old-address@example.com');
  expect(rec.facts).toMatchObject({ total: 3085, retainer: 1543, balance: 1542, second_payment: 772, final_payment: 770, sharing_fee: 75 });
  expect(rec.facts).toEqual(factsFor(old.facts, 'private'));
  expect(rec).not.toHaveProperty('extras');
  expect(rec).not.toHaveProperty('page');
  expect(rec.final_doc_json.replace('10 November 2026', SIGN_DATE_TOKEN)).toBe(old.variants.private.doc_json);
  expect(t.calls[0].fields.email_body).toContain('send the retainer of $1,543.00 by Interac e-transfer to info@kashklicks.ca.');
  expect(t.calls[0].fields.email_body).toContain('The second payment of $772.00 is due 7 days after');
  expect(t.calls[0].fields.email_body).toContain('The final payment of $770.00 is due by Saturday 15 May 2027.');
});

// ------------------------------------------------------------------ the set: every mix of a booking, frozen when the link is made

const ALL_WEDDING_TICKS = ['raw-photos-wedding', 'instax-guest-prints', 'guest-camera'];
// Re-pinned for the payment change (spec 2026-11-23, section 5.3): paid with the balance.
// Re-pinned for spec 2026-11-23, section 5.8: paid together with the balance (no payment method named).
const CAMERA_NOTE = 'Refundable, and not part of your total. Paid together with your balance, on your wedding day. I return it within 7 days after your wedding, when the camera comes back working and undamaged.';
const newWedding = async (t: ReturnType<typeof setup>, input: Record<string, unknown> = WEDDING_SECOND_ONLY) => {
  const r = await t.admin(TEST, '/r/agreement/new', input);
  expect(r.status).toBe(200);
  return r.body as { number: string; token: string };
};
const v2Doc = (t: ReturnType<typeof setup>, k: string, v = '2') => t.call(TEST, 'GET', `/r/agreement/doc?k=${k}&v=${v}`);

test('a new booking stores a set of every mix and its page content, and no full texts', async () => {
  const t = setup();
  const putsBefore = t.kv.puts.length;
  const { token } = await newWedding(t);
  expect(t.kv.puts.length).toBe(putsBefore + 3); // still three keys per booking
  const rec = t.booking(TEST, token);
  expect(JSON.stringify(rec.facts)).toBe(JSON.stringify(buildBookingFacts(WEDDING_SECOND_ONLY, { number: rec.number, createdAt: START })));
  expect(rec.clause_version).toBe((clausesJson as any).version);
  for (const gone of ['variants', 'summary', 'summary_private']) expect(rec, gone).not.toHaveProperty(gone);
  expect(Object.keys(rec.set).sort()).toEqual(['mixes', 'pool']);
  expect(rec.labels.name_expected).toBe('Elena Marchetti');
  expect(rec.page).toEqual(pageContent(rec.facts));
  expect(rec.page.extras.ticks.map((x: { id: string }) => x.id)).toEqual(ALL_WEDDING_TICKS);

  // 2 choices x 8 subsets of the 3 tick boxes, in mix order. Every mix rebuilds to the text the engine renders, and to its hash.
  const mixes = mixesOf(rec.facts);
  expect(Object.keys(rec.set.mixes)).toEqual(mixes.map((m) => m.id));
  expect(mixes).toHaveLength(16);
  expect(new Set(rec.set.pool).size).toBe(rec.set.pool.length);
  const hashes = new Set<string>();
  for (const m of mixes) {
    const stored = rec.set.mixes[m.id];
    expect(Object.keys(stored).sort(), m.id).toEqual(['f', 'hash', 'summary']);
    const doc_json = docJsonFromSet(rec.set.pool, stored.f);
    expect(doc_json, m.id).toBe(JSON.stringify(renderVariant(rec.facts, m.choice, m.extras)));
    expect(doc_json.split(SIGN_DATE_TOKEN), m.id).toHaveLength(2);
    expect(stored.hash, m.id).toBe(await sha256Hex(doc_json));
    expect(stored.summary, m.id).toEqual(mixSummary(rec.facts, m.choice, m.extras));
    hashes.add(stored.hash);
  }
  expect(hashes.size).toBe(16);
  // The nothing ticked texts are the ones a booking made before sets would hold.
  expect(docJsonFromSet(rec.set.pool, rec.set.mixes.share.f)).toBe(JSON.stringify(renderVariant(rec.facts, 'share')));
  expect(rec.set.mixes['share+guest-camera'].summary.deposit).toEqual({ label: 'Guest camera deposit', amount: '$100.00', note: CAMERA_NOTE });
  // About the size of a booking made before sets (two full texts), not 16 full texts.
  const size = t.kv.store.get(`agr:test:bk:${token}`)!.value.length;
  const oldSize = JSON.stringify(legacy(rec)).length;
  expect(size).toBeLessThan(oldSize * 1.6);
});

test('doc: v=2 gives the set and the page of a new booking; without it, and for an old booking, today\'s shape', async () => {
  const t = setup();
  const { token } = await newWedding(t);
  const stored = t.booking(TEST, token);
  // The first open flips sent to opened, with v=2 too.
  const v2 = await v2Doc(t, token);
  expect(v2.status).toBe(200);
  expect(t.booking(TEST, token).status).toBe('opened');
  expect(v2.body).toEqual({
    ok: true,
    status: 'opened',
    mode: 'test',
    today: '10 November 2026',
    number: 'KK-TEST-2026-001',
    client_first: 'Elena',
    partner_first: 'Daniel',
    client_name: 'Elena Marchetti',
    partner_name: 'Daniel Okafor',
    labels: stored.labels,
    summary: stored.set.mixes.share.summary,
    summary_private: stored.set.mixes.private.summary,
    set: stored.set,
    page: stored.page,
  });
  // Every mix in the answer rebuilds to its hash.
  for (const [id, m] of Object.entries<any>(v2.body.set.mixes)) expect(await sha256Hex(docJsonFromSet(v2.body.set.pool, m.f)), id).toBe(m.hash);

  // Without v=2 (and with any other v): today's shape, the nothing ticked texts rebuilt from the set.
  const plain = await t.doc(TEST, token);
  const { set: _set, page: _page, ...rest } = v2.body;
  const variants = {
    share: { doc_json: docJsonFromSet(stored.set.pool, stored.set.mixes.share.f), hash: stored.set.mixes.share.hash },
    private: { doc_json: docJsonFromSet(stored.set.pool, stored.set.mixes.private.f), hash: stored.set.mixes.private.hash },
  };
  expect(plain.body).toEqual({ ...rest, variants });
  expect(Object.keys(plain.body)).toEqual([
    'ok', 'status', 'mode', 'today', 'number', 'client_first', 'partner_first', 'client_name', 'partner_name',
    'variants', 'labels', 'summary', 'summary_private',
  ]);
  for (const v of ['1', '3', '']) expect((await v2Doc(t, token, v)).body, v).toEqual(plain.body);

  // A civil booking has no fee: no summary_private, with or without v=2.
  const civil = await t.create(TEST);
  expect(await v2Doc(t, civil.token)).not.toHaveProperty('body.summary_private');
  expect((await v2Doc(t, civil.token)).body.page.title).toBe('Your agreement');

  // A booking made before sets answers today's shape with v=2 too: no set, no page.
  const old = await newWedding(t);
  const oldRec = t.toOld(TEST, old.token);
  const oldV2 = await v2Doc(t, old.token);
  expect(oldV2.body).not.toHaveProperty('set');
  expect(oldV2.body).not.toHaveProperty('page');
  expect(oldV2.body.variants).toEqual(oldRec.variants);
  expect(oldV2.body.summary).toEqual(oldRec.summary);
  expect(oldV2.body.summary_private).toEqual(oldRec.summary_private);
  expect(oldV2.body).toEqual((await t.doc(TEST, old.token)).body);
});

test('sign with ticked extras records the facts, the summary, the ids and the page of that mix', async () => {
  const t = setup();
  const { token } = await newWedding(t);
  const bk = t.booking(TEST, token);
  const extras = ['raw-photos-wedding', 'guest-camera'];
  const mix = t.variantOf(TEST, token, 'private', extras);
  t.advance(5 * 60_000);
  // Sent in another order: the worker puts them in tick box order.
  const r = await t.sign(TEST, token, { choice: 'private', signed_name: 'Elena Marchetti', extras: ['guest-camera', 'raw-photos-wedding'], text_hash: mix.hash });
  expect(r.status).toBe(200);
  expect(r.body.extras).toEqual(extras);
  expect(r.body.summary).toEqual(mix.summary);
  expect(r.body.summary.extra_labels).toEqual(['RAW photos', 'Guest camera']);

  const rec = t.signedRecord(TEST, token);
  expect(rec.facts).toEqual(factsFor(bk.facts, 'private', extras));
  // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): 25% of 3,206.25, two payments.
  expect(rec.facts).toMatchObject({ total: 3206.25, retainer: 802, balance: 2404.25, sharing_fee: 75, extras });
  expect(rec.facts).not.toHaveProperty('second_payment');
  expect(rec.facts.deposits).toEqual([{ id: 'guest-camera', label: 'Guest camera deposit', amount: 100, note: mix.summary.deposit.note }]);
  expect(rec.summary).toEqual(mix.summary);
  expect(rec.extras).toEqual(extras);
  expect(rec.page).toEqual(bk.page);
  expect(rec.presented_hash).toBe(mix.hash);
  expect(rec.final_doc_json.replace('10 November 2026', SIGN_DATE_TOKEN)).toBe(mix.doc_json);
  expect(rec.final_doc_json).toContain('RAW photos, 1 × $121.25 = $121.25');
  expect(rec.final_doc_json).toContain('Guest camera deposit');
  // The booking keeps the booked facts.
  expect(t.booking(TEST, token).facts).toEqual(bk.facts);
  await t.settle();
  // A later visit answers from the signed record, with the ticked ids.
  const again = await t.doc(TEST, token);
  expect(again.body.extras).toEqual(extras);
  expect(again.body.signed.final_hash).toBe(rec.final_hash);

  // Nothing ticked on a new booking: the booked facts as they are, extras [].
  const plain = await newWedding(t);
  await t.signOk(TEST, plain.token, { signed_name: 'Elena Marchetti' });
  const p = t.signedRecord(TEST, plain.token);
  expect(p.facts).toEqual(t.booking(TEST, plain.token).facts);
  expect(p.extras).toEqual([]);
  expect(p.summary).toEqual(t.booking(TEST, plain.token).set.mixes.share.summary);
  expect(p.page).toEqual(t.booking(TEST, plain.token).page);
  // `extras: []` is the same as no extras.
  const empty = await newWedding(t);
  expect(await t.signOk(TEST, empty.token, { signed_name: 'Elena Marchetti', extras: [] })).toMatchObject({ status: 200, body: { extras: [] } });
  await t.settle();
});

test('sign refuses extras that are not tick boxes of the booking, and the text of another mix', async () => {
  const t = setup();
  const { token } = await newWedding(t);
  const sign = (over: Record<string, unknown>) => t.sign(TEST, token, { signed_name: 'Elena Marchetti', text_hash: t.hashOf(TEST, token), ...over });
  for (const extras of [['nope'], ['raw-photos-wedding', 'raw-photos-wedding'], 'raw-photos-wedding', {}, null, [42], [''], ['second-photographer'], ['drone']])
    expect(await sign({ extras }), JSON.stringify(extras)).toMatchObject({ status: 400, body: { ok: false, error: 'bad_extras' } });
  // The hash of another mix is a changed text.
  const raw = ['raw-photos-wedding'];
  expect(await sign({ extras: raw })).toMatchObject({ status: 409, body: { error: 'text_changed' } });
  expect(await sign({ extras: raw, text_hash: t.hashOf(TEST, token, 'share', ['instax-guest-prints']) })).toMatchObject({ status: 409 });
  expect(await sign({ extras: raw, text_hash: t.hashOf(TEST, token, 'private', raw) })).toMatchObject({ status: 409, body: { error: 'text_changed' } });
  expect(await sign({ text_hash: t.hashOf(TEST, token, 'share', raw) })).toMatchObject({ status: 409, body: { error: 'text_changed' } });
  // Checks keep their order: must_agree and bad_choice first, then bad_extras, then the text, then the name.
  expect(await sign({ extras: ['nope'], agree: false })).toMatchObject({ status: 400, body: { error: 'must_agree' } });
  expect(await sign({ extras: ['nope'], choice: 'both' })).toMatchObject({ status: 400, body: { error: 'bad_choice' } });
  expect(await sign({ extras: ['nope'], text_hash: 'f'.repeat(64) })).toMatchObject({ status: 400, body: { error: 'bad_extras' } });
  expect(await sign({ extras: ['nope'], signed_name: 'Daniel Okafor' })).toMatchObject({ status: 400, body: { error: 'bad_extras' } });
  expect(await sign({ extras: raw, text_hash: t.hashOf(TEST, token, 'share', raw), signed_name: 'Daniel Okafor' })).toMatchObject({
    status: 400,
    body: { error: 'partner_cannot_sign' },
  });
  expect(t.signedRecord(TEST, token)).toBeUndefined();
  expect(t.booking(TEST, token).status).toBe('sent');

  // RAW photos booked up front are not a tick box of that booking.
  const booked = await newWedding(t, WEDDING);
  expect(await t.sign(TEST, booked.token, { signed_name: 'Elena Marchetti', extras: raw, text_hash: t.hashOf(TEST, booked.token) })).toMatchObject({
    status: 400,
    body: { error: 'bad_extras' },
  });
  // Once signed, any request answers with the signed record.
  expect(await t.signOk(TEST, token, { signed_name: 'Elena Marchetti', extras: raw })).toMatchObject({ status: 200, body: { extras: raw } });
  expect(await sign({ extras: ['nope'] })).toMatchObject({ status: 200, body: { already: true, extras: raw } });
  await t.settle();
});

test('a booking made before sets signs only its two texts, with nothing ticked', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const old = t.toOld(TEST, token);
  const hash = old.variants.share.hash;
  for (const extras of [['drone'], ['nope'], 'drone'])
    expect(await t.sign(TEST, token, { text_hash: hash, extras }), JSON.stringify(extras)).toMatchObject({ status: 400, body: { error: 'bad_extras' } });
  const r = await t.sign(TEST, token, { text_hash: hash, extras: [] });
  expect(r).toMatchObject({ status: 200, body: { status: 'signed', extras: [] } });
  const rec = t.signedRecord(TEST, token);
  expect(rec.facts).toEqual(old.facts);
  expect(rec.summary).toEqual(old.summary);
  expect(rec).not.toHaveProperty('extras');
  expect(rec).not.toHaveProperty('page');
  expect(rec.final_doc_json.replace('10 November 2026', SIGN_DATE_TOKEN)).toBe(old.variants.share.doc_json);
  await t.settle();
});

test('a package without page text: a set with today\'s summaries, and no page', async () => {
  const pages = (pageJson as any).packages;
  const civilPage = pages['civil-ceremony'];
  delete pages['civil-ceremony'];
  try {
    const t = setup();
    const { token } = await t.create(TEST);
    const rec = t.booking(TEST, token);
    expect(rec).not.toHaveProperty('page');
    expect(Object.keys(rec.set.mixes)).toHaveLength(16);
    expect(Object.keys(rec.set.mixes['share+drone'].summary)).toEqual(['package', 'date', 'total', 'retainer', 'balance', 'balance_how', 'etransfer_email']);
    expect(rec.set.mixes['share+drone'].summary.total).toBe('$577.50');
    const v2 = await v2Doc(t, token);
    expect(v2.body.set).toEqual(rec.set);
    expect(v2.body).not.toHaveProperty('page');
    const r = await t.signOk(TEST, token, { extras: ['drone'] });
    expect(r.status).toBe(200);
    expect(t.signedRecord(TEST, token).extras).toEqual(['drone']);
    expect(t.signedRecord(TEST, token)).not.toHaveProperty('page');
    await t.settle();
  } finally {
    pages['civil-ceremony'] = civilPage;
  }
});

test('storedVariant: the one way to a stored text, for both shapes of booking', async () => {
  const t = setup();
  const { token } = await newWedding(t);
  const bk = t.booking(TEST, token);
  const mix = storedVariant(bk, 'private', ['raw-photos-wedding', 'guest-camera'])!;
  expect(mix.hash).toBe(bk.set.mixes['private+raw-photos-wedding+guest-camera'].hash);
  expect(mix.doc_json).toBe(JSON.stringify(renderVariant(bk.facts, 'private', ['raw-photos-wedding', 'guest-camera'])));
  expect(mix.summary).toEqual(bk.set.mixes['private+raw-photos-wedding+guest-camera'].summary);
  // Extras must already be in tick box order; anything else is no mix.
  expect(storedVariant(bk, 'private', ['guest-camera', 'raw-photos-wedding'])).toBeNull();
  expect(storedVariant(bk, 'share', ['nope'])).toBeNull();
  expect(storedVariant(bk, 'share', ['__proto__'])).toBeNull();
  // A booking made before sets: its two texts, nothing ticked only, even if its facts listed tick boxes.
  const old = { ...legacy(bk), facts: bk.facts };
  expect(storedVariant(old, 'share', [])).toEqual(old.variants.share);
  expect(storedVariant(old, 'private', [])).toEqual(old.variants.private);
  expect(storedVariant(old, 'share', ['raw-photos-wedding'])).toBeNull();
  expect(storedVariant(old, 'both' as any, [])).toBeNull();
});

test('pdf: x picks the mix, and the cache name carries the ticked ids', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  t.replyWith(pdfAnswer());
  const key = (name: string) => `agr:test:pdf:${token}:${name}`;
  const r = await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=private&x=raw-photos-civil,drone`);
  expect(r.status).toBe(200);
  expect(r.bytes).toEqual(FAKE_PDF);
  const mix = t.variantOf(TEST, token, 'private', ['drone', 'raw-photos-civil']);
  expect(t.calls[0].fields.pdf_html).toBe(pdfDraftDocument(JSON.parse(mix.doc_json), { signDateText: '10 November 2026' }));
  expect(t.calls[0].fields.pdf_html).toContain('Drone and aerial frames, 1 × $76.25 = $76.25; RAW photos, 1 × $69.25 = $69.25');
  expect(t.kv.store.get(key('private+drone+raw-photos-civil:2026-11-10'))!.expirationTtl).toBe(172800);
  // The same mix again comes from KV.
  expect((await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=private&x=drone,raw-photos-civil`)).status).toBe(200);
  expect(t.calls).toHaveLength(1);
  // x missing or empty: nothing ticked, today's cache name.
  expect((await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share&x=`)).status).toBe(200);
  expect(t.kv.store.has(key('share:2026-11-10'))).toBe(true);
  expect((await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share`)).status).toBe(200);
  expect(t.calls).toHaveLength(2);
  expect(t.calls[1].fields.pdf_html).toContain('<td class="agr-label">Add-ons chosen at booking</td><td>None</td>');

  for (const x of ['nope', 'drone,drone', ',', 'drone,', 'second-photographer'])
    expect(await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share&x=${x}`), x).toMatchObject({ status: 400, body: { ok: false, error: 'bad_extras' } });
  // A bad choice is answered first.
  expect(await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=both&x=nope`)).toMatchObject({ status: 400, body: { error: 'bad_choice' } });
  expect(t.calls).toHaveLength(2);

  // A booking made before sets has no mixes: only nothing ticked.
  const old = await t.create(TEST);
  const oldRec = t.toOld(TEST, old.token);
  expect(await t.raw(TEST, `/r/agreement/pdf?k=${old.token}&c=share&x=drone`)).toMatchObject({ status: 400, body: { error: 'bad_extras' } });
  expect((await t.raw(TEST, `/r/agreement/pdf?k=${old.token}&c=share&x=`)).status).toBe(200);
  // Each sharing choice of an old booking downloads its own stored text.
  expect(t.calls).toHaveLength(3);
  expect(t.calls[2].fields.pdf_html).toBe(pdfDraftDocument(JSON.parse(oldRec.variants.share.doc_json), { signDateText: '10 November 2026' }));
  expect((await t.raw(TEST, `/r/agreement/pdf?k=${old.token}&c=private`)).status).toBe(200);
  expect(t.calls).toHaveLength(4);
  expect(oldRec.variants.private.doc_json).not.toBe(oldRec.variants.share.doc_json);
  expect(t.calls[3].fields.pdf_html).toBe(pdfDraftDocument(JSON.parse(oldRec.variants.private.doc_json), { signDateText: '10 November 2026' }));
  expect(t.kv.store.has(`agr:test:pdf:${old.token}:private:2026-11-10`)).toBe(true);

  // Signed: the signed copy, whatever x says.
  await t.signOk(TEST, token, { extras: ['drone'] });
  await t.settle();
  t.replyWith(pdfAnswer());
  const before = t.calls.length;
  expect((await t.raw(TEST, `/r/agreement/pdf?k=${token}&c=share&x=nope`)).status).toBe(200);
  expect(t.calls[before].fields.pdf_html).toBe(signedPdfHtml(t.signedRecord(TEST, token)));
  expect(t.calls[before].fields.pdf_html).toContain('Drone and aerial frames, 1 × $76.25 = $76.25');
});

test('copy: ticked extras reach the email (the deposit line) and the Notes value of the sheet row', async () => {
  const t = setup();
  const { token } = await newWedding(t);
  await t.signOk(TEST, token, { signed_name: 'Elena Marchetti', extras: ALL_WEDDING_TICKS });
  await t.settle();
  expect(t.calls).toHaveLength(1);
  const f = t.calls[0].fields;
  expect(Object.keys(f).sort()).toEqual(
    ['action', 'token', 'test', 'booking_number', 'to_email', 'email_subject', 'email_body', 'pdf_html', 'pdf_name', 'row_json'].sort(),
  );
  expect(f.email_body).toBe(
    [
      'Hi Elena,',
      '',
      'Thank you for signing. Your signed agreement is attached as a PDF. Please keep it.',
      '',
      // Re-pinned for the payment change (spec 2026-11-23, sections 5.3 and 5.5): 25% to the new address, the
      // balance in cash, the deposit paid in cash with it.
      'Next step: send the retainer of $798.00 by Interac e-transfer to kashklicks.ca@gmail.com. Please put your booking number, KK-TEST-2026-001, in the message. Your date is held once the retainer arrives.',
      '',
      'The balance of $2,393.25 is due on or before the day, in cash.',
      '',
      `Guest camera deposit: $100.00. ${CAMERA_NOTE}`,
      '',
      'If anything looks wrong, just reply to this email.',
      '',
      'Warmly,',
      'Kash',
      'AD Photography',
      'kashklicks.ca',
    ].join('\n'),
  );
  expect(f.email_subject + f.email_body).not.toMatch(/[–—]/);
  const row = JSON.parse(f.row_json);
  expect(Object.keys(row)).toEqual([
    'Signed at', 'Booking number', 'Client', 'Partner', 'Email', 'Phone', 'Package', 'Event date',
    'Total', 'Retainer', 'Balance', 'Sharing', 'Signed name', 'Text hash', 'Clause version', 'Notes',
  ]);
  // The deposit is never in the total.
  expect(row).toMatchObject({ Total: '$3,191.25', Retainer: '$798.00', Balance: '$2,393.25', Sharing: 'share' });
  expect(row.Notes).toBe('Ticked at signing: RAW photos, Instax guest prints, Guest camera.');
  expect(f.pdf_html).toContain('Guest camera deposit');

  // A booking with notes keeps them first. No deposit ticked: no deposit line.
  const civil = await t.create(TEST);
  await t.signOk(TEST, civil.token, { extras: ['drone'] });
  await t.settle();
  const c = t.calls[1].fields;
  expect(JSON.parse(c.row_json).Notes).toBe('Family group photos after the ceremony, inside your 2 hours. Ticked at signing: Drone and aerial frames.');
  // Re-pinned (spec 2026-11-23, section 5.3): 25% of 577.50, cash only.
  expect(JSON.parse(c.row_json)).toMatchObject({ Total: '$577.50', Retainer: '$145.00', Balance: '$432.50' });
  expect(c.email_body).toContain('Next step: send the retainer of $145.00');
  expect(c.email_body).toContain('The balance of $432.50 is due on or before the day, in cash.\n\nIf anything looks wrong');
  expect(c.email_body).not.toContain('deposit');

  // A wedding booked before the change, every extra ticked: the email of that time, word for word (three
  // payments, the old address, the deposit due with the final payment).
  const o = setup();
  const old = o.putOld('wedding-set');
  await o.sign(TEST, old.token, { signed_name: 'Elena Marchetti', extras: ALL_WEDDING_TICKS, text_hash: old.set.mixes[`share+${ALL_WEDDING_TICKS.join('+')}`].hash });
  await o.settle();
  const g = o.calls[0].fields;
  expect(g.email_body).toBe(
    [
      'Hi Elena,',
      '',
      'Thank you for signing. Your signed agreement is attached as a PDF. Please keep it.',
      '',
      `Next step: send the retainer of $1,596.00 by Interac e-transfer to info@kashklicks.ca. Please put your booking number, ${old.number}, in the message. Your date is held once the retainer arrives.`,
      '',
      'The second payment of $798.00 is due 7 days after I deliver your engagement session gallery. If you have not had your engagement session by Tuesday 30 March 2027, it is due on that date.',
      '',
      'The final payment of $797.25 is due by Saturday 15 May 2027.',
      '',
      'Guest camera deposit: $100.00. Refundable, and not part of your total. Due with your final payment. I return it within 7 days after your wedding, when the camera comes back working and undamaged.',
      '',
      'If anything looks wrong, just reply to this email.',
      '',
      'Warmly,',
      'Kash',
      'AD Photography',
      'kashklicks.ca',
    ].join('\n'),
  );
  expect(JSON.parse(g.row_json)).toMatchObject({ Total: '$3,191.25', Retainer: '$1,596.00', Balance: '$1,595.25', Sharing: 'share' });
  expect(JSON.parse(g.row_json).Notes).toBe('Ticked at signing: RAW photos, Instax guest prints, Guest camera.');
});

test('copyFields never throws for a record with extras but no tick box list, or none at all', () => {
  const base = buildBookingFacts(WEDDING_SECOND_ONLY, { number: 'KK-TEST-2026-001', createdAt: START });
  const doc_json = JSON.stringify(renderVariant(base, 'share'));
  const record = (facts: any) => ({
    v: 1 as const,
    mode: 'test' as const,
    token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456',
    number: 'KK-TEST-2026-001',
    choice: 'share' as const,
    signed_name: 'Elena Marchetti',
    signed_at: START.toISOString(),
    signed_date_text: '10 November 2026',
    presented_hash: 'ab'.repeat(32),
    final_doc_json: doc_json.replace(SIGN_DATE_TOKEN, '10 November 2026'),
    final_hash: 'cd'.repeat(32),
    clause_version: 'x',
    facts,
    link_created_at: START.toISOString(),
    ip: null,
    user_agent: null,
    cf_ray: null,
    country: null,
  });
  const { tick_boxes: _t, ...noTicks } = factsFor(base, 'share', ['instax-guest-prints']);
  expect(JSON.parse(copyFields({}, record(noTicks)).row_json).Notes).toBe('Ticked at signing: instax-guest-prints.');
  const odd = { ...base, extras: 'not a list', deposits: 'not a list' };
  expect(JSON.parse(copyFields({}, record(odd)).row_json).Notes).toBe('');
  expect(copyFields({}, record(odd)).email_body).toBe(copyFields({}, record(base)).email_body);
  // Damaged entries inside the lists are skipped, never thrown on.
  const ticked = factsFor(base, 'share', ['instax-guest-prints', 'guest-camera']);
  const damaged = {
    ...ticked,
    deposits: [null, 5, 'x', {}, { label: 'No amount', note: 'n' }, ...ticked.deposits!],
    tick_boxes: [null, 5, {}, ...ticked.tick_boxes!],
  };
  const fields = copyFields({}, record(damaged));
  expect(fields.email_body).toBe(copyFields({}, record(ticked)).email_body);
  expect(fields.email_body.split('Guest camera deposit: $100.00.')).toHaveLength(2);
  expect(JSON.parse(fields.row_json).Notes).toBe('Ticked at signing: Instax guest prints, Guest camera.');
});

// ------------------------------------------------------------------ no phone, times to be set (spec 2026-11-23, section 6)

test('a wedding without a phone and without times: /new, doc, not yet, sign and the copy, next to the same wedding with them (spec 2026-11-23, section 6)', async () => {
  const NO_PHONE_NO_TIMES = { ...WEDDING_SECOND_ONLY, client_phone: '', start_time: null, end_time: '   ' };
  // Two stores, so both bookings get the same number and clock: they may differ only where section 6 says.
  const a = setup();
  const b = setup();
  const withBoth = await a.admin(TEST, '/r/agreement/new', WEDDING_SECOND_ONLY);
  const putsBefore = b.kv.puts.length;
  const without = await b.admin(TEST, '/r/agreement/new', NO_PHONE_NO_TIMES);
  expect(without.status).toBe(200);
  expect(b.kv.puts.length).toBe(putsBefore + 3); // still three keys per booking
  // The /new answer has the same fields and amounts (spec 5.5: $3,010.00, 753.00 / 2,257.00 in cash; private 3,085.00 / 772.00).
  const { token, path: _p, ...answer } = without.body;
  const { token: tokenA, path: _q, ...answerA } = withBoth.body;
  expect(answer).toEqual(answerA);
  expect(answer).toMatchObject({ total: 3010, retainer: 753, balance: 2257, balance_cash: true, private_total: 3085, private_retainer: 772 });

  const rec = b.booking(TEST, token);
  for (const k of ['client_phone', 'start_time', 'end_time']) expect(rec.facts).not.toHaveProperty(k);
  expect(JSON.stringify(rec.facts)).toBe(JSON.stringify(buildBookingFacts(NO_PHONE_NO_TIMES, { number: rec.number, createdAt: START })));
  const recA = a.booking(TEST, tokenA);
  expect(Object.keys(rec.set.mixes)).toEqual(Object.keys(recA.set.mixes));
  expect(rec.clause_version).toBe(recA.clause_version);
  const YOU = '"**You** are Elena Marchetti. Your email is elena@example.com."';
  const TBD = 'Your start time and end time are not set yet. We set them together, in writing, at the latest when you send your final timeline (section 7).';
  const COVERAGE = '"Coverage","10 hours in one continuous block. The start and end time are not set yet (section 5)."';
  for (const m of mixesOf(rec.facts)) {
    const v = b.variantOf(TEST, token, m.choice, m.extras);
    expect(v.doc_json, m.id).toBe(JSON.stringify(renderVariant(rec.facts, m.choice, m.extras)));
    expect(v.hash, m.id).toBe(await sha256Hex(v.doc_json));
    for (const s of [YOU, TBD, COVERAGE]) expect(v.doc_json, `${m.id} ${s}`).toContain(s);
    for (const s of ['your phone', '416 555 0177', 'Your start time and end time are in section 1', '12:00 pm']) expect(v.doc_json, `${m.id} ${s}`).not.toContain(s);
    // The amounts and their wording are those of the same mix with a phone and times.
    expect(v.summary, m.id).toEqual(a.variantOf(TEST, tokenA, m.choice, m.extras).summary);
  }
  expect(rec.page).toEqual(pageContent(rec.facts));
  expect(rec.page.glance[1]).toEqual({ label: 'Coverage', value: '10 hours, times to be set' });
  expect(rec.page.parts[0].points[0]).toBe(
    'Saturday 29 May 2027. 10 hours in one block. We set the start and end time together, in writing, at the latest when you send your final timeline.',
  );

  // doc v=2: the set and the page; the summary as with a phone and times.
  const v2 = await v2Doc(b, token);
  expect(v2.status).toBe(200);
  expect(v2.body.page).toEqual(rec.page);
  expect(v2.body.summary).toEqual((await v2Doc(a, tokenA)).body.summary);
  const plain = await b.doc(TEST, token);
  expect(plain.status).toBe(200);
  expect(plain.body.variants.share.doc_json).toContain(YOU);

  // not yet: the owner notice says there is no phone; the one with a phone names it.
  for (const [t, k, phone] of [
    [b, token, 'none given'],
    [a, tokenA, '416 555 0177'],
  ] as const) {
    expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k, message: FIX }, t.browser(TEST))).toMatchObject({ status: 200 });
    const body = t.calls[t.calls.length - 1].fields.body.split('\n');
    expect(body.slice(-2)).toEqual(['Their email: elena@example.com', `Their phone: ${phone}`]);
  }

  // Sign private with every tick box (spec 5.5: 3,266.25 = 817.00 + 2,449.25 in cash, plus the $100.00 deposit).
  const sign = { choice: 'private', extras: ALL_WEDDING_TICKS, signed_name: 'Elena Marchetti' };
  const signed = await b.signOk(TEST, token, sign);
  expect(signed.status).toBe(200);
  expect(signed.body.summary).toMatchObject({ total: '$3,266.25', retainer: '$817.00', balance: '$2,449.25', balance_how: 'in cash' });
  expect(signed.body.signed.final_doc_json).toContain(YOU);
  const record = b.signedRecord(TEST, token);
  for (const k of ['client_phone', 'start_time', 'end_time']) expect(record.facts).not.toHaveProperty(k);
  expect(record.facts).toMatchObject({ total: 3266.25, retainer: 817, balance: 2449.25 });
  expect(await a.signOk(TEST, tokenA, sign)).toMatchObject({ status: 200 });
  await a.settle();
  await b.settle();

  // The copy: the ten fields, the same email as with a phone, the same row keys with Phone ''.
  const copy = b.calls.find((c) => c.fields.action === 'agreement_signed')!.fields;
  const copyA = a.calls.find((c) => c.fields.action === 'agreement_signed')!.fields;
  expect(Object.keys(copy)).toEqual(Object.keys(copyA));
  expect(copy.email_body).toBe(copyA.email_body);
  expect(copy.email_body).toContain('send the retainer of $817.00 by Interac e-transfer to kashklicks.ca@gmail.com.');
  const row = JSON.parse(copy.row_json);
  const rowA = JSON.parse(copyA.row_json);
  expect(Object.keys(row)).toEqual(Object.keys(rowA));
  expect(row.Phone).toBe('');
  expect(rowA.Phone).toBe('416 555 0177');
  expect({ ...row, Phone: rowA.Phone, 'Text hash': rowA['Text hash'] }).toEqual(rowA);
  expect(copyFields(b.env, record)).toEqual(copy);
  // The signed link opens in its signed state.
  expect(await b.doc(TEST, token)).toMatchObject({ status: 200, body: { status: 'signed', extras: ALL_WEDDING_TICKS } });
});

test('one time alone, or a phone that is not a phone, is refused by /new before a number is used (spec 2026-11-23, section 6)', async () => {
  const t = setup();
  for (const [over, field, error] of [
    [{ end_time: null }, 'end_time', 'bad_times'],
    [{ end_time: '' }, 'end_time', 'bad_times'],
    [{ start_time: ' ' }, 'start_time', 'bad_times'],
    [{ start_time: undefined }, 'start_time', 'bad_times'],
    [{ client_phone: 4165550142 }, 'client_phone', 'bad_phone'],
    [{ client_phone: '555-01' }, 'client_phone', 'bad_phone'],
  ] as const) {
    const r = await t.admin(TEST, '/r/agreement/new', { ...PILOT, ...over });
    expect(r, JSON.stringify(over)).toMatchObject({ status: 400, body: { ok: false, error, field } });
  }
  expect(t.kv.puts).toEqual([]);
  // Missing, null or blank phone and times make a booking.
  const ok = await t.admin(TEST, '/r/agreement/new', { ...PILOT, client_phone: null, start_time: '', end_time: undefined });
  expect(ok).toMatchObject({ status: 200, body: { ok: true, number: 'KK-TEST-2026-001', total: 501.25, retainer: 126, balance: 375.25 } });
});
