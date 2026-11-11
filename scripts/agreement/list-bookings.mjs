#!/usr/bin/env node
// List agreement bookings from Cloudflare KV (AGREEMENTS_KV) and whether each one
// has a signed row in D1 (AGREEMENTS_DB). Uses the wrangler login on this machine.
//
//   node scripts/agreement/list-bookings.mjs           # live bookings
//   node scripts/agreement/list-bookings.mjs --test    # test bookings (made on a preview host)
//   node scripts/agreement/list-bookings.mjs --link KK-2026-001
//        # the full link of one live booking, on https://kashklicks.ca
//   node scripts/agreement/list-bookings.mjs --test --link KK-TEST-2026-001 --origin https://agreements-kashklicks.<account>.workers.dev
//        # the full link of one test booking, on the preview it was made on
//
// The listing shows tokens shortened. --link is the one place here that prints a full token.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LIVE_ORIGIN, checkOrigin } from './admin-access.mjs';

const repo = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const mode = args.includes('--test') ? 'test' : 'live';
const prefix = `agr:${mode}:bk:`;
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i === -1 ? null : (args[i + 1] ?? '');
};
const linkNumber = valueOf('--link');
const originArg = valueOf('--origin');
const stop = (msg) => {
  console.error(msg);
  process.exit(1);
};

/** `missingOk`: a KV key that does not exist answers '' instead of stopping. */
function wrangler(args, { missingOk = false } = {}) {
  try {
    return execFileSync('npx', ['wrangler', ...args], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    if (missingOk && /404: Not Found/.test(String(err.stderr))) return '';
    console.error('wrangler failed. Is this machine logged in? Try: npx wrangler whoami');
    console.error(String(err.stderr || err.message).trim().split('\n').slice(-5).join('\n'));
    process.exit(1);
  }
}

/** wrangler prints a banner before the JSON; take the outer array. */
const jsonArray = (out) => {
  const start = out.indexOf('[');
  return start === -1 ? [] : JSON.parse(out.slice(start, out.lastIndexOf(']') + 1));
};

const short = (token) => `${String(token).slice(0, 6)}…`;
const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
const stamp = (iso) => (iso ? String(iso).replace('T', ' ').slice(0, 16) : '');
/** The PDF copy: sent, pending <attempts>, none. A booking not written since the copy state joined the metadata shows ?. */
const copyOf = (meta) => {
  if (!meta || typeof meta.copy_status !== 'string') return '?';
  return meta.copy_status === 'pending' ? `pending ${meta.copy_attempts ?? '?'}` : meta.copy_status;
};

if (linkNumber !== null) {
  const numberRe = mode === 'test' ? /^KK-TEST-\d{4}-\d{3,6}$/ : /^KK-\d{4}-\d{3,6}$/;
  if (!numberRe.test(linkNumber)) stop(`Not a ${mode} booking number: ${linkNumber}`);
  let origin = LIVE_ORIGIN;
  if (mode === 'test') {
    if (!originArg) stop('--test --link needs --origin <the preview origin the booking was made on>');
    const target = checkOrigin(originArg);
    if (target.error) stop(target.error);
    if (target.kind === 'live') stop(`A test booking does not open on ${target.origin}. Give the preview origin.`);
    origin = target.origin;
  } else if (originArg !== null) {
    const target = checkOrigin(originArg);
    if (target.error) stop(target.error);
    if (target.kind !== 'live') stop(`A live booking opens on ${LIVE_ORIGIN} only. Leave out --origin, or add --test for a test booking.`);
  }
  const out = wrangler(['kv', 'key', 'get', `agr:${mode}:num:${linkNumber}`, '--binding', 'AGREEMENTS_KV', '--remote', '--text'], { missingOk: true });
  const token = out
    .split('\n')
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z0-9_-]{43}$/.test(l));
  if (!token) stop(`No ${mode} booking ${linkNumber} in KV (test bookings are gone 30 days after they were made).`);
  console.log(`${linkNumber}  ${origin}/welcome/agreement/?k=${token}`);
  process.exit(0);
}

const keys = jsonArray(wrangler(['kv', 'key', 'list', '--binding', 'AGREEMENTS_KV', '--remote', '--prefix', prefix]));
// Constant SQL: `mode` is one of two fixed words, never user text. 1000 rows covers every
// signed booking of the pilot, so none shows as unsigned because of the limit.
const d1 = jsonArray(
  wrangler([
    'd1',
    'execute',
    'kashklicks-agreements',
    '--remote',
    '--json',
    '--command',
    `SELECT mode, number, signed_at, final_hash FROM signed_agreements WHERE mode = '${mode}' ORDER BY signed_at DESC LIMIT 1000`,
    '--yes',
  ]),
);
const signedRows = d1.flatMap((r) => r.results ?? []);
const signedByNumber = new Map(signedRows.map((r) => [r.number, r]));

const bookings = keys
  .map((k) => ({
    token: k.name.slice(prefix.length),
    number: k.metadata?.number ?? '',
    client: k.metadata?.client ?? '',
    status: k.metadata?.status ?? '',
    created_at: k.metadata?.created_at ?? '',
    copy: copyOf(k.metadata),
    signed: signedByNumber.get(k.metadata?.number) ?? null,
  }))
  .sort((a, b) => b.created_at.localeCompare(a.created_at));

console.log(`${mode.toUpperCase()} bookings`);
if (bookings.length === 0) console.log('No bookings stored.');
else {
  console.log(`${pad('Created (UTC)', 16)}  ${pad('Number', 18)}  ${pad('Client', 26)}  ${pad('KV status', 9)}  ${pad('Signed UTC (D1)', 16)}  ${pad('Copy', 10)}  Token`);
  for (const b of bookings) {
    console.log(
      `${pad(stamp(b.created_at), 16)}  ${pad(b.number, 18)}  ${pad(b.client, 26)}  ${pad(b.status, 9)}  ${pad(b.signed ? stamp(b.signed.signed_at) : 'no', 16)}  ${pad(b.copy, 10)}  ${short(b.token)}`,
    );
  }
}

// A signed row whose booking is not in KV (a test booking past its 30 days, for example).
const listed = new Set(bookings.map((b) => b.number));
const orphans = signedRows.filter((r) => !listed.has(r.number));
if (orphans.length) {
  console.log(`\nSigned rows in D1 with no booking in KV:`);
  for (const r of orphans) console.log(`${pad(r.number, 18)}  signed ${stamp(r.signed_at)} UTC  hash ${String(r.final_hash).slice(0, 12)}…`);
}

console.log(`\n${bookings.length} booking(s), ${signedRows.length} signed row(s) in D1 (up to 1000 read).`);
