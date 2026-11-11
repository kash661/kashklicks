// /r/agreement/* : create a booking with its frozen agreement text, serve it by an
// unguessable token, take the signature, keep a write-once signed record, and ask
// Apps Script to email the PDF copy. The signed record is a legal record: it lives
// in D1, whose atomic insert means a link is signed once and never overwritten, and
// an upstream failure never loses a signature. Live and test data never mix.
import { longDate, money, shortDate, torontoIsoDate, torontoStamp } from '../lib/agreement/format';
import { BookingError, SIGN_DATE_TOKEN, buildBookingFacts, fillSignDate, renderVariant, signLabels } from '../lib/agreement/render';
import { sha256Hex } from '../lib/agreement/hash';
import type { BookingFacts } from '../lib/agreement/types';
import { BUSINESS, claimAttempt, copyDue, firstWord, sendCopy, signedPdfHtml } from './agreement-copy';
import { pdfDraftDocument } from '../lib/agreement/html';
import {
  StorageUnavailable,
  bookingByNumber,
  insertSigned,
  keys,
  kvGet,
  loadBooking,
  markSigned,
  numberSigned,
  putBooking,
  putBookingQuietly,
  putSignedBackup,
  selectSigned,
  ttl,
  type AgreementEnv,
  type BookingRecord,
  type Mode,
  type SignedRecord,
  type Store,
  type StoredLabels,
  type StoredSummary,
} from './agreement-store';
import { JSON_HEADERS, callAppsScript, isPreviewHost, isSameOrigin } from './shared';

export type { AgreementEnv, BookingRecord, SignedRecord } from './agreement-store';

/** Tests pass a fixed clock and a stub fetch. Production passes nothing. */
export interface AgreementDeps {
  now?: () => Date;
  fetchImpl?: typeof fetch;
}

type Ctx = Pick<ExecutionContext, 'waitUntil'>;

const MAX_BODY = 16384; // 16 KB
const NOT_YET_QUIET_MS = 10 * 60_000; // the same message twice within this time is sent once
const NOT_YET_DAY_MAX = 5; // messages a booking may send in 24 hours
const NOT_YET_KEEP = 10; // messages kept on the booking
const NOT_YET_MAX_TRIES = 5; // sends of one message that was not delivered
const DAY_MS = 24 * 3600_000;
const PDF_MIN_BYTES = 1000;
const PDF_MAX_BYTES = 5_000_000;
const PDF_TTL_UNSIGNED = 172800; // 2 days: an unsigned copy carries today's date
const PDF_TTL_SIGNED = 2592000; // 30 days
const NUMBER_RE = /^KK-(TEST-)?\d{4}-\d{3,6}$/;
const CONTROL = /[\u0000-\u001F\u007F-\u009F]/g;
const CONTROL_BUT_NEWLINE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/** A "not yet" message: line ends made \n, a tab one space, other control characters removed, trimmed, at most one blank line in a row. */
const cleanMessage = (v: string) =>
  v
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL_BUT_NEWLINE, '')
    .trim()
    .replace(/\n{3,}/g, '\n\n');

const ROUTES: Record<string, 'GET' | 'POST'> = {
  '/r/agreement/new': 'POST',
  '/r/agreement/void': 'POST',
  '/r/agreement/resend': 'POST',
  '/r/agreement/doc': 'GET',
  '/r/agreement/sign': 'POST',
  '/r/agreement/not-yet': 'POST',
  '/r/agreement/pdf': 'GET',
};

const json = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const fail = (status: number, error: string) => json(status, { ok: false, error });

/** A problem with the request that ends it with a JSON error. */
class Refusal {
  constructor(readonly response: Response) {}
}

/** NFKD, combining marks dropped, lower case, every run of non letters and digits one space, trimmed. */
const nameKey = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

