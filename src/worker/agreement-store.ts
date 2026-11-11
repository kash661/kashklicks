// Storage for the agreement routes. KV holds the booking (and a backup copy of the
// signed record that is never read for a decision). D1 holds the signed record and
// is the only truth for "is this booking signed": its primary key makes the insert
// atomic, which KV cannot do.
import type { BookingFacts, Choice } from '../lib/agreement/types';

export type Mode = 'live' | 'test';

/** The small part of the D1 binding these routes use (no types package in this repo). */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ meta: { changes: number } }>;
      first<T>(): Promise<T | null>;
    };
  };
}

export interface AgreementEnv {
  AGREEMENTS_KV?: KVNamespace;
  AGREEMENTS_DB?: D1Like;
  FORMS_ADMIN_TOKEN?: string;
}

/** What the page shows around the agreement text, frozen when the booking is made. */
export interface StoredLabels {
  share_option: string;
  private_option: string;
  agree_label: string;
  intro_bullets: string[];
  after_signing: { title: string; text: string };
  name_expected: string;
}
export interface StoredSummary {
  package: string;
  date: string;
  total: string;
  retainer: string;
  balance: string;
  etransfer_email: string;
}

export interface BookingRecord {
  v: 1;
  mode: Mode;
  token: string;
  number: string;
  status: 'sent' | 'opened' | 'signed' | 'void'; // 'signed' is a hint only: D1 decides
  created_at: string;
  opened_at?: string;
  signed_at?: string;
  not_yet_at?: string;
  facts: BookingFacts;
  clause_version: string;
  variants: Record<Choice, { doc_json: string; hash: string }>; // hash = sha256Hex(doc_json), date token still inside
  // Frozen at creation. Missing on bookings made before they were stored: those compute them.
  labels?: StoredLabels;
  summary?: StoredSummary;
  // notice_sent: unset until a refused copy first tries the owner notice; then whether that notice went out.
  copy: { status: 'none' | 'pending' | 'sent'; attempts: number; last_attempt_at?: string; sent_at?: string; notice_sent?: boolean };
}

export interface SignedRecord {
  v: 1;
  mode: Mode;
  token: string;
  number: string;
  choice: Choice;
  signed_name: string;
  signed_at: string;
  signed_date_text: string;
  presented_hash: string;
  final_doc_json: string;
  final_hash: string;
  clause_version: string;
  facts: BookingFacts;
  link_created_at: string;
  ip: string | null;
  user_agent: string | null;
  cf_ray: string | null;
  country: string | null;
  // What the page showed around the text (tick box wording, options, summary). Missing on older records.
  labels?: StoredLabels;
  summary?: StoredSummary;
}

/** A read (or a needed write) failed: the route answers 503 storage_unavailable. */
export class StorageUnavailable extends Error {}

// 30 days: every test key but the sequence is gone 30 days after its booking was made. The sequence
// never expires, so test numbers do not start over and meet the D1 rows, which never expire either.
export const TEST_TTL = 2592000;

export const keys = (mode: Mode) => ({
  bk: (token: string) => `agr:${mode}:bk:${token}`,
  num: (number: string) => `agr:${mode}:num:${number}`,
  seq: (year: string) => `agr:${mode}:seq:${year}`,
  signed: (token: string) => `agr:${mode}:signed:${token}`, // backup copy only
});

export interface Store {
  kv: KVNamespace;
  db?: D1Like;
  mode: Mode;
  key: ReturnType<typeof keys>;
  now: () => Date;
}

/** Test keys expire 30 days after the booking was made, whenever they are written. */
export const ttl = (s: Store, createdAt: string) => {
  if (s.mode === 'live') return {};
  const age = Math.floor((s.now().getTime() - Date.parse(createdAt)) / 1000);
  return { expirationTtl: Math.max(60, TEST_TTL - Math.max(0, age)) };
};

export async function kvGet(s: Store, key: string): Promise<string | null> {
  try {
    return await s.kv.get(key);
  } catch (err) {
    throw new StorageUnavailable(`kv read failed: ${String(err)}`);
  }
}

