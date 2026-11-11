/**
 * AD Photography — form intake + lead pipeline
 * Paste this into script.google.com, bind it to a Google Sheet, deploy as a Web App.
 *
 * Two roles in one endpoint:
 *   1. Anonymous POST (no token) — site forms append a row to "Inquiries" + email me.
 *   2. Authenticated POST (with token) — Claude reads/writes the pipeline.
 *
 * Tabs in the bound sheet (auto-created on first use):
 *   - Inquiries — raw form submissions, Status starts as "new"
 *   - Pipeline — promoted leads, with status/notes/follow-up tracking
 *   - Booked — moved here when contract signed
 *
 * Setup:
 *   1. In the bound sheet: Project Settings → Script Properties → add
 *      ADMIN_TOKEN = (any random string, e.g. `openssl rand -hex 24`)
 *   2. Save the same token to:
 *      ~/.claude/projects/-Users-akashdesai-projects-kashklicks/forms-admin-token
 *   3. Deploy → Manage deployments → edit existing → New version → Deploy.
 *
 * Client onboarding brief (form=onboarding, posted by the worker's
 * /r/onboarding route): appends a row to the "Onboarding" tab, emails the
 * plain-text brief, and optionally copies a run-of-show Google Doc template.
 * Doc creation needs two extra OAuth scopes (documents + drive) that are NOT
 * in scripts/appsscript.json, so it stays off until you opt in. See
 * scripts/APPS-SCRIPT-PATCH-onboarding.md.
 */

const NOTIFY_EMAIL = 'info@kashklicks.ca';

const INBOX_TAB = 'Inquiries';
const PIPELINE_TAB = 'Pipeline';
const BOOKED_TAB = 'Booked';

const INBOX_COLUMNS = [
  'Received', 'Source', 'Name', 'Email', 'Phone', 'Event Type', 'Event Date',
  'Location', 'Guest Count', 'Message', 'Referral', 'List', 'Status', 'Raw',
];

// A/B pricing test, tracked per client. Always the LAST columns: existing
// sheets get them appended by the setup action (ensureColumns_), never
// reordered. Variant A = portfolio discount, B = privacy fee.
const AB_COLUMNS = ['Price variant', 'Sharing allowed'];
const AB_CHOICES = {
  'Price variant': ['A portfolio discount', 'B privacy fee'],
  'Sharing allowed': ['yes', 'no'],
};

const PIPELINE_COLUMNS = [
  'Inbox Row', 'Promoted', 'Source', 'Name', 'Email', 'Phone', 'Event Type', 'Event Date',
  'Location', 'Guest Count', 'Original Message', 'Referral',
  'Status', 'Last Contact', 'Next Action', 'Notes',
].concat(AB_COLUMNS);

const BOOKED_COLUMNS = [
  'Booked Date', 'Inbox Row', 'Source', 'Name', 'Email', 'Phone', 'Event Type', 'Event Date',
  'Location', 'Guest Count', 'Original Message', 'Referral',
  'Quoted Amount', 'Contract Link', 'Notes',
].concat(AB_COLUMNS);

const VALID_STATUSES = ['new', 'contacted', 'call-booked', 'quoted', 'booked', 'lost', 'ghosted'];

const ONBOARDING_TAB = 'Onboarding';
const ONBOARDING_COLUMNS = [
  'Received', 'Booking ID', 'Submission ID', 'Couple', 'Email', 'Phone', 'Package',
  'Wedding Date', 'Shoot Date', 'Backup Date', 'Location wishes', 'Songs',
  'Deadline', 'Summary', 'Doc Link', 'Status', 'Raw JSON',
];
// Google Sheets caps a cell at 50,000 characters.
const ONBOARDING_RAW_CAP = 49000;

