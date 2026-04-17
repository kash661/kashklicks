/**
 * AD Photography — form intake
 * Paste this into script.google.com, bind it to a Google Sheet, deploy as a Web App.
 *
 * Receives POST from the site's forms (contact, travel-notify) and:
 *   1. Appends a row to the "Inquiries" tab of the bound spreadsheet.
 *   2. Emails you a notification.
 *   3. Returns JSON so the form can show an inline success state.
 *
 * Deployment:
 *   1. Open the Google Sheet you want to use as the inbox.
 *   2. Extensions → Apps Script → paste this entire file into Code.gs.
 *   3. Update NOTIFY_EMAIL below to your email.
 *   4. Save, then Deploy → New deployment.
 *      - Type: Web app
 *      - Execute as: Me
 *      - Who has access: Anyone
 *   5. Authorize once (Google will warn about "unreviewed app" — that's expected
 *      because it's your own code; click "Advanced" → "Go to ... (unsafe)" → "Allow".)
 *   6. Copy the Web App URL and paste it back into Claude.
 */

const NOTIFY_EMAIL = 'info@kashklicks.ca';
const SHEET_NAME = 'Inquiries';
const COLUMNS = [
  'Received',
  'Source',
  'Name',
  'Email',
  'Phone',
  'Event Type',
  'Event Date',
  'Location',
  'Guest Count',
  'Message',
  'Referral',
  'List',
  'Status',
  'Raw',
];

function doPost(e) {
  try {
    const params = e.parameter || {};
    const now = new Date();

    const sheet = getOrCreateSheet_();
    const pick = (...keys) => {
      for (const k of keys) if (params[k]) return params[k];
      return '';
    };
    const partner = pick('partner_name', 'partnerName', 'partner-name');
    const fullName = partner
      ? `${pick('name')}${partner ? ' & ' + partner : ''}`
      : pick('name');
    const row = [
      now,
      params.source || inferSource_(params),
      fullName,
      pick('email'),
      pick('phone'),
      pick('event_type', 'eventType', 'event-type'),
      pick('event_date', 'eventDate', 'event-date'),
      pick('location'),
      pick('guest_count', 'guestCount', 'guest-count'),
      pick('message'),
      pick('referral', 'how-did-you-find-us', 'howDidYouFindUs'),
      pick('list'),
      'new',
      JSON.stringify(params),
    ];
    sheet.appendRow(row);

    notify_(params, now);

    return jsonOut_({ ok: true });
  } catch (err) {
    console.error(err);
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut_({ ok: true, hint: 'POST only.' });
}

function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(COLUMNS);
    sheet.getRange(1, 1, 1, COLUMNS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function inferSource_(params) {
  if (params.list === 'travel-log') return 'Travel log signup';
  if (params._subject) return params._subject;
  return 'Contact form';
}

function notify_(params, when) {
  const source = params.source || inferSource_(params);
  const subject = `[AD Photography] ${source}`;
  const body = [
    `Source: ${source}`,
    `Received: ${when.toISOString()}`,
    '',
    ...Object.keys(params)
      .filter((k) => !k.startsWith('_'))
      .map((k) => `${k}: ${params[k]}`),
  ].join('\n');

  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject,
    body,
    replyTo: params.email || NOTIFY_EMAIL,
  });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