const newToken = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Constant-time: both sides are hashed first, so neither the length nor a prefix leaks. */
const sameSecret = async (given: string, expected: string): Promise<boolean> => {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i += 1) diff |= x[i] ^ y[i];
  return diff === 0;
};

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY) throw new Refusal(fail(413, 'too_large'));
  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BODY) throw new Refusal(fail(413, 'too_large'));
  let v: unknown;
  try {
    v = JSON.parse(new TextDecoder().decode(buf));
  } catch {
    throw new Refusal(fail(400, 'bad_body'));
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Refusal(fail(400, 'bad_body'));
  return v as Record<string, unknown>;
}

const mustLoad = async (s: Store, token: unknown): Promise<BookingRecord> => {
  const bk = await loadBooking(s, token);
  if (!bk) throw new Refusal(fail(404, 'not_found'));
  return bk;
};

const mustLoadByNumber = async (s: Store, body: Record<string, unknown>): Promise<BookingRecord> => {
  const number = body.number;
  if (typeof number !== 'string' || !NUMBER_RE.test(number)) throw new Refusal(fail(400, 'bad_number'));
  const bk = await bookingByNumber(s, number);
  if (!bk) throw new Refusal(fail(404, 'not_found'));
  return bk;
};

// ------------------------------------------------------------------ payloads

// Computed from today's data files only when a booking or record has none stored (made before they were).
const summaryOf = (f: BookingFacts): StoredSummary => ({
  package: f.package_name,
  date: longDate(f.event_date),
  total: money(f.total),
  retainer: money(f.retainer),
  balance: money(f.balance),
  balance_how: f.balance_cash === true ? 'in cash' : 'e-transfer or cash',
  etransfer_email: BUSINESS.etransferEmail,
});

const labelsOf = (f: BookingFacts): StoredLabels => ({ ...signLabels(f), name_expected: f.client_name });

/** Built from the D1 row. A KV booking that has not caught up yet still reads as pending. */
function signedPayload(bk: BookingRecord, s: SignedRecord) {
  const { date, time } = torontoStamp(new Date(s.signed_at));
  return {
    ok: true,
    status: 'signed',
    mode: s.mode,
    number: s.number,
    client_first: firstWord(s.facts.client_name),
    partner_first: firstWord(s.facts.partner_name),
    client_name: s.facts.client_name,
    partner_name: s.facts.partner_name,
    signed: { choice: s.choice, signed_name: s.signed_name, date, time, final_doc_json: s.final_doc_json, final_hash: s.final_hash },
    summary: s.summary ?? summaryOf(s.facts),
    labels: s.labels ?? labelsOf(s.facts),
    copy: { status: bk.copy.status === 'none' ? 'pending' : bk.copy.status, to: s.facts.client_email },
  };
}

/** On a visit to a signed link: repair the KV booking if needed and retry a pending copy when it is due. */
async function followUpSigned(s: Store, env: AgreementEnv, ctx: Ctx, deps: AgreementDeps, bk: BookingRecord, signed: SignedRecord) {
  const repaired = markSigned(bk, signed);
  if (copyDue(bk, s.now())) ctx.waitUntil(sendCopy(s, env, bk, signed, deps.fetchImpl));
  else if (repaired) await putBookingQuietly(s, bk);
}

// ------------------------------------------------------------------ routes

