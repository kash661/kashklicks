import { test, expect } from '@playwright/test';
import { handleAgreement } from '../../src/worker/agreement';
import { APPS_SCRIPT_URL, callAppsScript } from '../../src/worker/shared';
import worker from '../../src/worker';
import { sha256Hex } from '../../src/lib/agreement/hash';
import { SIGN_DATE_TOKEN } from '../../src/lib/agreement/render';

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

// ------------------------------------------------------------------ fakes

interface Entry {
  value: string;
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
  async get(key: string): Promise<string | null> {
    if (this.failGets.some((p) => key.startsWith(p))) throw new Error('KV GET failed: 500');
    return (this.snapshot ?? this.store).get(key)?.value ?? null;
  }
  async put(key: string, value: string, opts: { metadata?: unknown; expirationTtl?: number } = {}): Promise<void> {
    if (this.failPuts.some((p) => key.startsWith(p))) throw new Error('KV PUT failed: 429');
    this.puts.push(key);
    this.store.set(key, { value, metadata: opts.metadata, expirationTtl: opts.expirationTtl });
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
  const hashOf = (origin: string, token: string, choice: 'share' | 'private' = 'share') =>
    booking(origin, token).variants[choice].hash as string;

  /** Sign with the right hash for the chosen variant. */
  const signOk = (origin: string, token: string, over: Record<string, unknown> = {}) =>
    sign(origin, token, { text_hash: hashOf(origin, token, (over.choice as 'share' | 'private') ?? 'share'), ...over });

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
    admin,
    create,
    doc,
    sign,
    signOk,
    booking,
    signedRecord,
    hashOf,
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

test('new booking stores both variants and returns the link', async () => {
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
    total: 501.25,
    retainer: 251,
    balance: 250.25,
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
  for (const choice of ['share', 'private'] as const) {
    const v = rec.variants[choice];
    expect(v.hash).toBe(await sha256Hex(v.doc_json));
    expect(v.doc_json.split(SIGN_DATE_TOKEN)).toHaveLength(2);
    const parsed = JSON.parse(v.doc_json);
    expect(parsed.choice).toBe(choice);
    expect(parsed.number).toBe('KK-TEST-2026-001');
    expect(rec.clause_version).toBe(parsed.clause_version);
  }
  expect(rec.variants.share.hash).not.toBe(rec.variants.private.hash);
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
  const stored = t.booking(TEST, token);
  t.advance(30_000);
  const r = await t.doc(TEST, token);
  expect(r.status).toBe(200);
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
    variants: stored.variants,
    labels: { ...r.body.labels, name_expected: 'Priya Sharma' },
    summary: {
      package: 'The Civil Ceremony',
      date: 'Saturday 12 December 2026',
      total: '$501.25',
      retainer: '$251.00',
      balance: '$250.25',
      etransfer_email: 'info@kashklicks.ca',
    },
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
  const presented = t.booking(TEST, token).variants.private;
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
    summary: t.booking(TEST, token).summary,
  });

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
    summary: {
      package: 'The Civil Ceremony',
      date: 'Saturday 12 December 2026',
      total: '$501.25',
      retainer: '$251.00',
      balance: '$250.25',
      etransfer_email: 'info@kashklicks.ca',
    },
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
      'Next step: send the retainer of $251.00 by Interac e-transfer to info@kashklicks.ca. Please put your booking number, KK-TEST-2026-001, in the message. Your date is held once the retainer arrives.',
      '',
      'The balance of $250.25 is due on or before the day, by e-transfer or cash.',
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
    Retainer: '$251.00',
    Balance: '$250.25',
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
  expect(bk.labels).toEqual(opened.body.labels);
  expect(bk.summary).toEqual(opened.body.summary);
  expect(bk.labels.name_expected).toBe('Priya Sharma');
  expect(bk.labels.intro_bullets[0]).toBe('Priya signs for both of you.');
  expect(bk.summary.etransfer_email).toBe('info@kashklicks.ca');

  await t.signOk(TEST, token);
  await t.settle();
  const s = t.signedRecord(TEST, token);
  expect(s.labels).toEqual(bk.labels);
  expect(s.summary).toEqual(bk.summary);
});

