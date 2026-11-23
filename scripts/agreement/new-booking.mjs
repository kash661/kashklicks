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
//                 event_date, place, price, notes, add_ons,
//                 client_phone (optional; left out, null or blank: no phone, and the agreement
//                   names only the email),
//                 start_time and end_time ("HH:MM", both or neither; neither, null or blank:
//                   the times are still to be set, the agreement says so in section 1 and 5 and
//                   you set them with the couple in writing, at the latest with their final
//                   timeline; only one of the two is refused with bad_times),
//                 retainer (optional; default: 25% of the total, rounded up to the next dollar,
//                   paid by e-transfer when signing),
//                 balance_cash (optional; default true: the balance is paid in cash only, on the
//                   day, before shooting starts; false lets this one booking pay the balance by
//                   e-transfer or cash)
//                 Every booking is paid in two parts (since 2026-11-23): the retainer, then the
//                 balance. A wedding (package wedding-full) refuses a retainer other than the
//                 usual 25%. The percent and the e-transfer address come from
//                 src/data/agreement/business.json and are frozen with the booking.
//                 A wedding can be booked for any date (the old 60 day limit went with the second
//                 payment). Booked close to the day, some deadlines in its text are already past:
//                 the engagement session "at least 30 days before your wedding", the timeline,
//                 venue rules and videographer notices "at least 14 days before". Check them with
//                 the couple before you send the link (whether to keep a shorter limit is open).
//                 A package with tick boxes prints one more line, Extras: what the couple can
//                 still tick when they sign (an add-on booked here is not offered again).
//                 Without times it prints "Times    to be set (section 5)", without a phone
//                 "Phone    none".
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
// The worker's rule (render.ts notGiven): missing, null or only spaces is not given. It accepted the
// booking, so the times are both given or both not given.
const notGiven = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
console.log(`Booking  ${body.number}  (mode: ${body.mode})`);
// Only when they are missing (spec section 6). With them the printout is as before.
if (notGiven(booking.start_time) && notGiven(booking.end_time)) console.log('Times    to be set (section 5)');
if (notGiven(booking.client_phone)) console.log('Phone    none');
console.log(`Total    ${money(body.total)}`);
console.log(`Retainer ${money(body.retainer)}`);
console.log(`Balance  ${money(body.balance)}${body.balance_cash === true ? ' (cash only)' : ''}`);
// Only a booking paid in three parts (none is made since 2026-11-23) has these: the balance is split in two.
if (body.second_payment !== undefined) console.log(`Second   ${money(body.second_payment)}`);
if (body.final_payment !== undefined) console.log(`Final    ${money(body.final_payment)}`);
// Only a booking with a fee for private work: what they pay if they choose private.
if (body.private_fee !== undefined)
  console.log(`Private  total ${money(body.private_total)}, retainer ${money(body.private_retainer)} (marketing fee ${money(body.private_fee)})`);
console.log(`Link     ${target.origin}${body.path}`);
// Only a booking with tick boxes: what the couple can still tick when they sign. The amounts above are nothing ticked.
if (Array.isArray(body.tick_boxes) && body.tick_boxes.length > 0) {
  const extras = body.tick_boxes.map((t) => `${t.label} ${money(t.amount)}${t.kind === 'deposit' ? ' deposit' : ''}`);
  console.log(`Extras   ${extras.join(', ')}  (tick boxes at signing)`);
}
