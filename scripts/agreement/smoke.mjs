#!/usr/bin/env node
// End to end check of the agreement routes on a PREVIEW host (test mode only).
//
//   node scripts/agreement/smoke.mjs https://agreements-kashklicks.<account>.workers.dev
//   node scripts/agreement/smoke.mjs https://agreements-kashklicks.<account>.workers.dev --require-sent
//        # the copy step passes only once the PDF copy is sent (checks every 5 s, 12 times)
//
// Refuses any origin but https://<name>-kashklicks.<account>.workers.dev, so it can never
// make a live booking or send the admin token anywhere else.
// It makes ONE test booking for invented people (Priya Sharma and Arjun Mehta), reads it,
// signs it the way the page does, tries to sign it again with the other choice, and reads it
// again. One line per step, PASS or FAIL. Exit 1 on any FAIL.
// Tokens are printed as their first 6 characters only. The admin token is never printed.
import { createHash } from 'node:crypto';
import { checkOrigin, fetchErrorCode, readAdminToken } from './admin-access.mjs';

const stop = (msg) => {
  console.error(msg);
  process.exit(1);
};

const args = process.argv.slice(2);
const requireSent = args.includes('--require-sent');
const arg = args.find((a) => !a.startsWith('--'));
if (!arg) stop('Usage: node scripts/agreement/smoke.mjs https://<name>-kashklicks.<account>.workers.dev [--require-sent]');
// Only a preview origin. Checked before the token is read.
const target = checkOrigin(arg);
if (target.kind !== 'preview') {
  stop(`Refused: ${target.origin ?? arg} is not a https://<name>-kashklicks.<account>.workers.dev preview. The smoke test runs on a preview only.`);
}
const origin = target.origin;

const adminToken = readAdminToken();

const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const short = (token) => `${String(token).slice(0, 6)}…`;

