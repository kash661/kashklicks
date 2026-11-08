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

const PIPELINE_COLUMNS = [
  'Inbox Row', 'Promoted', 'Source', 'Name', 'Email', 'Phone', 'Event Type', 'Event Date',
  'Location', 'Guest Count', 'Original Message', 'Referral',
  'Status', 'Last Contact', 'Next Action', 'Notes',
];

const BOOKED_COLUMNS = [
  'Booked Date', 'Inbox Row', 'Source', 'Name', 'Email', 'Phone', 'Event Type', 'Event Date',
  'Location', 'Guest Count', 'Original Message', 'Referral',
  'Quoted Amount', 'Contract Link', 'Notes',
];

const VALID_STATUSES = ['new', 'contacted', 'call-booked', 'quoted', 'booked', 'lost', 'ghosted'];

const ONBOARDING_TAB = 'Onboarding';
const ONBOARDING_COLUMNS = [
  'Received', 'Booking ID', 'Submission ID', 'Couple', 'Email', 'Phone', 'Package',
  'Wedding Date', 'Shoot Date', 'Backup Date', 'Locations', 'Songs', 'Format',
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
  const locations = (d.locations || []).map((l, i) => `${i + 1}. ${l.name || l.id}`).join('\n');
  const songs = (d.songs || [])
    .map((s, i) => `${i + 1}. ${[s.title, s.artist].filter(String).join(' by ')}${s.url ? ' ' + s.url : ''}`)
    .join('\n');

  let docLink = '';
  try {
    docLink = createBriefDoc_(Object.assign({}, params, { couple }), d);
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
    locations,
    songs,
    d.delivery_format || '',
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
    LOCATIONS: list(d.locations, (l) => l.name || l.id),
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
  getOrCreateSheet_(PIPELINE_TAB, PIPELINE_COLUMNS);
  getOrCreateSheet_(BOOKED_TAB, BOOKED_COLUMNS);
  return jsonOut_({ ok: true, tabs: [INBOX_TAB, PIPELINE_TAB, BOOKED_TAB] });
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
  setCellByHeader_(pipeline, pipelineRow, 'Status', 'booked');
  return jsonOut_({ ok: true, booked_row: booked.getLastRow() });
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