async function newBooking(s: Store, body: Record<string, unknown>): Promise<Response> {
  const createdAt = s.now();
  // Check the input before a number is used up: a rejected request never advances the sequence.
  try {
    buildBookingFacts(body, { number: s.mode === 'test' ? 'KK-TEST-0000-000' : 'KK-0000-000', createdAt });
  } catch (err) {
    if (err instanceof BookingError) return json(400, { ok: false, error: err.code, field: err.field });
    throw err;
  }

  // Not atomic: two bookings made at the same moment could take the same number.
  // One operator makes bookings one at a time, so read, skip used numbers, write is enough.
  // Used means a number key in KV or a signed row in D1 (test number keys expire, D1 rows do not).
  const year = torontoIsoDate(createdAt).slice(0, 4);
  const prefix = s.mode === 'test' ? `KK-TEST-${year}-` : `KK-${year}-`;
  let seq = Number.parseInt((await kvGet(s, s.key.seq(year))) ?? '0', 10) || 0;
  let number = '';
  for (let tries = 0; tries < 20; tries += 1) {
    seq += 1;
    number = prefix + String(seq).padStart(3, '0');
    if (!(await kvGet(s, s.key.num(number))) && !(await numberSigned(s, number))) break;
    number = '';
  }
  if (!number) return fail(500, 'number_unavailable');

  const facts = buildBookingFacts(body, { number, createdAt });
  const variants = {} as BookingRecord['variants'];
  let clause_version = '';
  for (const choice of ['share', 'private'] as const) {
    const doc = renderVariant(facts, choice);
    const doc_json = JSON.stringify(doc);
    // Signing fills the date into exactly one place; refuse a text that could not be signed.
    if (doc_json.split(SIGN_DATE_TOKEN).length !== 2) throw new Error(`${choice} variant has no single sign date`);
    variants[choice] = { doc_json, hash: await sha256Hex(doc_json) };
    clause_version = doc.clause_version;
  }

  const token = newToken();
  const bk: BookingRecord = {
    v: 1,
    mode: s.mode,
    token,
    number,
    status: 'sent',
    created_at: createdAt.toISOString(),
    facts,
    clause_version,
    variants,
    copy: { status: 'none', attempts: 0 },
    // Frozen with the text: a later change to the data files never changes this link.
    labels: labelsOf(facts),
    summary: summaryOf(facts),
  };
  // Booking first, then its number, then the sequence. A crash in between leaves a used
  // number behind, which the next booking skips.
  try {
    await putBooking(s, bk);
    await s.kv.put(s.key.num(number), token, ttl(s, bk.created_at));
    await s.kv.put(s.key.seq(year), String(seq)); // no expiry in either mode
  } catch (err) {
    throw new StorageUnavailable(`booking write failed: ${String(err)}`);
  }

  return json(200, {
    ok: true,
    number,
    token,
    path: `/welcome/agreement/?k=${token}`,
    mode: s.mode,
    total: facts.total,
    retainer: facts.retainer,
    balance: facts.balance,
    balance_cash: facts.balance_cash === true,
  });
}

async function voidBooking(s: Store, body: Record<string, unknown>): Promise<Response> {
  const bk = await mustLoadByNumber(s, body);
  if (await selectSigned(s, bk.token)) return fail(409, 'already_signed');
  if (bk.status !== 'void') {
    bk.status = 'void';
    await putBooking(s, bk);
  }
  return json(200, { ok: true, number: bk.number, status: 'void' });
}

async function resend(s: Store, env: AgreementEnv, deps: AgreementDeps, body: Record<string, unknown>): Promise<Response> {
  const bk = await mustLoadByNumber(s, body);
  const signed = await selectSigned(s, bk.token);
  if (!signed) return fail(409, 'not_signed');
  markSigned(bk, signed);
  // A resend ignores the attempts cap and the 60 s wait.
  const result = await sendCopy(s, env, bk, signed, deps.fetchImpl);
  // `already`: Apps Script had sent this copy before, so no new email went out.
  return json(200, { ok: true, copy: bk.copy, ...(result.already ? { already: true } : {}) });
}

async function readDoc(s: Store, env: AgreementEnv, ctx: Ctx, deps: AgreementDeps, url: URL): Promise<Response> {
  const bk = await mustLoad(s, url.searchParams.get('k'));
  const signed = await selectSigned(s, bk.token);
  if (signed) {
    await followUpSigned(s, env, ctx, deps, bk, signed);
    return json(200, signedPayload(bk, signed));
  }
  if (bk.status === 'void') return fail(410, 'void');
  const now = s.now();
  if (bk.status === 'sent') {
    bk.status = 'opened';
    bk.opened_at = now.toISOString();
    await putBookingQuietly(s, bk);
  }
  const f = bk.facts;
  return json(200, {
    ok: true,
    status: bk.status,
    mode: bk.mode,
    today: shortDate(now),
    number: bk.number,
    client_first: firstWord(f.client_name),
    partner_first: firstWord(f.partner_name),
    client_name: f.client_name,
    partner_name: f.partner_name,
    variants: { share: bk.variants.share, private: bk.variants.private },
    labels: bk.labels ?? labelsOf(f),
    summary: bk.summary ?? summaryOf(f),
  });
}

