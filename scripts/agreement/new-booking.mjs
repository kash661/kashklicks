#!/usr/bin/env node
// Make a booking and its agreement link (there is no admin page yet).
//
//   node scripts/agreement/new-booking.mjs <origin> <booking.json> [--live]
//
// <origin>        one of (anything else is refused before the token is read):
//                   https://<name>-kashklicks.<account>.workers.dev   TEST booking (preview)
//                   http://localhost:<port> or http://127.0.0.1:<port>     TEST booking (local)
//                   https://kashklicks.ca                                  LIVE booking, only with --live
// <booking.json>  the booking facts: package_id, client_name, partner_name, client_email,
//                 client_phone, event_date, start_time, end_time, place, price, notes, add_ons,
//                 retainer (optional; default: half of the total, rounded up to the next dollar),
//                 balance_cash (optional; true = the balance is paid in cash only)
// --live          required for the live origin. Without it the live origin is refused.
//
// The admin token is read from the file in admin-access.mjs and sent only in the x-kk-admin
// header. It is never printed.
import { readFileSync } from 'node:fs';
import { checkOrigin, fetchErrorCode, readAdminToken } from './admin-access.mjs';

const args = process.argv.slice(2);
const live = args.includes('--live');
const [originArg, bookingFile] = args.filter((a) => a !== '--live');

const stop = (msg) => {
  console.error(msg);
  process.exit(1);
};
const MAYBE = 'The booking may or may not exist. Run list-bookings to check.';

if (!originArg || !bookingFile) stop('Usage: node scripts/agreement/new-booking.mjs <origin> <booking.json> [--live]');

const target = checkOrigin(originArg);
if (target.error) stop(target.error);
const isLive = target.kind === 'live';
console.log(isLive ? 'LIVE' : 'TEST');
if (isLive && !live) stop(`${target.origin} is the live site. Nothing was sent. Add --live to make a real booking.`);

let booking;
try {
  booking = JSON.parse(readFileSync(bookingFile, 'utf8'));
} catch (err) {
  stop(`Could not read ${bookingFile}: ${err.message}`);
}

const adminToken = readAdminToken();

let res;
try {
  res = await fetch(`${target.origin}/r/agreement/new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-kk-admin': adminToken },
    body: JSON.stringify(booking),
    // Never follow a redirect: the admin header must not travel to another host.
    redirect: 'error',
  });
} catch (err) {
  // The request may have reached the worker before it failed.
  stop(`Request failed (${fetchErrorCode(err)}). ${MAYBE}`);
}

if (res.status >= 500) stop(`The server answered ${res.status}. ${MAYBE}`);

let body;
try {
  body = await res.json();
} catch {
  stop(res.status >= 400 ? `HTTP ${res.status}: the answer was not JSON. Nothing was made.` : `HTTP ${res.status}: the answer was not JSON. ${MAYBE}`);
}
if (res.status !== 200 || body?.ok !== true) {
  stop(`HTTP ${res.status}: ${body?.error ?? 'no error code'}${body?.field ? ` (field: ${body.field})` : ''}. Nothing was made.`);
}

const money = (n) => `$${Number(n).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
console.log(`Booking  ${body.number}  (mode: ${body.mode})`);
console.log(`Total    ${money(body.total)}`);
console.log(`Retainer ${money(body.retainer)}`);
console.log(`Balance  ${money(body.balance)}${body.balance_cash === true ? ' (cash only)' : ''}`);
console.log(`Link     ${target.origin}${body.path}`);
