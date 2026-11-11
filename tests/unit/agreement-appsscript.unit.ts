import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildBookingFacts, fillSignDate, renderVariant } from '../../src/lib/agreement/render';
import { sha256Hex } from '../../src/lib/agreement/hash';
import { copyFields } from '../../src/worker/agreement-copy';
import type { SignedRecord } from '../../src/worker/agreement-store';

// Runs scripts/google-apps-script.gs in a node:vm context with small
// in-memory fakes for the Apps Script services it touches.

const gsPath = fileURLToPath(new URL('../../scripts/google-apps-script.gs', import.meta.url));
const gsCode = readFileSync(gsPath, 'utf8');

const TOKEN = 'test-admin-token';
const NOTIFY = 'info@kashklicks.ca';

type Cell = unknown;

class FakeRange {
  constructor(
    private sheet: FakeSheet,
    private row: number,
    private col: number,
    private numRows = 1,
    private numCols = 1,
  ) {}
  getValues(): Cell[][] {
    const out: Cell[][] = [];
    for (let r = 0; r < this.numRows; r++) {
      const src = this.sheet.rows[this.row - 1 + r] || [];
      const line: Cell[] = [];
      for (let c = 0; c < this.numCols; c++) {
        const v = src[this.col - 1 + c];
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValue(v: Cell) {
    while (this.sheet.rows.length < this.row) this.sheet.rows.push([]);
    const line = this.sheet.rows[this.row - 1];
    while (line.length < this.col - 1) line.push('');
    line[this.col - 1] = v;
    return this;
  }
  setFontWeight() {
    return this;
  }
  setDataValidation() {
    return this;
  }
}

class FakeSheet {
  rows: Cell[][] = [];
  // When true, appending a data row throws (the header row still works).
  failDataAppends = false;
  constructor(public name: string) {}
  appendRow(arr: Cell[]) {
    if (this.failDataAppends && this.rows.length > 0) throw new Error('Sheet write failed');
    this.rows.push(arr.slice());
    return this;
  }
  getLastRow() {
    return this.rows.length;
  }
  getLastColumn() {
    return this.rows.reduce((m, r) => Math.max(m, r.length), 0);
  }
  getMaxRows() {
    return Math.max(this.rows.length, 1000);
  }
  getRange(row: number, col: number, numRows?: number, numCols?: number) {
    return new FakeRange(this, row, col, numRows, numCols);
  }
  setFrozenRows() {
    return this;
  }
  // Test helper: data rows as objects keyed by the header row.
  records(): Record<string, Cell>[] {
    const [headers, ...data] = this.rows;
    return data.map((line) => {
      const obj: Record<string, Cell> = {};
      (headers || []).forEach((h, i) => {
        obj[String(h)] = line[i] === undefined ? '' : line[i];
      });
      return obj;
    });
  }
}

type SentMail = Record<string, any>;

function makeEnv(opts: { failSends?: number; sheetsDown?: boolean; failRowWrites?: boolean } = {}) {
  const sheets = new Map<string, FakeSheet>();
  const sent: SentMail[] = [];
  const lockLog: string[] = [];
  let failSends = opts.failSends || 0;

  const spreadsheet = {
    getSheetByName: (n: string) => sheets.get(n) || null,
    insertSheet: (n: string) => {
      const s = new FakeSheet(n);
      s.failDataAppends = !!opts.failRowWrites;
      sheets.set(n, s);
      return s;
    },
  };

  const context = vm.createContext({
    console: { log() {}, error() {}, warn() {} },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => {
        if (opts.sheetsDown) throw new Error('Sheets is down');
        return spreadsheet;
      },
      newDataValidation: () => {
        const b = {
          requireValueInList: () => b,
          setAllowInvalid: () => b,
          build: () => ({}),
        };
        return b;
      },
    },
    MailApp: {
      sendEmail: (o: SentMail) => {
        if (failSends > 0) {
          failSends--;
          throw new Error('Service invoked too many times for one day: email.');
        }
        sent.push(o);
      },
    },
    Utilities: {
      newBlob: (content: string, contentType: string, name: string) => ({
        getAs: (type: string) => {
          const pdf = {
            kind: 'converted',
            from: { content, contentType, name },
            type,
            name: '',
            setName(n: string) {
              pdf.name = n;
              return pdf;
            },
          };
          return pdf;
        },
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock: (ms: number) => {
          lockLog.push(`wait:${ms}`);
        },
        releaseLock: () => {
          lockLog.push('release');
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k === 'ADMIN_TOKEN' ? TOKEN : null),
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text: string) => {
        const out = { text, setMimeType: () => out };
        return out;
      },
    },
  });
  vm.runInContext(gsCode, context);

  const post = (parameter: Record<string, string>) => {
    const out = (context as any).doPost({ parameter });
    return JSON.parse(out.text);
  };
  // A JSON body, as a fetch with content-type application/json sends it.
  const postJson = (body: Record<string, unknown>) => {
    const out = (context as any).doPost({
      parameter: {},
      postData: { type: 'application/json', contents: JSON.stringify(body) },
    });
    return JSON.parse(out.text);
  };
  return { post, postJson, sheets, sent, lockLog };
}

const rowFor = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    'Signed at': '2026-11-10T15:00:00.000Z',
    'Booking number': 'KK-2026-001',
    Client: 'Priya Sharma',
    Partner: 'Rohan Mehta',
    Email: 'priya@example.com',
    Phone: '416 555 0100',
    Package: 'Pre wedding, 2 hours',
    'Event date': '2027-05-15',
    Total: '$904.00',
    Retainer: '$271.20',
    Balance: '$632.80',
    Sharing: 'share',
    'Signed name': 'Priya Sharma',
    'Text hash': 'abc123',
    'Clause version': '2026-11-10',
    Notes: '',
    ...overrides,
  });

const signedParams = (overrides: Record<string, string> = {}) => ({
  action: 'agreement_signed',
  token: TOKEN,
  test: '',
  booking_number: 'KK-2026-001',
  to_email: 'priya@example.com',
  email_subject: 'Your signed agreement, KK-2026-001',
  email_body: 'Hi Priya, your signed copy is attached.',
  pdf_html: '<html><body><h1>Agreement</h1></body></html>',
  pdf_name: 'AD Photography agreement KK-2026-001.pdf',
  row_json: rowFor(),
  ...overrides,
});

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

test('ping answers with the agreements version', () => {
  const env = makeEnv();
  expect(env.post({ action: 'agreement_ping', token: TOKEN })).toEqual({ ok: true, agreements: 1 });
});

test('agreement actions need the admin token', () => {
  const env = makeEnv();
  for (const action of ['agreement_ping', 'agreement_signed', 'agreement_notice']) {
    for (const token of [undefined, '', 'wrong-token']) {
      const p: Record<string, string> = { ...signedParams(), action, subject: 'S', body: 'B' };
      if (token === undefined) delete p.token;
      else p.token = token;
      expect(env.post(p)).toEqual({ ok: false, error: 'unauthorized' });
    }
  }
  expect(env.sent).toHaveLength(0);
  expect(env.sheets.size).toBe(0);
});

test('live: emails the client, bcc info@kashklicks.ca, one PDF attached', () => {
  const env = makeEnv();
  const res = env.post(
    signedParams({ row_json: rowFor({ Status: 'hacked', 'Copy sent at': 'x', 'Not a column': 'ignored' }) }),
  );
  expect(res.ok).toBe(true);
  expect(res.already).toBeUndefined();
  expect(res.sent_at).toMatch(ISO);

  expect(env.sent).toHaveLength(1);
  const mail = env.sent[0];
  expect(mail.to).toBe('priya@example.com');
  expect(mail.bcc).toBe(NOTIFY);
  expect(mail.replyTo).toBe(NOTIFY);
  expect(mail.name).toBe('Kash, AD Photography');
  expect(mail.subject).toBe('Your signed agreement, KK-2026-001');
  expect(mail.body).toBe('Hi Priya, your signed copy is attached.');
  expect(mail.attachments).toHaveLength(1);
  const pdf = mail.attachments[0];
  expect(pdf.type).toBe('application/pdf');
  expect(pdf.name).toBe('AD Photography agreement KK-2026-001.pdf');
  expect(pdf.from).toEqual({
    content: '<html><body><h1>Agreement</h1></body></html>',
    contentType: 'text/html',
    name: 'agreement.html',
  });

  expect(env.sheets.has('Contracts TEST')).toBe(false);
  const sheet = env.sheets.get('Contracts')!;
  expect(sheet.rows[0]).toEqual([
    'Signed at', 'Booking number', 'Client', 'Partner', 'Email', 'Phone', 'Package', 'Event date',
    'Total', 'Retainer', 'Balance', 'Sharing', 'Signed name', 'Text hash', 'Clause version',
    'Copy sent at', 'Status', 'Notes',
  ]);
  const rows = sheet.records();
  expect(rows).toHaveLength(1);
  expect(rows[0]['Booking number']).toBe('KK-2026-001');
  expect(rows[0].Client).toBe('Priya Sharma');
  expect(rows[0].Total).toBe('$904.00');
  expect(rows[0]['Text hash']).toBe('abc123');
  expect(rows[0].Status).toBe('signed');
  expect((rows[0]['Copy sent at'] as Date).toISOString()).toBe(res.sent_at);
  expect(sheet.rows[1]).toHaveLength(18);

  expect(env.lockLog).toEqual(['wait:20000', 'release']);
});

test('test mode: emails only info@kashklicks.ca, subject starts with [TEST], row goes to Contracts TEST', () => {
  const env = makeEnv();
  const res = env.post(signedParams({ test: '1', booking_number: 'KK-TEST-2026-001' }));
  expect(res.ok).toBe(true);

  expect(env.sent).toHaveLength(1);
  const mail = env.sent[0];
  expect(mail.to).toBe(NOTIFY);
  expect('bcc' in mail).toBe(false);
  expect(mail.replyTo).toBe(NOTIFY);
  expect(mail.subject).toBe('[TEST] Your signed agreement, KK-2026-001');
  expect(mail.attachments).toHaveLength(1);

  expect(env.sheets.has('Contracts')).toBe(false);
  const rows = env.sheets.get('Contracts TEST')!.records();
  expect(rows).toHaveLength(1);
  expect(rows[0]['Booking number']).toBe('KK-TEST-2026-001');
  expect(rows[0].Status).toBe('signed');
});

test('agreement_signed is idempotent', () => {
  const env = makeEnv();
  const first = env.post(signedParams());
  const second = env.post(signedParams());
  expect(first.ok).toBe(true);
  expect(second).toEqual({ ok: true, already: true, sent_at: first.sent_at });
  expect(env.sent).toHaveLength(1);
  expect(env.sheets.get('Contracts')!.records()).toHaveLength(1);
  expect(env.lockLog).toEqual(['wait:20000', 'release', 'wait:20000', 'release']);

  // Live and test bookings are tracked apart.
  const testRun = env.post(signedParams({ test: '1' }));
  expect(testRun.already).toBeUndefined();
  expect(env.sent).toHaveLength(2);
});

test('a failed send is recorded and can be retried', () => {
  const env = makeEnv({ failSends: 1 });
  const failed = env.post(signedParams());
  expect(failed.ok).toBe(false);
  expect(failed.error).toContain('Service invoked too many times');
  expect(env.sent).toHaveLength(0);

  const sheet = env.sheets.get('Contracts')!;
  let rows = sheet.records();
  expect(rows).toHaveLength(1);
  expect(rows[0].Status).toBe('copy failed');
  expect(rows[0]['Copy sent at']).toBe('');
  expect(rows[0].Client).toBe('Priya Sharma');
  expect(env.lockLog).toEqual(['wait:20000', 'release']);

  const retry = env.post(signedParams({ row_json: rowFor({ Notes: 'retried' }) }));
  expect(retry.ok).toBe(true);
  expect(retry.already).toBeUndefined();
  expect(env.sent).toHaveLength(1);
  rows = sheet.records();
  expect(rows).toHaveLength(1);
  expect(rows[0].Status).toBe('signed');
  expect((rows[0]['Copy sent at'] as Date).toISOString()).toBe(retry.sent_at);
  expect(rows[0].Notes).toBe('retried');

  expect(env.post(signedParams())).toEqual({ ok: true, already: true, sent_at: retry.sent_at });
  expect(env.sent).toHaveLength(1);
});

const CONTRACT_HEADERS = [
  'Signed at', 'Booking number', 'Client', 'Partner', 'Email', 'Phone', 'Package', 'Event date',
  'Total', 'Retainer', 'Balance', 'Sharing', 'Signed name', 'Text hash', 'Clause version',
  'Copy sent at', 'Status', 'Notes',
];

test('a header deleted between a failed send and the retry does not cause a second email', () => {
  const env = makeEnv({ failSends: 1 });
  expect(env.post(signedParams()).ok).toBe(false);
  expect(env.sent).toHaveLength(0);

  // The owner deletes the Phone column by hand.
  const sheet = env.sheets.get('Contracts')!;
  const phone = sheet.rows[0].indexOf('Phone');
  sheet.rows.forEach((line) => line.splice(phone, 1));

  const retry = env.post(signedParams());
  expect(retry.ok).toBe(true);
  expect(retry.row_error).toBeUndefined();
  expect(env.sent).toHaveLength(1);
  const rows = sheet.records();
  expect(rows).toHaveLength(1);
  expect(rows[0].Status).toBe('signed');
  expect('Phone' in rows[0]).toBe(false);

  expect(env.post(signedParams())).toEqual({ ok: true, already: true, sent_at: retry.sent_at });
  expect(env.sent).toHaveLength(1);
});

test('a Contracts tab without the Copy sent at header is refused before sending', () => {
  const env = makeEnv();
  const sheet = new FakeSheet('Contracts');
  sheet.rows.push(CONTRACT_HEADERS.filter((h) => h !== 'Copy sent at'));
  env.sheets.set('Contracts', sheet);

  expect(env.post(signedParams())).toEqual({ ok: false, error: 'contracts_headers' });
  expect(env.sent).toHaveLength(0);
  expect(sheet.rows).toHaveLength(1);
  expect(env.lockLog).toEqual(['wait:20000', 'release']);
});

test('a row write that throws after a successful send still answers ok, with row_error', () => {
  const env = makeEnv({ failRowWrites: true });
  const res = env.post(signedParams());
  expect(res.ok).toBe(true);
  expect(res.sent_at).toMatch(ISO);
  expect(res.row_error).toContain('Sheet write failed');
  expect(env.sent).toHaveLength(1);
  expect(env.lockLog).toEqual(['wait:20000', 'release']);
});

test('a test flag other than "1" or empty is refused for both actions', () => {
  const env = makeEnv();
  const notice = { action: 'agreement_notice', token: TOKEN, subject: 'S', body: 'B' };
  expect(env.post(signedParams({ test: 'true' }))).toEqual({ ok: false, error: 'bad_request' });
  expect(env.post({ ...notice, test: 'true' })).toEqual({ ok: false, error: 'bad_request' });
  expect(env.postJson({ ...signedParams(), test: 1 })).toEqual({ ok: false, error: 'bad_request' });
  expect(env.postJson({ ...notice, test: 1 })).toEqual({ ok: false, error: 'bad_request' });
  expect(env.sent).toHaveLength(0);
  expect(env.sheets.size).toBe(0);
});

test('row values that Sheets would read as a formula or number are stored as text', () => {
  const tricky = { Client: '=HYPERLINK("x")', Phone: '+1 416 555 0142' };

  const appended = makeEnv();
  expect(appended.post(signedParams({ row_json: rowFor(tricky) })).ok).toBe(true);
  let row = appended.sheets.get('Contracts')!.records()[0];
  expect(row.Client).toBe('\'=HYPERLINK("x")');
  expect(row.Phone).toBe("'+1 416 555 0142");
  expect(row['Booking number']).toBe('KK-2026-001');

  const updated = makeEnv({ failSends: 1 });
  expect(updated.post(signedParams()).ok).toBe(false);
  expect(updated.post(signedParams({ row_json: rowFor(tricky) })).ok).toBe(true);
  row = updated.sheets.get('Contracts')!.records()[0];
  expect(row.Client).toBe('\'=HYPERLINK("x")');
  expect(row.Phone).toBe("'+1 416 555 0142");
});

test('the lock is released when the sheet throws', () => {
  const env = makeEnv({ sheetsDown: true });
  const res = env.post(signedParams());
  expect(res.ok).toBe(false);
  expect(res.error).toContain('Sheets is down');
  expect(env.sent).toHaveLength(0);
  expect(env.lockLog).toEqual(['wait:20000', 'release']);
});

test('bad to_email is refused', () => {
  const env = makeEnv();
  const bad = [
    'priya',
    'priya@example',
    'priya@@example.com',
    'priya sharma@example.com',
    'priya@example.com, rohan@example.com',
    'priya@example.com;rohan@example.com',
    'Priya <priya@example.com>',
    'a'.repeat(250) + '@example.com',
  ];
  for (const to_email of bad) {
    expect(env.post(signedParams({ to_email }))).toEqual({ ok: false, error: 'bad_request' });
  }
  expect(env.sent).toHaveLength(0);
  expect(env.sheets.size).toBe(0);
});

test('missing fields and a bad row_json are refused', () => {
  const env = makeEnv();
  for (const key of ['booking_number', 'to_email', 'email_subject', 'email_body', 'pdf_html', 'pdf_name', 'row_json']) {
    const p = signedParams();
    delete (p as Record<string, string>)[key];
    expect(env.post(p)).toEqual({ ok: false, error: 'bad_request' });
    expect(env.post(signedParams({ [key]: '  ' }))).toEqual({ ok: false, error: 'bad_request' });
  }
  for (const row_json of ['{not json', '[1,2]', '"text"', 'null', '42']) {
    expect(env.post(signedParams({ row_json }))).toEqual({ ok: false, error: 'bad_request' });
  }
  expect(env.post({ action: 'agreement_notice', token: TOKEN, subject: 'S' })).toEqual({ ok: false, error: 'bad_request' });
  expect(env.post({ action: 'agreement_notice', token: TOKEN, body: 'B' })).toEqual({ ok: false, error: 'bad_request' });
  expect(env.sent).toHaveLength(0);
  expect(env.sheets.size).toBe(0);
});

test('agreement_notice emails only info@kashklicks.ca', () => {
  const env = makeEnv();
  const base = { action: 'agreement_notice', token: TOKEN, subject: 'Priya Sharma signed', body: 'Booking KK-2026-001 signed.' };
  expect(env.post({ ...base, test: '' })).toEqual({ ok: true });
  expect(env.post({ ...base, test: '1' })).toEqual({ ok: true });
  expect(env.sent).toHaveLength(2);
  expect(env.sent[0].to).toBe(NOTIFY);
  expect('bcc' in env.sent[0]).toBe(false);
  expect(env.sent[0].subject).toBe('Priya Sharma signed');
  expect(env.sent[0].body).toBe('Booking KK-2026-001 signed.');
  expect(env.sent[1].to).toBe(NOTIFY);
  expect(env.sent[1].subject).toBe('[TEST] Priya Sharma signed');
  expect(env.sheets.size).toBe(0);
});

// ------------------------------------------------------------------ contract with the worker

// The PILOT fixture of the worker tests (invented people).
const PILOT = {
  package_id: 'civil-ceremony',
  client_name: 'Priya Sharma',
  partner_name: 'Arjun Mehta',
  client_email: 'priya@example.com',
  client_phone: '416 555 0142',
  event_date: '2026-12-12',
  start_time: '12:00',
  end_time: '14:00',
  place: 'Vaughan City Hall, 2141 Major Mackenzie Dr W, Vaughan, ON L6A 1T1',
  price: 501.25,
  notes: 'Family group photos after the ceremony, inside your 2 hours.',
};

/** A signed record built the way the sign route builds it. */
async function pilotSigned(mode: 'live' | 'test'): Promise<SignedRecord> {
  const number = mode === 'test' ? 'KK-TEST-2026-001' : 'KK-2026-001';
  const createdAt = new Date('2026-11-10T15:00:00Z');
  const facts = buildBookingFacts(PILOT, { number, createdAt });
  const doc_json = JSON.stringify(renderVariant(facts, 'private'));
  const final_doc_json = fillSignDate(doc_json, '10 November 2026');
  return {
    v: 1,
    mode,
    token: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456',
    number,
    choice: 'private',
    signed_name: 'Priya Sharma',
    signed_at: '2026-11-10T15:05:00.000Z',
    signed_date_text: '10 November 2026',
    presented_hash: await sha256Hex(doc_json),
    final_doc_json,
    final_hash: await sha256Hex(final_doc_json),
    clause_version: JSON.parse(doc_json).clause_version,
    facts,
    link_created_at: createdAt.toISOString(),
    ip: null,
    user_agent: null,
    cf_ray: null,
    country: null,
  };
}

test('the copy fields the worker sends are accepted by the real script', async () => {
  for (const mode of ['test', 'live'] as const) {
    const signed = await pilotSigned(mode);
    const fields = copyFields({ FORMS_ADMIN_TOKEN: TOKEN }, signed);
    expect(fields.action).toBe('agreement_signed');
    expect(fields.test).toBe(mode === 'test' ? '1' : '');
    // As the worker sends them: form fields, every value a string.
    const env = makeEnv();
    const res = env.post(Object.fromEntries(new URLSearchParams(fields)));
    expect(res, mode).toMatchObject({ ok: true });
    expect(res.row_error).toBeUndefined();
    expect(env.sent).toHaveLength(1);
    expect(env.sent[0].to).toBe(mode === 'test' ? NOTIFY : 'priya@example.com');
    const rows = env.sheets.get(mode === 'test' ? 'Contracts TEST' : 'Contracts')!.records();
    expect(rows).toHaveLength(1);
    expect(rows[0]['Booking number']).toBe(fields.booking_number);
    expect(rows[0]['Text hash']).toBe(signed.final_hash);
    expect(rows[0].Sharing).toBe(signed.choice);
  }
});

test('existing form intake still appends to Inquiries', () => {
  const env = makeEnv();
  const res = env.post({
    name: 'Priya Sharma',
    partner_name: 'Rohan Mehta',
    email: 'priya@example.com',
    message: 'We would love a pre wedding shoot.',
  });
  expect(res).toEqual({ ok: true });
  const rows = env.sheets.get('Inquiries')!.records();
  expect(rows).toHaveLength(1);
  expect(rows[0].Name).toBe('Priya Sharma & Rohan Mehta');
  expect(rows[0].Email).toBe('priya@example.com');
  expect(rows[0].Source).toBe('Contact form');
  expect(rows[0].Status).toBe('new');
  expect(env.sent).toHaveLength(1);
  expect(env.sent[0].to).toBe(NOTIFY);
  expect(env.sent[0].replyTo).toBe('priya@example.com');
  expect(env.lockLog).toEqual([]);
});