/** The bytes of a base64 PDF, or null when it is not one of a sensible size. One plain loop: Workers have little CPU time. */
const pdfBytes = (b64: string): Uint8Array | null => {
  if (b64.length > Math.ceil(PDF_MAX_BYTES / 3) * 4 + 4) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  if (bin.length < PDF_MIN_BYTES || bin.length > PDF_MAX_BYTES || !bin.startsWith('%PDF-')) return null;
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

/** The copy as a PDF download. Made by Apps Script, cached in KV. Never changes the booking. */
async function readPdf(s: Store, env: AgreementEnv, deps: AgreementDeps, url: URL): Promise<Response> {
  const bk = await mustLoad(s, url.searchParams.get('k'));
  const signed = await selectSigned(s, bk.token);
  let cacheName: string;
  let filename: string;
  let expirationTtl: number;
  let html: () => string;
  if (signed) {
    // Exactly the emailed copy; the sharing choice is the signed one.
    cacheName = 'signed';
    filename = `AD Photography agreement ${signed.number}.pdf`;
    expirationTtl = PDF_TTL_SIGNED;
    html = () => signedPdfHtml(signed);
  } else {
    if (bk.status === 'void') return fail(410, 'void');
    const c = url.searchParams.get('c');
    if (c !== 'share' && c !== 'private') return fail(400, 'bad_choice');
    const now = s.now();
    cacheName = `${c}:${torontoIsoDate(now)}`;
    filename = `AD Photography agreement ${bk.number} (not signed).pdf`;
    expirationTtl = PDF_TTL_UNSIGNED;
    html = () => pdfDraftDocument(JSON.parse(bk.variants[c].doc_json), { signDateText: shortDate(now) });
  }

  const key = s.key.pdf(bk.token, cacheName);
  let bytes: Uint8Array | null = null;
  try {
    const hit = await s.kv.get(key, 'arrayBuffer');
    if (hit) bytes = new Uint8Array(hit);
  } catch (err) {
    console.error('agreement pdf cache read failed', bk.number, err);
  }
  if (!bytes) {
    const res = await callAppsScript(
      { action: 'agreement_pdf', token: env.FORMS_ADMIN_TOKEN ?? '', test: bk.mode === 'test' ? '1' : '', pdf_html: html() },
      { fetchImpl: deps.fetchImpl },
    );
    const made = res?.ok === true && typeof res.pdf_base64 === 'string' ? pdfBytes(res.pdf_base64) : null;
    if (!made) {
      const reason = !res ? 'no answer' : res.ok !== true ? String(res.error ?? 'not ok') : 'not a pdf';
      console.error('agreement pdf not made', bk.number, reason);
      return fail(502, 'pdf_unavailable');
    }
    bytes = made;
    try {
      await s.kv.put(key, bytes, { expirationTtl });
    } catch (err) {
      console.error('agreement pdf cache write failed', bk.number, err);
    }
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `attachment; filename="${filename}"`,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-robots-tag': JSON_HEADERS['x-robots-tag'],
    },
  });
}

const header = (request: Request, name: string, max = 512): string | null => {
  const v = request.headers.get(name);
  return v ? v.slice(0, max) : null;
};