function doPost(e) {
  try {
    const params = parseParams_(e);
    const action = params.action || '';

    if (!action) return handleFormSubmission_(params);

    if (!verifyToken_(params.token)) {
      return jsonOut_({ ok: false, error: 'unauthorized' });
    }

    switch (action) {
      case 'setup':         return handleSetup_();
      case 'list_inbox':    return handleListInbox_();
      case 'list_pipeline': return handleListPipeline_();
      case 'list_booked':   return handleListBooked_();
      case 'list_onboarding': return handleListOnboarding_();
      case 'promote':       return handlePromote_(params);
      case 'ignore':        return handleIgnore_(params);
      case 'update':        return handleUpdate_(params);
      case 'book':          return handleBook_(params);
      case 'agreement_ping':   return jsonOut_({ ok: true, agreements: AGREEMENT_API_VERSION });
      case 'agreement_signed': return handleAgreementSigned_(params);
      case 'agreement_notice': return handleAgreementNotice_(params);
      default:              return jsonOut_({ ok: false, error: 'unknown_action: ' + action });
    }
  } catch (err) {
    console.error(err);
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function doGet() {
  return jsonOut_({ ok: true, hint: 'POST only.' });
}

function parseParams_(e) {
  const params = Object.assign({}, e.parameter || {});
  if (e.postData && e.postData.type && e.postData.type.indexOf('application/json') === 0) {
    try { Object.assign(params, JSON.parse(e.postData.contents || '{}')); } catch (_) {}
  }
  return params;
}

function verifyToken_(token) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN');
  return !!(expected && token && token === expected);
}

/* ---------- form intake (anonymous) ---------- */

function handleFormSubmission_(params) {
  if (params.form === 'onboarding') return handleOnboarding_(params);
  const now = new Date();
  const sheet = getOrCreateSheet_(INBOX_TAB, INBOX_COLUMNS);
  const pick = (...keys) => {
    for (const k of keys) if (params[k]) return params[k];
    return '';
  };
  const partner = pick('partner_name', 'partnerName', 'partner-name');
  const fullName = partner ? `${pick('name')} & ${partner}` : pick('name');
  sheet.appendRow([
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
    JSON.stringify(stripInternal_(params)),
  ]);
  notify_(params, now);
  return jsonOut_({ ok: true });
}

function inferSource_(params) {
  if (params.list === 'travel-log') return 'Travel log signup';
  if (params._subject) return params._subject;
  return 'Contact form';
}

function stripInternal_(params) {
  const out = {};
  Object.keys(params).forEach((k) => {
    if (k === 'token' || k === 'action') return;
    out[k] = params[k];
  });
  return out;
}

function notify_(params, when) {
  const source = params.source || inferSource_(params);
  const subject = `[AD Photography] ${source}`;
  const body = [
    `Source: ${source}`,
    `Received: ${when.toISOString()}`,
    '',
    ...Object.keys(stripInternal_(params))
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

/* ---------- client onboarding brief (anonymous, via the worker) ---------- */

function handleOnboarding_(params) {
  const now = new Date();
  const sheet = getOrCreateSheet_(ONBOARDING_TAB, ONBOARDING_COLUMNS);
  let d = {};
  try {
    d = JSON.parse(params.payload_json || '{}') || {};
  } catch (_) {
    d = {};
  }
  const couple = params.couple || [d.p1_name, d.p2_name].filter(String).join(' and ') || 'Unnamed couple';
  const bookingId = params.booking_id || '';
  // The worker sends readable labels (wish_*); fall back to raw option ids.
  const join = (v) => (Array.isArray(v) ? v.join(', ') : v || '');
  const wishFeatures = params.wish_features || join(d.location_features);
  const wishAreas = params.wish_areas || join(d.location_areas);
  const wishWalking = params.wish_walking || d.walking_level || '';
  const locationWishes = [
    wishFeatures && `Features: ${wishFeatures}`,
    wishAreas && `Areas: ${wishAreas}`,
    wishWalking && `Walking: ${wishWalking}`,
  ].filter(String).join(' | ');
  const songs = (d.songs || [])
    .map((s, i) => `${i + 1}. ${[s.title, s.artist].filter(String).join(' by ')}${s.url ? ' ' + s.url : ''}`)
    .join('\n');

  let docLink = '';
  try {
    docLink = createBriefDoc_(
      Object.assign({}, params, { couple, wish_features: wishFeatures, wish_areas: wishAreas, wish_walking: wishWalking }),
      d,
    );
  } catch (err) {
    console.error('createBriefDoc_ failed', err);
    docLink = '';
  }

  const raw = String(params.payload_json || '');
  sheet.appendRow([
    now,
    bookingId,
    params.submission_id || '',
    couple,
    params.email || d.email || '',
    d.phone || '',
    d.package_id || '',
    d.wedding_date || '',
    d.shoot_date || '',
    d.shoot_date_backup || '',
    locationWishes,
    songs,
    d.delivery_deadline || '',
    params.summary || '',
    docLink,
    'new',
    raw.length > ONBOARDING_RAW_CAP ? raw.slice(0, ONBOARDING_RAW_CAP) + ' [truncated]' : raw,
  ]);

  const subject = `[AD Photography] Shoot brief: ${couple} (${bookingId || 'no booking id'})`;
  const body = [
    params.summary || '(no summary)',
    '',
    `Doc: ${docLink || 'not created (set ONBOARDING_DOC_TEMPLATE_ID to enable)'}`,
    `Submission: ${params.submission_id || ''}`,
    '',
    'Raw JSON:',
    raw,
  ].join('\n');
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject,
    body,
    replyTo: params.email || d.email || NOTIFY_EMAIL,
  });
  return jsonOut_({ ok: true });
}

// Copies the run-of-show template Doc for this couple and fills its
// placeholders. Returns '' (does nothing) unless the script property
// ONBOARDING_DOC_TEMPLATE_ID holds a Google Doc id.
// SCOPES: DocumentApp and DriveApp need
//   https://www.googleapis.com/auth/documents
//   https://www.googleapis.com/auth/drive
// added to appsscript.json (see scripts/appsscript.onboarding-docs.json) and
// a fresh authorization. Without them the call throws, which the caller
// catches, so the sheet row and email still go out.
function createBriefDoc_(p, d) {
  const templateId = PropertiesService.getScriptProperties().getProperty('ONBOARDING_DOC_TEMPLATE_ID');
  if (!templateId) return '';

  const couple = p.couple || 'Couple';
  const copy = DriveApp.getFileById(templateId).makeCopy(`Storyline and run-of-show, ${couple}`);
  const doc = DocumentApp.openById(copy.getId());
  const docBody = doc.getBody();

  const list = (arr, fmt) => (arr || []).map((x, i) => `${i + 1}. ${fmt(x)}`).join('\n');
  const values = {
    COUPLE: couple,
    BOOKING_ID: p.booking_id || '',
    PACKAGE: d.package_id || '',
    SHOOT_DATE: d.shoot_date || '',
    BACKUP_DATE: d.shoot_date_backup || '',
    // Akash filters the location guide from these wishes (scripts/match-locations.mjs).
    LOCATIONS:
      `Wishes: ${p.wish_features || 'none given'}; areas: ${p.wish_areas || 'none given'}; ` +
      `walking: ${p.wish_walking || 'not given'}; their own ideas: ${p.wish_own || d.locations_own || 'none'}`,
    SONGS: list(d.songs, (s) => [s.title, s.artist].filter(String).join(' by ') + (s.url ? ` ${s.url}` : '')),
    MUST_HAVES: d.must_have_shots || '',
    SUMMARY: p.summary || '',
  };
  Object.keys(values).forEach((key) => {
    // replaceText takes a regex pattern, so the braces are escaped.
    const pattern = '\\{\\{' + key + '\\}\\}';
    docBody.replaceText(pattern, String(values[key]));
  });
  doc.saveAndClose();
  return doc.getUrl();
}

function handleListOnboarding_() {
  const sheet = getOrCreateSheet_(ONBOARDING_TAB, ONBOARDING_COLUMNS);
  return jsonOut_({ ok: true, rows: readSheet_(sheet) });
}

/* ---------- pipeline (authenticated) ---------- */

function handleSetup_() {
  getOrCreateSheet_(INBOX_TAB, INBOX_COLUMNS);
  const pipeline = getOrCreateSheet_(PIPELINE_TAB, PIPELINE_COLUMNS);
  const booked = getOrCreateSheet_(BOOKED_TAB, BOOKED_COLUMNS);
  // Tabs made before the A/B test lack the two tracking columns.
  const added = {
    [PIPELINE_TAB]: ensureColumns_(pipeline, AB_COLUMNS, AB_CHOICES),
    [BOOKED_TAB]: ensureColumns_(booked, AB_COLUMNS, AB_CHOICES),
  };
  return jsonOut_({ ok: true, tabs: [INBOX_TAB, PIPELINE_TAB, BOOKED_TAB], added_columns: added });
}

// Appends any missing header at the end of row 1. Never moves or renames an
// existing column. Optional `choices` adds a dropdown below each header.
// Returns the headers it added.
function ensureColumns_(sheet, columns, choices) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  const added = [];
  columns.forEach((name) => {
    let idx = headers.indexOf(name);
    if (idx === -1) {
      idx = headers.length;
      if (headers.length === 1 && headers[0] === '') idx = 0;
      sheet.getRange(1, idx + 1).setValue(name).setFontWeight('bold');
      headers[idx] = name;
      added.push(name);
    }
    if (choices && choices[name]) {
      const rule = SpreadsheetApp.newDataValidation()
        .requireValueInList(choices[name], true)
        .setAllowInvalid(false)
        .build();
      sheet.getRange(2, idx + 1, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
    }
  });
  return added;
}

function handleListInbox_() {
  const sheet = getOrCreateSheet_(INBOX_TAB, INBOX_COLUMNS);
  const rows = readSheet_(sheet).filter((r) => (r.Status || '').toLowerCase() === 'new');
  return jsonOut_({ ok: true, rows });
}

function handleListPipeline_() {
  const sheet = getOrCreateSheet_(PIPELINE_TAB, PIPELINE_COLUMNS);
  return jsonOut_({ ok: true, rows: readSheet_(sheet) });
}

function handleListBooked_() {
  const sheet = getOrCreateSheet_(BOOKED_TAB, BOOKED_COLUMNS);
  return jsonOut_({ ok: true, rows: readSheet_(sheet) });
}

function handlePromote_(params) {
  const inboxRow = parseInt(params.inbox_row, 10);
  if (!inboxRow) return jsonOut_({ ok: false, error: 'inbox_row required' });
  const status = params.status || 'new';
  if (VALID_STATUSES.indexOf(status) === -1) return jsonOut_({ ok: false, error: 'bad status' });

  const inbox = getOrCreateSheet_(INBOX_TAB, INBOX_COLUMNS);
  const pipeline = getOrCreateSheet_(PIPELINE_TAB, PIPELINE_COLUMNS);
  const inboxRecord = readRow_(inbox, inboxRow);
  if (!inboxRecord) return jsonOut_({ ok: false, error: 'inbox row not found' });

  pipeline.appendRow([
    inboxRow,
    new Date(),
    inboxRecord.Source,
    inboxRecord.Name,
    inboxRecord.Email,
    inboxRecord.Phone,
    inboxRecord['Event Type'],
    inboxRecord['Event Date'],
    inboxRecord.Location,
    inboxRecord['Guest Count'],
    inboxRecord.Message,
    inboxRecord.Referral,
    status,
    '',
    '',
    '',
  ]);
  setCellByHeader_(inbox, inboxRow, 'Status', 'promoted');
  return jsonOut_({ ok: true, pipeline_row: pipeline.getLastRow() });
}

function handleIgnore_(params) {
  const inboxRow = parseInt(params.inbox_row, 10);
  if (!inboxRow) return jsonOut_({ ok: false, error: 'inbox_row required' });
  const inbox = getOrCreateSheet_(INBOX_TAB, INBOX_COLUMNS);
  setCellByHeader_(inbox, inboxRow, 'Status', params.reason || 'ignored');
  return jsonOut_({ ok: true });
}

function handleUpdate_(params) {
  const tab = (params.tab || '').toLowerCase();
  const sheetName = tab === 'inbox' ? INBOX_TAB
                  : tab === 'pipeline' ? PIPELINE_TAB
                  : tab === 'booked' ? BOOKED_TAB : null;
  if (!sheetName) return jsonOut_({ ok: false, error: 'tab must be inbox/pipeline/booked' });
  const row = parseInt(params.row, 10);
  if (!row) return jsonOut_({ ok: false, error: 'row required' });
  let fields = params.fields;
  if (typeof fields === 'string') {
    try { fields = JSON.parse(fields); } catch (_) {
      return jsonOut_({ ok: false, error: 'fields must be JSON object' });
    }
  }
  if (!fields || typeof fields !== 'object') {
    return jsonOut_({ ok: false, error: 'fields object required' });
  }
  const sheet = getOrCreateSheet_(sheetName, sheetName === INBOX_TAB ? INBOX_COLUMNS
                                            : sheetName === PIPELINE_TAB ? PIPELINE_COLUMNS
                                            : BOOKED_COLUMNS);
  Object.keys(fields).forEach((header) => setCellByHeader_(sheet, row, header, fields[header]));
  return jsonOut_({ ok: true });
}

function handleBook_(params) {
  const pipelineRow = parseInt(params.pipeline_row, 10);
  if (!pipelineRow) return jsonOut_({ ok: false, error: 'pipeline_row required' });
  const pipeline = getOrCreateSheet_(PIPELINE_TAB, PIPELINE_COLUMNS);
  const booked = getOrCreateSheet_(BOOKED_TAB, BOOKED_COLUMNS);
  const record = readRow_(pipeline, pipelineRow);
  if (!record) return jsonOut_({ ok: false, error: 'pipeline row not found' });

  booked.appendRow([
    new Date(),
    record['Inbox Row'],
    record.Source,
    record.Name,
    record.Email,
    record.Phone,
    record['Event Type'],
    record['Event Date'],
    record.Location,
    record['Guest Count'],
    record['Original Message'],
    record.Referral,
    params.quoted_amount || '',
    params.contract_link || '',
    record.Notes,
  ]);
  // Carry the A/B tracking over when both tabs have the columns.
  const bookedRow = booked.getLastRow();
  AB_COLUMNS.forEach((name) => {
    const value = record[name];
    if (value === undefined || value === '') return;
    try { setCellByHeader_(booked, bookedRow, name, value); } catch (_) { /* run setup first */ }
  });
  setCellByHeader_(pipeline, pipelineRow, 'Status', 'booked');
  return jsonOut_({ ok: true, booked_row: bookedRow });
}

/* ---------- signed agreements (authenticated, via the worker) ---------- */
// The worker writes the email text, the PDF HTML and the row values. This
// block only turns the HTML into a PDF, emails it, and logs one row per
// booking number. No new OAuth scope: MailApp and Utilities are already used.
// See scripts/APPS-SCRIPT-PATCH-agreement.md.

const AGREEMENT_API_VERSION = 1;
const CONTRACTS_TAB = 'Contracts';
const CONTRACTS_TEST_TAB = 'Contracts TEST';
const CONTRACTS_COLUMNS = [
  'Signed at', 'Booking number', 'Client', 'Partner', 'Email', 'Phone', 'Package', 'Event date',
  'Total', 'Retainer', 'Balance', 'Sharing', 'Signed name', 'Text hash', 'Clause version',
  'Copy sent at', 'Status', 'Notes',
];
// Set by the script, never taken from row_json.
const CONTRACTS_SCRIPT_COLUMNS = ['Booking number', 'Copy sent at', 'Status'];
const AGREEMENT_EMAIL_RE = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const AGREEMENT_SENDER_NAME = 'Kash, AD Photography';

function agreementField_(params, key) {
  const v = params[key];
  return v === undefined || v === null ? '' : String(v).trim();
}

// Strict live/test flag: absent or '' is live, the string '1' is test.
// Anything else returns null, and the caller refuses the request.
function agreementMode_(params) {
  const t = params.test;
  if (t === undefined || t === '') return 'live';
  if (t === '1') return 'test';
  return null;
}

// Sheets reads a string starting with = + - or @ as a formula or a number.
// A leading apostrophe keeps it as plain text.
function agreementSheetText_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function handleAgreementSigned_(params) {
  const mode = agreementMode_(params);
  if (!mode) return jsonOut_({ ok: false, error: 'bad_request' });
  const isTest = mode === 'test';
  const required = ['booking_number', 'to_email', 'email_subject', 'email_body', 'pdf_html', 'pdf_name', 'row_json'];
  if (required.some((k) => !agreementField_(params, k))) return jsonOut_({ ok: false, error: 'bad_request' });

  const toEmail = agreementField_(params, 'to_email');
  if (toEmail.length > 254 || !AGREEMENT_EMAIL_RE.test(toEmail)) {
    return jsonOut_({ ok: false, error: 'bad_request' });
  }
  let row = params.row_json;
  if (typeof row === 'string') {
    try { row = JSON.parse(row); } catch (_) { row = null; }
  }
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    return jsonOut_({ ok: false, error: 'bad_request' });
  }
  const bookingNumber = agreementField_(params, 'booking_number');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = getOrCreateSheet_(isTest ? CONTRACTS_TEST_TAB : CONTRACTS_TAB, CONTRACTS_COLUMNS);
    // Without these three headers the script cannot tell a sent copy from an
    // unsent one, so it would email the client again on every retry.
    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0].map(String);
    if (CONTRACTS_SCRIPT_COLUMNS.some((col) => headers.indexOf(col) === -1)) {
      return jsonOut_({ ok: false, error: 'contracts_headers' });
    }
    const matches = readSheet_(sheet).filter((r) => String(r['Booking number']).trim() === bookingNumber);
    const done = matches.find((r) => r['Copy sent at']);
    if (done) return jsonOut_({ ok: true, already: true, sent_at: done['Copy sent at'] });
    const existing = matches[0];

    let sendError = '';
    try {
      const pdf = Utilities.newBlob(String(params.pdf_html), 'text/html', 'agreement.html')
        .getAs('application/pdf')
        .setName(String(params.pdf_name));
      const mail = {
        to: isTest ? NOTIFY_EMAIL : toEmail,
        replyTo: NOTIFY_EMAIL,
        name: AGREEMENT_SENDER_NAME,
        subject: (isTest ? '[TEST] ' : '') + agreementField_(params, 'email_subject'),
        body: String(params.email_body),
        attachments: [pdf],
      };
      if (!isTest) mail.bcc = NOTIFY_EMAIL;
      MailApp.sendEmail(mail);
    } catch (err) {
      console.error('agreement copy send failed', err);
      sendError = String((err && err.message) || err);
    }

    const now = new Date();
    const values = {};
    CONTRACTS_COLUMNS.forEach((col) => {
      if (CONTRACTS_SCRIPT_COLUMNS.indexOf(col) !== -1) return;
      if (Object.prototype.hasOwnProperty.call(row, col)) values[col] = agreementSheetText_(row[col]);
    });
    values['Booking number'] = bookingNumber;
    values['Copy sent at'] = sendError ? '' : now;
    values.Status = sendError ? 'copy failed' : 'signed';

    // A sheet problem after a successful send must not look like a failed
    // send, or the worker would email the client a second time.
    let rowError = '';
    try {
      if (existing) {
        // A retry after a failed send: update that row in place. Columns the
        // owner removed are skipped.
        Object.keys(values).forEach((col) => {
          const idx = headers.indexOf(col);
          if (idx !== -1) sheet.getRange(existing._row, idx + 1).setValue(values[col]);
        });
      } else {
        sheet.appendRow(headers.map((h) => (Object.prototype.hasOwnProperty.call(values, h) ? values[h] : '')));
      }
    } catch (err) {
      console.error('agreement row write failed', err);
      rowError = String((err && err.message) || err);
    }

    const out = sendError
      ? { ok: false, error: 'send_failed: ' + sendError }
      : { ok: true, sent_at: now.toISOString() };
    if (rowError) out.row_error = rowError;
    return jsonOut_(out);
  } finally {
    lock.releaseLock();
  }
}