/** Toronto calendar date `days` from now, as YYYY-MM-DD. */
const torontoDatePlus = (days) => {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

// The PILOT fixture from tests/unit/agreement-render.unit.ts (invented people), with a date
// 30 days ahead so the booking is always valid.
const PILOT = {
  package_id: 'civil-ceremony',
  client_name: 'Priya Sharma',
  partner_name: 'Arjun Mehta',
  client_email: 'priya@example.com',
  client_phone: '416 555 0142',
  event_date: torontoDatePlus(30),
  start_time: '12:00',
  end_time: '14:00',
  place: 'Vaughan City Hall, 2141 Major Mackenzie Dr W, Vaughan, ON L6A 1T1',
  price: 501.25,
  notes: 'Family group photos after the ceremony, inside your 2 hours.',
};

async function call(path, init = {}) {
  try {
    // Never follow a redirect: a request must not travel to another host.
    const res = await fetch(`${origin}${path}`, { cache: 'no-store', redirect: 'error', ...init });
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { status: res.status, body };
  } catch (err) {
    // A code only: the message can quote header values.
    return { status: 0, body: null, error: fetchErrorCode(err) };
  }
}

const getDoc = (k) => call(`/r/agreement/doc?k=${encodeURIComponent(k)}`);
// The page posts from the same origin; the worker checks Origin on sign.
const postSign = (body) =>
  call('/r/agreement/sign', { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });

let failed = false;
const report = (name, ok, detail) => {
  if (!ok) failed = true;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`);
};
/** Status and error code only: never a body that could carry a token. */
const why = (a) => `HTTP ${a.status}${a.body?.error ? ` ${a.body.error}` : ''}${a.error ? ` ${a.error}` : ''}`;

console.log(`TEST  smoke on ${origin}`);

// 1. Make the test booking.
const made = await call('/r/agreement/new', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-kk-admin': adminToken },
  body: JSON.stringify(PILOT),
});
const b = made.body ?? {};
const madeOk =
  made.status === 200 &&
  b.ok === true &&
  b.mode === 'test' &&
  /^KK-TEST-\d{4}-\d{3,6}$/.test(b.number ?? '') &&
  /^[A-Za-z0-9_-]{43}$/.test(b.token ?? '') &&
  b.path === `/welcome/agreement/?k=${b.token}` &&
  b.total === 501.25 &&
  b.retainer === 251 &&
  b.balance === 250.25;
report(
  'new booking',
  madeOk,
  madeOk ? `${b.number}  token ${short(b.token)}  total ${b.total}  retainer ${b.retainer}  balance ${b.balance}  date ${PILOT.event_date}` : why(made),
);
if (!madeOk) {
  console.log('FAIL  remaining steps skipped (no booking)');
  process.exit(1);
}
const k = b.token;

// 2. Read it, as the page does on load.
const doc = await getDoc(k);
const d = doc.body ?? {};
const share = d.variants?.share;
const priv = d.variants?.private;
const docOk =
  doc.status === 200 &&
  d.ok === true &&
  d.status === 'opened' &&
  d.mode === 'test' &&
  d.number === b.number &&
  d.client_name === PILOT.client_name &&
  d.partner_name === PILOT.partner_name &&
  d.labels?.name_expected === PILOT.client_name &&
  typeof share?.doc_json === 'string' &&
  typeof priv?.doc_json === 'string' &&
  sha256Hex(share.doc_json) === share.hash &&
  sha256Hex(priv.doc_json) === priv.hash &&
  share.hash !== priv.hash;
report('read doc', docOk, docOk ? `status ${d.status}  both variant hashes match their doc_json` : why(doc));
if (!docOk) {
  console.log('FAIL  remaining steps skipped (doc not readable)');
  process.exit(1);
}

// 3. Sign with "share": the fingerprint is the SHA-256 of the chosen doc_json, as the page sends it.
const s1 = await postSign({ k, choice: 'share', signed_name: PILOT.client_name, agree: true, text_hash: sha256Hex(share.doc_json) });
const sg = s1.body ?? {};
const signOk =
  s1.status === 200 &&
  sg.ok === true &&
  sg.status === 'signed' &&
  sg.already !== true &&
  sg.number === b.number &&
  sg.signed?.choice === 'share' &&
  sg.signed?.signed_name === PILOT.client_name &&
  typeof sg.signed?.final_doc_json === 'string' &&
  sha256Hex(sg.signed.final_doc_json) === sg.signed.final_hash;
report('sign (share)', signOk, signOk ? `signed ${sg.signed.date} ${sg.signed.time}  final hash ${sg.signed.final_hash.slice(0, 12)}…` : why(s1));

// 4. Sign again with the OTHER choice: the first record stands.
const s2 = await postSign({ k, choice: 'private', signed_name: PILOT.client_name, agree: true, text_hash: sha256Hex(priv.doc_json) });
const sg2 = s2.body ?? {};
const againOk =
  s2.status === 200 &&
  sg2.ok === true &&
  sg2.already === true &&
  sg2.signed?.choice === 'share' &&
  signOk &&
  sg2.signed?.final_hash === sg.signed.final_hash;
report('second sign (private) keeps the first', againOk, againOk ? `already true, choice still ${sg2.signed.choice}` : why(s2));

// Give the copy step (waitUntil after the sign) a moment before the last read.
await new Promise((r) => setTimeout(r, 5000));

// 5. Read it again: the signed state, from the D1 row.
const doc2 = await getDoc(k);
const d2 = doc2.body ?? {};
const readOk =
  doc2.status === 200 &&
  d2.ok === true &&
  d2.status === 'signed' &&
  d2.number === b.number &&
  d2.signed?.choice === 'share' &&
  signOk &&
  d2.signed?.final_hash === sg.signed.final_hash;
report('read doc after signing', readOk, readOk ? `status ${d2.status}  choice ${d2.signed.choice}  same final hash` : why(doc2));

// 6. The PDF copy. Without --require-sent: `pending` until the Apps Script with agreement_signed is
// pasted, and that is a PASS. With --require-sent: only `sent` passes. The doc is read every 5 s, up
// to 12 times; each read also lets the worker retry a pending copy once a minute has passed.
let copy = d2.copy?.status;
if (requireSent && readOk) {
  for (let i = 0; i < 12 && copy !== 'sent'; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const again = await getDoc(k);
    copy = again.body?.copy?.status;
  }
}
const copyOk = readOk && (requireSent ? copy === 'sent' : copy === 'pending' || copy === 'sent');
report(
  requireSent ? 'copy sent' : 'copy',
  copyOk,
  copyOk ? `copy ${copy}${copy === 'pending' ? ' (expected until the Apps Script is pasted)' : ''}` : `copy ${copy ?? 'missing'}`,
);

console.log(failed ? 'SMOKE FAILED' : 'SMOKE PASSED');
process.exit(failed ? 1 : 0);