async function sign(s: Store, env: AgreementEnv, ctx: Ctx, deps: AgreementDeps, request: Request, body: Record<string, unknown>): Promise<Response> {
  const bk = await mustLoad(s, body.k);
  // Already signed: the D1 row answers, whatever this request says. No writes.
  const existing = await selectSigned(s, bk.token);
  if (existing) return json(200, { ...signedPayload(bk, existing), already: true });

  if (bk.status === 'void') return fail(410, 'void');
  if (body.agree !== true) return fail(400, 'must_agree');
  const choice = body.choice;
  if (choice !== 'share' && choice !== 'private') return fail(400, 'bad_choice');
  const presented = bk.variants[choice];
  if (body.text_hash !== presented.hash) return fail(409, 'text_changed');
  const typed = typeof body.signed_name === 'string' ? body.signed_name.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim() : '';
  const typedKey = nameKey(typed);
  if (!typedKey || typed.length > 200 || typedKey !== nameKey(bk.facts.client_name)) {
    // Only the named client signs. The partner typing their own name gets its own answer.
    return fail(400, typedKey && typedKey === nameKey(bk.facts.partner_name) ? 'partner_cannot_sign' : 'name_mismatch');
  }

  const signedAt = s.now();
  const signed_date_text = shortDate(signedAt);
  const final_doc_json = fillSignDate(presented.doc_json, signed_date_text);
  const record: SignedRecord = {
    v: 1,
    mode: s.mode,
    token: bk.token,
    number: bk.number,
    choice,
    signed_name: typed,
    signed_at: signedAt.toISOString(),
    signed_date_text,
    presented_hash: presented.hash,
    final_doc_json,
    final_hash: await sha256Hex(final_doc_json),
    clause_version: bk.clause_version,
    facts: bk.facts,
    link_created_at: bk.created_at,
    ip: header(request, 'cf-connecting-ip', 64),
    user_agent: header(request, 'user-agent'),
    cf_ray: header(request, 'cf-ray', 64),
    country: (request as unknown as { cf?: { country?: string } }).cf?.country ?? header(request, 'cf-ipcountry', 8),
    // The wording shown around the text, as the page showed it.
    labels: bk.labels ?? labelsOf(bk.facts),
    summary: bk.summary ?? summaryOf(bk.facts),
  };

  // The one write that makes it signed: an insert that does nothing when a row exists.
  // Whether it threw or not, the row read back afterwards is the answer.
  try {
    await insertSigned(s, record);
  } catch (err) {
    console.error('agreement signed insert threw, reading back', bk.number, err);
  }
  const winner = await selectSigned(s, bk.token);
  if (!winner) return fail(503, 'storage_unavailable');
  const won = winner.signed_at === record.signed_at && winner.final_hash === record.final_hash;
  // Another request signed first: its record stands, and it already sends the copy.
  if (!won) return json(200, { ...signedPayload(bk, winner), already: true });

  markSigned(bk, winner);
  claimAttempt(bk, signedAt);
  await putBookingQuietly(s, bk);
  await putSignedBackup(s, winner, bk.created_at);
  ctx.waitUntil(sendCopy(s, env, bk, winner, deps.fetchImpl, { claimed: true }));
  return json(200, signedPayload(bk, winner));
}