test('a link keeps working from its stored values when the package data changes later', async () => {
  const t = setup();
  const a = await t.create(TEST);
  const b = await t.create(TEST);
  await t.signOk(TEST, b.token);
  await t.settle();

  // As if the package were renamed in the data files: computing labels now would throw package_not_ready.
  const retire = (rec: any) => {
    rec.facts = { ...rec.facts, package_id: 'retired-package' };
    rec.labels = { ...rec.labels, agree_label: 'The words shown when this link was made.' };
    rec.summary = { ...rec.summary, etransfer_email: 'old-address@example.com' };
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
});

test('a booking and a signed record made before labels were stored still load', async () => {
  const t = setup();
  const a = await t.create(TEST);
  const b = await t.create(TEST);
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
  t.kv.store.set(key, { ...t.kv.store.get(key)!, value: JSON.stringify(strip(t.booking(TEST, c.token))) });
  await t.signOk(TEST, c.token);
  await t.settle();
  expect(t.signedRecord(TEST, c.token).labels).toEqual(expected.labels);
  expect(t.signedRecord(TEST, c.token).summary).toEqual(expected.summary);
});

// ------------------------------------------------------------------ not yet

test('not yet keeps the link usable', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  expect(
    await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token }, { origin: 'https://evil.example' }),
  ).toMatchObject({ status: 403 });
  t.advance(4 * 3600_000 + 41 * 60_000); // 2:41 pm in Toronto
  const r = await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token }, t.browser(TEST));
  expect(r).toMatchObject({ status: 200, body: { ok: true } });
  expect(t.booking(TEST, token).not_yet_at).toBe('2026-11-10T19:41:00.000Z');
  await t.settle();
  expect(t.calls).toHaveLength(1);
  expect(t.calls[0].fields).toEqual({
    action: 'agreement_notice',
    token: ADMIN,
    test: '1',
    subject: 'Agreement not signed yet: Priya Sharma (KK-TEST-2026-001)',
    body: 'Priya Sharma pressed "Something is wrong, I do not want to sign yet" on 10 November 2026 at 2:41 pm (Toronto time). Nothing is signed. Their email: priya@example.com.',
  });

  // The link still opens and can still be signed.
  expect(await t.doc(TEST, token)).toMatchObject({ status: 200, body: { status: 'opened' } });
  expect(await t.signOk(TEST, token)).toMatchObject({ status: 200, body: { status: 'signed' } });
  expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token }, t.browser(TEST))).toMatchObject({
    status: 409,
    body: { error: 'already_signed' },
  });
  expect(await t.call(TEST, 'POST', '/r/agreement/not-yet', { k: 'C'.repeat(43) }, t.browser(TEST))).toMatchObject({ status: 404 });
  await t.settle();
});

test('not yet sends one notice per 10 minutes', async () => {
  const t = setup();
  const { token } = await t.create(TEST);
  const press = () => t.call(TEST, 'POST', '/r/agreement/not-yet', { k: token }, t.browser(TEST));
  expect(await press()).toMatchObject({ status: 200, body: { ok: true } });
  t.advance(4 * 60_000);
  expect(await press()).toMatchObject({ status: 200, body: { ok: true } });
  await t.settle();
  expect(t.calls).toHaveLength(1);
  expect(t.booking(TEST, token).not_yet_at).toBe(START.toISOString()); // the time of the last notice

  t.advance(11 * 60_000);
  expect(await press()).toMatchObject({ status: 200, body: { ok: true } });
  await t.settle();
  expect(t.calls).toHaveLength(2);
  expect(t.calls.map((c) => c.fields.action)).toEqual(['agreement_notice', 'agreement_notice']);

  // A failed notice is logged.
  const errors = silenceErrors();
  try {
    t.replyWith(async () => jsonResponse({ ok: false, error: 'bad_request' }));
    t.advance(11 * 60_000);
    await press();
    await t.settle();
    expect(errors.logged.some((args) => String(args[0]).includes('notice not sent'))).toBe(true);
  } finally {
    errors.restore();
  }
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
  expect(await withDb.call(TEST, 'POST', '/r/agreement/not-yet', { k: token }, withDb.browser(TEST))).toMatchObject({
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