export const putBooking = (s: Store, bk: BookingRecord) =>
  s.kv.put(s.key.bk(bk.token), JSON.stringify(bk), {
    ...ttl(s, bk.created_at),
    // The copy state too, so list-bookings shows a copy that was never sent.
    metadata: {
      number: bk.number,
      client: bk.facts.client_name,
      status: bk.status,
      created_at: bk.created_at,
      copy_status: bk.copy.status,
      copy_attempts: bk.copy.attempts,
    },
  });

/** A write the request can live without (D1 stays the truth). Logs instead of throwing. */
export const putBookingQuietly = async (s: Store, bk: BookingRecord) => {
  try {
    await putBooking(s, bk);
  } catch (err) {
    console.error('agreement booking write failed', bk.number, err);
  }
};

/** The booking for a token, or null when the token is malformed or unknown. */
export async function loadBooking(s: Store, token: unknown): Promise<BookingRecord | null> {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const text = await kvGet(s, s.key.bk(token));
  return text === null ? null : (JSON.parse(text) as BookingRecord);
}

export async function bookingByNumber(s: Store, number: string): Promise<BookingRecord | null> {
  const token = await kvGet(s, s.key.num(number));
  return token ? loadBooking(s, token) : null;
}

// ------------------------------------------------------------------ D1: the signed record

// Table and index: migrations/0001_signed_agreements.sql
const SELECT_SIGNED = 'SELECT record FROM signed_agreements WHERE mode = ?1 AND token = ?2';
const INSERT_SIGNED =
  'INSERT INTO signed_agreements (mode, token, number, signed_at, final_hash, record) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT DO NOTHING';

const NUMBER_SIGNED = 'SELECT 1 FROM signed_agreements WHERE mode = ?1 AND number = ?2';

const requireDb = (s: Store): D1Like => {
  if (!s.db) throw new StorageUnavailable('no AGREEMENTS_DB binding');
  return s.db;
};

/** The signed record for a token, from D1. A failed read throws StorageUnavailable. */
export async function selectSigned(s: Store, token: string): Promise<SignedRecord | null> {
  let row: { record: string } | null;
  try {
    row = await requireDb(s).prepare(SELECT_SIGNED).bind(s.mode, token).first<{ record: string }>();
  } catch (err) {
    throw new StorageUnavailable(`d1 read failed: ${String(err)}`);
  }
  return row ? (JSON.parse(row.record) as SignedRecord) : null;
}

/** True when D1 has a signed row with this number. A failed read throws StorageUnavailable. */
export async function numberSigned(s: Store, number: string): Promise<boolean> {
  try {
    return (await requireDb(s).prepare(NUMBER_SIGNED).bind(s.mode, number).first<unknown>()) !== null;
  } catch (err) {
    throw new StorageUnavailable(`d1 read failed: ${String(err)}`);
  }
}

/** Inserts the record unless a row for this token (or number) exists. May throw; the caller reads back. */
export async function insertSigned(s: Store, rec: SignedRecord): Promise<void> {
  await requireDb(s)
    .prepare(INSERT_SIGNED)
    .bind(s.mode, rec.token, rec.number, rec.signed_at, rec.final_hash, JSON.stringify(rec))
    .run();
}

/** Backup copy of the signed record in KV. Best effort, and never read for a decision. */
export async function putSignedBackup(s: Store, rec: SignedRecord, createdAt: string): Promise<void> {
  try {
    await s.kv.put(s.key.signed(rec.token), JSON.stringify(rec), ttl(s, createdAt));
  } catch (err) {
    console.error('agreement signed backup write failed', rec.number, err);
  }
}

/** Brings a KV booking that missed its update in line with the D1 row. True when it changed. */
export const markSigned = (bk: BookingRecord, signed: SignedRecord): boolean => {
  if (bk.status === 'signed' && bk.copy.status !== 'none') return false;
  bk.status = 'signed';
  bk.signed_at ??= signed.signed_at;
  if (bk.copy.status === 'none') bk.copy = { ...bk.copy, status: 'pending' };
  return true;
};