async function notYet(s: Store, env: AgreementEnv, deps: AgreementDeps, body: Record<string, unknown>): Promise<Response> {
  const bk = await mustLoad(s, body.k);
  // D1 decides when it is bound; this route works on KV alone, then the booking's hint is all there is.
  const signed = s.db ? (await selectSigned(s, bk.token)) !== null : bk.status === 'signed';
  if (signed) return fail(409, 'already_signed');
  if (bk.status === 'void') return fail(410, 'void');

  const message = typeof body.message === 'string' ? cleanMessage(body.message) : '';
  if (message.length < 3 || message.length > 1000) return fail(400, 'bad_message');

  const now = s.now();
  const age = (m: { at: string }) => now.getTime() - Date.parse(m.at);
  const messages = bk.not_yet_messages ?? [];
  const last = messages[messages.length - 1];
  let entry: NonNullable<BookingRecord['not_yet_messages']>[number];
  if (last && last.text === message && age(last) < NOT_YET_QUIET_MS) {
    // A double press sends a delivered message once; one that was not delivered is tried again.
    if (last.sent === true) return json(200, { ok: true });
    const tries = last.tries ?? 1;
    if (tries >= NOT_YET_MAX_TRIES) return fail(429, 'too_many');
    last.tries = tries + 1;
    last.sent = false;
    entry = last;
  } else {
    if (messages.filter((m) => age(m) < DAY_MS).length >= NOT_YET_DAY_MAX) return fail(429, 'too_many');
    entry = { at: now.toISOString(), text: message, sent: false, tries: 1 };
    bk.not_yet_at = entry.at;
    bk.not_yet_messages = [...messages, entry].slice(-NOT_YET_KEEP);
  }
  // Stored before the call, so the text is never lost.
  await putBookingQuietly(s, bk);

  const f = bk.facts;
  const { date, time } = torontoStamp(new Date(entry.at));
  // Awaited: the page says "I got your message" only when the notice went out.
  const res = await callAppsScript(
    {
      action: 'agreement_notice',
      token: env.FORMS_ADMIN_TOKEN ?? '',
      test: bk.mode === 'test' ? '1' : '',
      subject: `Agreement: ${f.client_name} asks for a change (${bk.number})`,
      body: [
        `${f.client_name} does not want to sign yet. They wrote this on ${date} at ${time} (Toronto time):`,
        '',
        message,
        '',
        `Nothing is signed. Booking ${bk.number}.`,
        `Their email: ${f.client_email}`,
        `Their phone: ${f.client_phone}`,
      ].join('\n'),
    },
    { fetchImpl: deps.fetchImpl },
  );
  if (res?.ok !== true) {
    console.error('agreement notice not sent', bk.number, res?.error ?? 'no answer');
    return fail(502, 'not_delivered');
  }
  entry.sent = true;
  await putBookingQuietly(s, bk);
  return json(200, { ok: true });
}

// ------------------------------------------------------------------ entry

/** Every path under /r/agreement/. JSON in and out. */
export async function handleAgreement(request: Request, env: AgreementEnv, ctx: Ctx, deps: AgreementDeps = {}): Promise<Response> {
  try {
    const url = new URL(request.url);
    const route = url.pathname;
    const method = ROUTES[route];
    if (!method) return fail(404, 'not_found');
    if (request.method !== method) return json(405, { ok: false, error: 'method_not_allowed' }, { allow: method });

    const isAdmin = route === '/r/agreement/new' || route === '/r/agreement/void' || route === '/r/agreement/resend';
    if (isAdmin) {
      // Called from Akash's script, which sends no Origin: the secret header is the only check.
      if (!env.FORMS_ADMIN_TOKEN) return fail(503, 'admin_unavailable');
      if (!(await sameSecret(request.headers.get('x-kk-admin') ?? '', env.FORMS_ADMIN_TOKEN))) return fail(401, 'unauthorized');
    } else if (method === 'POST' && !isSameOrigin(request)) {
      return fail(403, 'forbidden');
    }

    // KV holds bookings; D1 holds signed records. Only not-yet can work without D1.
    if (!env.AGREEMENTS_KV) return fail(503, 'storage_unavailable');
    if (!env.AGREEMENTS_DB && route !== '/r/agreement/not-yet') return fail(503, 'storage_unavailable');
    const mode: Mode = isPreviewHost(url.hostname) ? 'test' : 'live';
    const s: Store = { kv: env.AGREEMENTS_KV, db: env.AGREEMENTS_DB, mode, key: keys(mode), now: deps.now ?? (() => new Date()) };

    if (route === '/r/agreement/doc') return await readDoc(s, env, ctx, deps, url);
    if (route === '/r/agreement/pdf') return await readPdf(s, env, deps, url);
    const body = await readBody(request);
    if (route === '/r/agreement/new') return await newBooking(s, body);
    if (route === '/r/agreement/void') return await voidBooking(s, body);
    if (route === '/r/agreement/resend') return await resend(s, env, deps, body);
    if (route === '/r/agreement/sign') return await sign(s, env, ctx, deps, request, body);
    return await notYet(s, env, deps, body);
  } catch (err) {
    if (err instanceof Refusal) return err.response;
    if (err instanceof StorageUnavailable) {
      console.error('agreement storage unavailable', err.message);
      return fail(503, 'storage_unavailable');
    }
    console.error('agreement route failed', err);
    return fail(500, 'server_error');
  }
}