function handleAgreementNotice_(params) {
  const mode = agreementMode_(params);
  const subject = agreementField_(params, 'subject');
  const body = agreementField_(params, 'body');
  if (!mode || !subject || !body) return jsonOut_({ ok: false, error: 'bad_request' });
  MailApp.sendEmail({
    to: NOTIFY_EMAIL,
    subject: (mode === 'test' ? '[TEST] ' : '') + subject,
    body: String(params.body),
  });
  return jsonOut_({ ok: true });
}

/* ---------- sheet helpers ---------- */

function getOrCreateSheet_(name, columns) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(columns);
    sheet.getRange(1, 1, 1, columns.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const data = sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
  return data.map((arr, i) => {
    const obj = { _row: i + 2 };
    headers.forEach((h, j) => { obj[h] = serializeCell_(arr[j]); });
    return obj;
  });
}

function readRow_(sheet, row) {
  if (row < 2 || row > sheet.getLastRow()) return null;
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const values = sheet.getRange(row, 1, 1, lastCol).getValues()[0];
  const obj = { _row: row };
  headers.forEach((h, j) => { obj[h] = serializeCell_(values[j]); });
  return obj;
}

function setCellByHeader_(sheet, row, header, value) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = headers.indexOf(header);
  if (idx === -1) throw new Error('unknown column: ' + header);
  sheet.getRange(row, idx + 1).setValue(value);
}

function serializeCell_(v) {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
