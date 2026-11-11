// The emailed copy of a signed agreement: the email text, the Contracts row and the
// call to Apps Script. Everything is built from the signed record in D1.
import businessJson from '../data/agreement/business.json' with { type: 'json' };
import { money, torontoStamp } from '../lib/agreement/format';
import { pdfDocument } from '../lib/agreement/html';
import type { AgreementDoc } from '../lib/agreement/types';
import { putBookingQuietly, type AgreementEnv, type BookingRecord, type SignedRecord, type Store } from './agreement-store';
import { callAppsScript } from './shared';

export const BUSINESS = businessJson as unknown as { etransferEmail: string };

const COPY_MAX_ATTEMPTS = 5;
const COPY_RETRY_MS = 60_000;

export const firstWord = (name: string) => name.trim().split(/\s+/)[0] ?? '';

/** The fields of the agreement_signed call. Exported for the contract test against the real Apps Script. */
export function copyFields(env: AgreementEnv, s: SignedRecord): Record<string, string> {
  const f = s.facts;
  const doc = JSON.parse(s.final_doc_json) as AgreementDoc;
  const pdf_html = pdfDocument(doc, {
    signed_name: s.signed_name,
    partner_name: f.partner_name,
    choice: s.choice,
    signed_at: new Date(s.signed_at),
    number: s.number,
    final_hash: s.final_hash,
  });
  const email_body = [
    `Hi ${firstWord(f.client_name)},`,
    '',
    'Thank you for signing. Your signed agreement is attached as a PDF. Please keep it.',
    '',
    `Next step: send the retainer of ${money(f.retainer)} by Interac e-transfer to ${BUSINESS.etransferEmail}. Please put your booking number, ${s.number}, in the message. Your date is held once the retainer arrives.`,
    '',
    f.balance_cash === true
      ? `The balance of ${money(f.balance)} is due on or before the day, in cash.`
      : `The balance of ${money(f.balance)} is due on or before the day, by e-transfer or cash.`,
    '',
    'If anything looks wrong, just reply to this email.',
    '',
    'Warmly,',
    'Kash',
    'AD Photography',
    'kashklicks.ca',
  ].join('\n');
  // The Contracts columns; Apps Script itself sets 'Copy sent at' and 'Status'.
  const row = {
    'Signed at': s.signed_at,
    'Booking number': s.number,
    Client: f.client_name,
    Partner: f.partner_name,
    Email: f.client_email,
    Phone: f.client_phone,
    Package: f.package_name,
    'Event date': f.event_date,
    Total: money(f.total),
    Retainer: money(f.retainer),
    Balance: money(f.balance),
    Sharing: s.choice,
    'Signed name': s.signed_name,
    'Text hash': s.final_hash,
    'Clause version': s.clause_version,
    Notes: f.notes,
  };
  return {
    action: 'agreement_signed',
    token: env.FORMS_ADMIN_TOKEN ?? '',
    test: s.mode === 'test' ? '1' : '',
    booking_number: s.number,
    to_email: f.client_email,
    email_subject: `Your signed agreement with AD Photography (${s.number})`,
    email_body,
    pdf_html,
    pdf_name: `AD Photography agreement ${s.number}.pdf`,
    row_json: JSON.stringify(row),
  };
}

/** Counts one attempt on the booking. The caller stores it before Apps Script is called. */
export const claimAttempt = (bk: BookingRecord, now: Date) => {
  bk.copy = { ...bk.copy, attempts: bk.copy.attempts + 1, last_attempt_at: now.toISOString() };
};

export const copyDue = (bk: BookingRecord, now: Date) =>
  bk.copy.status === 'pending' &&
  bk.copy.attempts < COPY_MAX_ATTEMPTS &&
  (!bk.copy.last_attempt_at || now.getTime() - Date.parse(bk.copy.last_attempt_at) > COPY_RETRY_MS);

/**
 * Tells Akash that a signed agreement's copy did not go out, through agreement_notice.
 * Records on the booking whether the notice went out. A failure is logged, never thrown.
 */
async function sendCopyNotice(env: AgreementEnv, bk: BookingRecord, signed: SignedRecord, error: string, fetchImpl: typeof fetch | undefined) {
  const f = signed.facts;
  const { date, time } = torontoStamp(new Date(signed.signed_at));
  let res: Record<string, unknown> | null = null;
  try {
    res = await callAppsScript(
      {
        action: 'agreement_notice',
        token: env.FORMS_ADMIN_TOKEN ?? '',
        test: signed.mode === 'test' ? '1' : '',
        subject: `Signed, but the copy was not sent: ${f.client_name} (${signed.number})`,
        body: `${f.client_name} signed booking ${signed.number} on ${date} at ${time} (Toronto time), but the PDF copy could not be sent to ${f.client_email}. Reason: ${error}. Ask Claude to resend it.`,
      },
      { fetchImpl },
    );
  } catch (err) {
    console.error('agreement copy notice failed', bk.number, err);
  }
  bk.copy = { ...bk.copy, notice_sent: res?.ok === true };
  if (res?.ok !== true) console.error('agreement copy notice not sent', bk.number, res?.error ?? 'no answer');
}

/**
 * The copy step. Counts the attempt (stored first, so a visit during a slow call does
 * not start a second one), asks Apps Script to email the PDF, and on { ok: true }
 * marks the copy sent. `already` is true when Apps Script had sent it before. Never throws.
 * When Apps Script answers but does not send, Akash gets one notice per booking; a notice
 * that did not go out is tried once more on the attempt that reaches the cap.
 */
export async function sendCopy(
  s: Store,
  env: AgreementEnv,
  bk: BookingRecord,
  signed: SignedRecord,
  fetchImpl: typeof fetch | undefined,
  opts: { claimed?: boolean } = {},
): Promise<{ sent: boolean; already: boolean }> {
  try {
    if (!opts.claimed) {
      claimAttempt(bk, s.now());
      await putBookingQuietly(s, bk);
    }
    const res = await callAppsScript(copyFields(env, signed), { fetchImpl });
    if (res?.ok !== true) {
      const error = res === null ? 'no answer' : String(res.error ?? 'unknown');
      console.error('agreement copy not sent', bk.number, error);
      const answered = res !== null; // reachable, but it refused or failed
      const atCap = bk.copy.attempts === COPY_MAX_ATTEMPTS;
      if ((answered && bk.copy.notice_sent === undefined) || (atCap && bk.copy.notice_sent !== true)) {
        await sendCopyNotice(env, bk, signed, error, fetchImpl);
        await putBookingQuietly(s, bk);
      }
      return { sent: false, already: false };
    }
    if (res.row_error) console.error('agreement copy sent, sheet row failed', bk.number, res.row_error);
    bk.copy = { ...bk.copy, status: 'sent', sent_at: typeof res.sent_at === 'string' ? res.sent_at : s.now().toISOString() };
    await putBookingQuietly(s, bk);
    return { sent: true, already: res.already === true };
  } catch (err) {
    console.error('agreement copy step failed', bk.number, err);
    return { sent: false, already: false };
  }
}
