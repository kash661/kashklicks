import { test, expect, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import { buildBookingFacts, fillSignDate, renderVariant, signLabels } from '../src/lib/agreement/render';
import { longDate, money } from '../src/lib/agreement/format';
import type { AgreementDoc, Choice } from '../src/lib/agreement/types';

// The private agreement page. There is no worker in dev, so every /r/agreement/* call is mocked here.
// Invented people only.
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
const NUMBER = 'KK-TEST-2026-001';
const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ0123456'; // 43 characters, like a real token
const PATH = `/welcome/agreement/?k=${TOKEN}`;

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const facts = buildBookingFacts(PILOT, { number: NUMBER, createdAt: new Date('2026-11-10T15:00:00Z') });
const DOCS: Record<Choice, AgreementDoc> = { share: renderVariant(facts, 'share'), private: renderVariant(facts, 'private') };
const variant = (c: Choice) => {
  const doc_json = JSON.stringify(DOCS[c]);
  return { doc_json, hash: sha256(doc_json) };
};
const VARIANTS = { share: variant('share'), private: variant('private') };
const LABELS = { ...signLabels(facts), name_expected: facts.client_name };
const SUMMARY = {
  package: facts.package_name,
  date: longDate(facts.event_date),
  total: money(facts.total),
  retainer: money(facts.retainer),
  balance: money(facts.balance),
  etransfer_email: 'info@kashklicks.ca',
};

const docPayload = (over: Record<string, unknown> = {}) => ({
  ok: true,
  status: 'opened',
  mode: 'test',
  today: '10 November 2026',
  number: NUMBER,
  client_first: 'Priya',
  partner_first: 'Arjun',
  client_name: 'Priya Sharma',
  partner_name: 'Arjun Mehta',
  variants: VARIANTS,
  labels: LABELS,
  summary: SUMMARY,
  ...over,
});

const signedPayload = (choice: Choice, over: Record<string, unknown> = {}) => {
  const final_doc_json = fillSignDate(VARIANTS[choice].doc_json, '10 November 2026');
  return {
    ok: true,
    status: 'signed',
    mode: 'test',
    number: NUMBER,
    client_first: 'Priya',
    partner_first: 'Arjun',
    client_name: 'Priya Sharma',
    partner_name: 'Arjun Mehta',
    signed: { choice, signed_name: 'Priya Sharma', date: '10 November 2026', time: '10:00 am', final_doc_json, final_hash: sha256(final_doc_json) },
    summary: SUMMARY,
    labels: LABELS,
    copy: { status: 'pending', to: 'priya@example.com' },
    ...over,
  };
};

const reply = (route: Route, status: number, body: unknown) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** Serves the doc route from a list of answers (the last one repeats) and records every call. */
async function mockDoc(page: Page, answers: [number, unknown][]) {
  const calls: string[] = [];
  await page.route(/\/r\/agreement\/doc/, (route) => {
    calls.push(route.request().url());
    const [status, body] = answers[Math.min(calls.length - 1, answers.length - 1)];
    return reply(route, status, body);
  });
  return calls;
}

const doc = (page: Page) => page.locator('[data-agr-doc]');
const main = (page: Page) => page.locator('main.agr');

async function fillReady(page: Page, choice: Choice, name = 'Priya Sharma') {
  await page.locator('[data-agr-name]').fill(name);
  await page.locator(`[data-agr-choice="${choice}"]`).check();
  await page.locator('[data-agr-agree]').check();
}

test.describe('Private agreement page', () => {
  // No test may leave an uncaught script error behind.
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
  });
  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  test('robots meta is noindex and no tracker code is in the page', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    const res = await page.goto(PATH);
    const html = (await res?.text()) ?? '';
    expect(await page.locator('meta[name="robots"]').getAttribute('content')).toContain('noindex');
    await expect(page).toHaveTitle('Your agreement, AD Photography');
    for (const s of ['fbevents', 'googletagmanager', 'clarity.ms', 'facebook.com/tr']) expect(html, s).not.toContain(s);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const live = await page.content();
    for (const s of ['fbevents', 'googletagmanager', 'clarity.ms', 'facebook.com/tr']) expect(live, s).not.toContain(s);
  });

  test('shows the couple, the booking number and all 23 sections', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-eyebrow]')).toHaveText(`Priya and Arjun · Booking ${NUMBER}`);
    await expect(page.locator('h1:visible')).toHaveText('Your agreement.');
    await expect(page.getByText('Everything we agreed, in one place. Read it through, then sign at the bottom. It takes about fifteen minutes.')).toBeVisible();
    for (const b of LABELS.intro_bullets) await expect(page.locator('[data-agr-bullets] li', { hasText: b })).toBeVisible();
    await expect(doc(page).locator('section.agr-sec')).toHaveCount(23);
    await expect(page.locator('[data-agr-toc] a')).toHaveCount(23);
    await expect(page.locator('[data-agr-toc] a[href="#sec-15"]')).toHaveText('15. Sharing your work, and your privacy');
    // The same frame as the PDF: the document title, then the intro as plain text, then the sections.
    const head = doc(page).locator('> :first-child');
    await expect(head).toHaveClass(/agr-doc-head/);
    await expect(head.locator('.agr-doc-title')).toHaveText(DOCS.share.title);
    await expect(head.locator('.agr-intro')).toHaveText(DOCS.share.intro);
    await expect(doc(page).locator('> :nth-child(2)')).toHaveId('sec-0');
    await expect(page.locator('#sec-0 .agr-intro')).toHaveCount(0);
    await expect(page.locator('#sec-0')).toContainText('This agreement is dated 10 November 2026.');
    await expect(page.locator('[data-agr-business-signature]')).toHaveText(DOCS.share.business_signature);
    await expect(page.locator('[data-agr-ribbon]')).toBeVisible();
  });

  test('before a choice, section 15 shows both versions', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    const s15 = page.locator('#sec-15');
    await expect(s15.locator('[data-agr-variant="share"]')).toContainText('If you choose to share');
    await expect(s15.locator('[data-agr-variant="private"]')).toContainText('If you choose to keep it private');
    const firstClause = (c: Choice) => (DOCS[c].sections[15].items[0] as { text: string }).text;
    await expect(s15.locator('[data-agr-variant="share"]')).toContainText(firstClause('share'));
    await expect(s15.locator('[data-agr-variant="private"]')).toContainText(firstClause('private'));
    await expect(page.locator('#sec-1')).toContainText('You choose at the bottom of this page (section 15). It does not change your price.');
    await expect(page.locator('#sec-1')).not.toContainText('You allow sharing');
    await expect(page.locator('[data-agr-choice-status]')).toHaveText('');
    await expect(page.locator('[data-agr-choice]:checked')).toHaveCount(0);
    await expect(page.locator('[data-agr-agree]')).not.toBeChecked();
    await expect(page.locator('#sec-15')).toHaveCount(1);
  });

  test('choosing private updates sections 1 and 15', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    await page.locator('[data-agr-choice="private"]').check();
    await expect(page.locator('#sec-1')).toContainText('Private. Your work is not shown in public.');
    await expect(page.locator('#sec-1')).not.toContainText('You choose at the bottom of this page');
    const s15 = page.locator('#sec-15');
    await expect(s15.locator('[data-agr-variant]')).toHaveCount(0);
    await expect(s15).toContainText((DOCS.private.sections[15].items[0] as { text: string }).text);
    await expect(s15).not.toContainText((DOCS.share.sections[15].items[1] as { text: string }).text);
    await expect(page.locator('[data-agr-choice-status]')).toHaveText('Sections 1 and 15 above now show your choice.');
    // The document is now the private variant, word for word.
    const shown = await page.locator('#sec-15 p.agr-clause').allInnerTexts();
    expect(shown.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(
      DOCS.private.sections[15].items.map((i) => {
        const c = i as { n: string; text: string };
        return `${c.n} ${c.text}`;
      }),
    );
    await page.locator('[data-agr-choice="share"]').check();
    await expect(page.locator('#sec-1')).toContainText('You allow sharing. It does not change your price.');
    await expect(page.locator('#sec-15')).toContainText((DOCS.share.sections[15].items[1] as { text: string }).text);
  });

  test('review button needs name, choice and tick', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    const review = page.locator('[data-agr-review]');
    await expect(review).toHaveText('Review and sign');
    await expect(review).toBeDisabled();
    await expect(page.locator('[data-agr-name]')).toHaveAttribute('autocomplete', 'name');
    await expect(page.locator('[data-agr-name]')).toHaveAttribute('placeholder', 'Priya Sharma');
    // One helper line under the name field names the only person who can sign.
    const signer = page.locator('[data-agr-signer]');
    await expect(signer).toHaveText('Only Priya Sharma can sign this agreement.');
    await expect(signer).toBeVisible();
    await expect(page.locator('[data-agr-name]')).toHaveAttribute('aria-describedby', (await signer.getAttribute('id'))!);
    await page.locator('[data-agr-name]').fill('Priya Sharma');
    await expect(review).toBeDisabled();
    await page.locator('[data-agr-choice="share"]').check();
    await expect(review).toBeDisabled();
    await page.locator('[data-agr-agree]').check();
    await expect(review).toBeEnabled();
    await page.locator('[data-agr-name]').fill('   ');
    await expect(review).toBeDisabled();
  });

  test('review step shows the names, date, total and retainer', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    const dlg = page.locator('[data-agr-dialog]');
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('[data-agr-dialog-title]')).toHaveText('Check and sign');
    for (const t of ['Priya Sharma', 'Arjun Mehta', 'The Civil Ceremony', 'Saturday 12 December 2026', '$501.25', '$251.00', LABELS.share_option])
      await expect(dlg, t).toContainText(t);
    await expect(dlg.locator('[data-agr-sign]')).toHaveText('Sign the agreement');
    await dlg.locator('[data-agr-back]').click();
    await expect(dlg).toBeHidden();
    await expect(page.locator('[data-agr-review]')).toBeFocused();
  });

  test('signing posts the hash of the chosen text and shows the thank you state', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()], [200, signedPayload('private')]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', async (route) => {
      body = route.request().postDataJSON();
      // While the request is out, the button says so and cannot be pressed again.
      await expect(page.locator('[data-agr-sign]')).toHaveText('Signing…');
      await expect(page.locator('[data-agr-sign]')).toBeDisabled();
      return reply(route, 200, signedPayload('private'));
    });
    await page.goto(PATH);
    await fillReady(page, 'private');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();

    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({ k: TOKEN, choice: 'private', signed_name: 'Priya Sharma', agree: true, text_hash: sha256(VARIANTS.private.doc_json) });
    const signed = page.locator('[data-agr-signed]');
    await expect(signed.locator('[data-agr-thanks]')).toHaveText('Thank you, Priya.');
    await expect(signed.locator('[data-agr-thanks]')).toBeFocused();
    await expect(signed).toContainText('Signed on 10 November 2026 at 10:00 am');
    await expect(signed).toContainText('Your date is held once the retainer arrives. A PDF copy of the signed agreement is on its way to priya@example.com.');
    await expect(signed).toContainText('$251.00');
    await expect(signed).toContainText('info@kashklicks.ca');
    await expect(signed).toContainText(NUMBER);
    await expect(signed).toContainText('$250.25, e-transfer or cash');
    await expect(signed).toContainText(`Step 2 · ${LABELS.after_signing.title}`);
    await expect(signed).toContainText(LABELS.after_signing.text);
    await expect(signed).toContainText(`Signed by Priya Sharma · Record ${NUMBER} · Kept for 7 years`);
    await expect(page.locator('[data-agr-already]')).toBeHidden();
    await expect(page.locator('[data-agr-signbox]')).toBeHidden();
  });

  test('the signed view says how the balance is paid', async ({ page }) => {
    // SUMMARY has no balance_how, like a booking made before it was stored: the line reads as before.
    await mockDoc(page, [[200, signedPayload('share', { summary: { ...SUMMARY, balance_how: 'in cash' } })]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    await expect(page.locator('[data-agr-balance]')).toHaveText('$250.25, in cash');
  });

  test('signs when crypto.subtle is unavailable', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true });
    });
    // A hash the browser could never compute: the page must send the server's value as it is.
    const serverHash = 'f'.repeat(64);
    const variants = { share: VARIANTS.share, private: { ...VARIANTS.private, hash: serverHash } };
    await mockDoc(page, [[200, docPayload({ variants })]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, signedPayload('private'));
    });
    await page.goto(PATH);
    await fillReady(page, 'private');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body.text_hash).toBe(serverHash);
  });

  test('name mismatch shows the fix message and stays on the page', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.route('**/r/agreement/sign', (route) => reply(route, 400, { ok: false, error: 'name_mismatch' }));
    await page.goto(PATH);
    await fillReady(page, 'share', 'Priya S');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    const err = page.locator('[data-agr-error]');
    await expect(err).toHaveText(
      'Please type your name exactly as it is written at the top of the agreement: Priya Sharma. Only Priya can sign. If that name is wrong, do not sign. Message me and I will fix it.',
    );
    await expect(err).toBeFocused();
    await expect(page.locator('[data-agr-dialog]')).toBeHidden();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-name]')).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('[data-agr-review]')).toBeEnabled();
  });

  test('the partner typing their own name is told who signs', async ({ page }) => {
    const calls = await mockDoc(page, [[200, docPayload()]]);
    await page.route('**/r/agreement/sign', (route) => reply(route, 400, { ok: false, error: 'partner_cannot_sign' }));
    await page.goto(PATH);
    await fillReady(page, 'share', 'Arjun Mehta');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    const err = page.locator('[data-agr-error]');
    await expect(err).toHaveText('Only Priya Sharma can sign this agreement. Please ask Priya to sign.');
    await expect(err).toBeFocused();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-name]')).toHaveAttribute('aria-invalid', 'true');
    // A clear answer: the page does not read the link again.
    expect(calls).toHaveLength(1);
  });

  test('a changed text asks for a reload', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.route('**/r/agreement/sign', (route) => reply(route, 409, { ok: false, error: 'text_changed' }));
    await page.goto(PATH);
    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(page.locator('[data-agr-error]')).toHaveText('This agreement was updated. Please reload the page and read it again.');
    await expect(page.locator('[data-agr-error]')).toBeFocused();
  });

  test('after a 503 the page checks the doc again before asking for another try', async ({ page }) => {
    const calls = await mockDoc(page, [[200, docPayload()], [200, docPayload()], [200, signedPayload('share')]]);
    let posts = 0;
    await page.route('**/r/agreement/sign', (route) => {
      posts += 1;
      return reply(route, 503, { ok: false, error: 'storage_unavailable' });
    });
    await page.goto(PATH);
    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    // Not signed on the second read: the try again message.
    await expect(page.locator('[data-agr-error]')).toHaveText('That did not go through. Nothing was signed. Please try again.');
    expect(calls).toHaveLength(2);
    expect(posts).toBe(1);
    // Signed on the third read: the signed state, with no second post.
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(posts).toBe(2);
    expect(calls).toHaveLength(3);
  });

  test('a link signed on another device shows the first signature', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()], [200, signedPayload('share')]]);
    await page.route('**/r/agreement/sign', (route) => reply(route, 200, signedPayload('share', { already: true })));
    await page.goto(PATH);
    await fillReady(page, 'private');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    await expect(page.locator('[data-agr-already]')).toHaveText('This agreement was already signed. Here is the signed copy.');
    await expect(page.locator('[data-agr-signed-doc] #sec-1')).toContainText('You allow sharing. It does not change your price.');
  });

  test('a signed link opens in the signed state with no sign box', async ({ page }) => {
    await mockDoc(page, [[200, signedPayload('private')]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    await expect(page.locator('[data-agr-signbox]')).toHaveCount(0);
    await expect(page.locator('[data-agr-review]')).toHaveCount(0);
    const signedDoc = page.locator('[data-agr-signed-doc]');
    await expect(signedDoc.locator('section.agr-sec')).toHaveCount(23);
    await expect(signedDoc.locator('#sec-1')).toContainText('Private. Your work is not shown in public.');
    await expect(signedDoc.locator('#sec-0')).toContainText('This agreement is dated 10 November 2026.');
    await expect(signedDoc.locator('> :first-child .agr-doc-title')).toHaveText(DOCS.private.title);
    await expect(signedDoc.locator('> :first-child .agr-intro')).toHaveText(DOCS.private.intro);
    await expect(signedDoc.locator('> :nth-child(2)')).toHaveId('sec-0');
    await expect(signedDoc.locator('[data-agr-siglines]')).toContainText(DOCS.private.business_signature);
    await expect(signedDoc.locator('[data-agr-siglines]')).toContainText('Priya Sharma');
    await expect(signedDoc.locator('input, button')).toHaveCount(0);
    await expect(page.locator('[data-agr-already]')).toBeHidden();
  });

  test('a pending copy is checked every 5 seconds until it is sent', async ({ page }) => {
    await page.clock.install();
    const calls = await mockDoc(page, [
      [200, signedPayload('share')],
      [200, signedPayload('share')],
      [200, signedPayload('share', { copy: { status: 'sent', to: 'priya@example.com' } })],
    ]);
    await page.goto(PATH);
    const line = page.locator('[data-agr-copy-line]');
    await expect(line).toHaveText('Your date is held once the retainer arrives. A PDF copy of the signed agreement is on its way to priya@example.com.');
    await page.clock.runFor(5000);
    await expect.poll(() => calls.length).toBe(2);
    await page.clock.runFor(5000);
    await expect(line).toHaveText('Your date is held once the retainer arrives. A PDF copy of the signed agreement was sent to priya@example.com.');
    await page.clock.runFor(20000);
    expect(calls).toHaveLength(3);
  });

  test('a copy still not sent when the checks end asks them to message me', async ({ page }) => {
    await page.clock.install();
    const calls = await mockDoc(page, [[200, signedPayload('share')]]);
    await page.goto(PATH);
    const line = page.locator('[data-agr-copy-line]');
    await expect(line).toHaveText('Your date is held once the retainer arrives. A PDF copy of the signed agreement is on its way to priya@example.com.');
    // Two checks instead of 24, through the test hook.
    await page.evaluate(() => document.querySelector('main.agr')!.setAttribute('data-agr-poll-max', '2'));
    await page.clock.runFor(5000);
    await expect.poll(() => calls.length).toBe(2);
    await expect(line).toHaveText('Your date is held once the retainer arrives. A PDF copy of the signed agreement is on its way to priya@example.com.');
    await page.clock.runFor(5000);
    await expect.poll(() => calls.length).toBe(3);
    await expect(line).toHaveText('If the PDF copy does not arrive in a few minutes, message me and I will send it again.');
    await page.clock.runFor(20000);
    expect(calls).toHaveLength(3);
  });

  test('each print button prints and then shows what to do if nothing happened', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { printed: number }).printed = 0;
      window.print = () => void ((window as unknown as { printed: number }).printed += 1);
    });
    const HINT = 'Nothing happened? Open this page in Safari or Chrome, then print it or save it as a PDF.';
    const printed = () => page.evaluate(() => (window as unknown as { printed: number }).printed);
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    const hint = page.locator('[data-agr-view="ready"] [data-agr-print-hint]');
    await expect(hint).toBeHidden();
    await expect(hint).toHaveAttribute('role', 'status');
    await page.getByRole('button', { name: 'Download or print a copy first' }).click();
    expect(await printed()).toBe(1);
    await expect(hint).toBeVisible();
    await expect(hint).toHaveText(HINT);

    await page.unrouteAll();
    await mockDoc(page, [[200, signedPayload('share', { copy: { status: 'sent', to: 'priya@example.com' } })]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    const signedHint = page.locator('[data-agr-view="signed"] [data-agr-print-hint]');
    await expect(signedHint).toBeHidden();
    await page.getByRole('button', { name: 'Print or save this page' }).click();
    expect(await printed()).toBe(1);
    await expect(signedHint).toBeVisible();
    await expect(signedHint).toHaveText(HINT);
    await expect(signedHint).toHaveAttribute('role', 'status');
  });

  test('a sign that never answers times out and checks the link again', async ({ page }) => {
    const calls = await mockDoc(page, [[200, docPayload()]]);
    let posts = 0;
    // The request is never answered.
    await page.route('**/r/agreement/sign', () => void (posts += 1));
    await page.goto(PATH);
    // A short timeout through the test hook (30 s by default).
    await page.evaluate(() => document.querySelector('main.agr')!.setAttribute('data-agr-sign-timeout', '500'));
    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    const err = page.locator('[data-agr-error]');
    await expect(err).toHaveText('That did not go through. Nothing was signed. Please try again.');
    expect(posts).toBe(1);
    expect(calls).toHaveLength(2);
    await expect(page.locator('[data-agr-sign]')).toHaveText('Sign the agreement');
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
  });

  test('not yet shows a form, sends nothing until Send, and can go back', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    const bodies: Record<string, unknown>[] = [];
    await page.route('**/r/agreement/not-yet', async (route) => {
      bodies.push(route.request().postDataJSON());
      // While the request is out, the button says so and cannot be pressed again.
      await expect(page.locator('[data-agr-fix-send]')).toHaveText('Sending…');
      await expect(page.locator('[data-agr-fix-send]')).toBeDisabled();
      return reply(route, 200, { ok: true });
    });
    await page.goto(PATH);
    await page.locator('[data-agr-name]').fill('Priya Sharma');
    await page.locator('[data-agr-not-yet]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'not-yet');
    await expect(page.locator('[data-agr-not-yet-msg]')).toHaveText(
      'No problem. Nothing is signed and nothing is owed. Tell me what is wrong and I will fix it.',
    );
    const box = page.getByLabel('What should I fix?');
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('maxlength', '1000');
    await expect(box).toHaveAttribute('rows', '5');
    await expect(page.locator('[data-agr-view="not-yet"]')).toContainText('You can also reply to the email or message me on WhatsApp.');
    await expect(page.locator('[data-agr-view="not-yet"]').getByRole('link', { name: 'WhatsApp' })).toBeVisible();
    expect(bodies).toEqual([]);

    // Too short: no request, and the error says so.
    await box.fill('  ok  ');
    await page.getByRole('button', { name: 'Send' }).click();
    const err = page.locator('[data-agr-fix-error]');
    await expect(err).toHaveText('Please write what I should fix.');
    await expect(err).toBeFocused();
    expect(bodies).toEqual([]);

    await box.fill('Please spell my partner as Arjun K. Mehta.\nThanks');
    await page.getByRole('button', { name: 'Send' }).click();
    const done = page.locator('[data-agr-fix-done]');
    await expect(done).toHaveText('Thank you. I got your message. Nothing is signed. I will fix it and write back to you.');
    await expect(done).toBeFocused();
    await expect(done).toHaveAttribute('role', 'status');
    await expect(page.locator('[data-agr-fix-form]')).toBeHidden();
    await expect(err).toBeHidden();
    expect(bodies).toEqual([{ k: TOKEN, message: 'Please spell my partner as Arjun K. Mehta.\nThanks' }]);

    await page.getByRole('button', { name: 'Back to the agreement' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-signbox]')).toBeVisible();
    await expect(page.locator('[data-agr-name]')).toHaveValue('Priya Sharma');
  });

  test('a message that did not go through keeps the text and says what to do', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    const answers: [number, unknown][] = [
      [502, { ok: false, error: 'not_delivered' }],
      [429, { ok: false, error: 'too_many' }],
      [400, { ok: false, error: 'bad_message' }],
    ];
    let n = 0;
    await page.route('**/r/agreement/not-yet', (route) => {
      const a = answers[n++];
      return a ? reply(route, a[0], a[1]) : route.abort();
    });
    await page.goto(PATH);
    await page.locator('[data-agr-not-yet]').click();
    const box = page.getByLabel('What should I fix?');
    await box.fill('The date is wrong.');
    const err = page.locator('[data-agr-fix-error]');
    for (let i = 0; i < 4; i += 1) {
      await page.getByRole('button', { name: 'Send' }).click();
      await expect.poll(() => n).toBe(i + 1);
      await expect(err).toHaveText('That did not go through. Please reply to the email or message me on WhatsApp.');
      await expect(err).toBeFocused();
      await expect(box).toHaveValue('The date is wrong.');
      await expect(page.locator('[data-agr-fix-done]')).toBeHidden();
      await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled();
    }
  });

  test('a message to a link that was signed or voided meanwhile shows that', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()], [200, signedPayload('share')]]);
    await page.route('**/r/agreement/not-yet', (route) => reply(route, 409, { ok: false, error: 'already_signed' }));
    await page.goto(PATH);
    await page.locator('[data-agr-not-yet]').click();
    await page.getByLabel('What should I fix?').fill('The date is wrong.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');

    await page.unrouteAll();
    await mockDoc(page, [[200, docPayload()]]);
    await page.route('**/r/agreement/not-yet', (route) => reply(route, 410, { ok: false, error: 'void' }));
    await page.goto(PATH);
    await page.locator('[data-agr-not-yet]').click();
    await page.getByLabel('What should I fix?').fill('The date is wrong.');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'gone');
  });

  test('unknown and void links show their messages', async ({ page }) => {
    await mockDoc(page, [[404, { ok: false, error: 'not_found' }]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'gone');
    await expect(page.locator('[data-agr-gone-msg]')).toHaveText('This link does not work. Please check that you opened the full link from my message.');

    await page.unrouteAll();
    await mockDoc(page, [[410, { ok: false, error: 'void' }]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'gone');
    await expect(page.locator('[data-agr-gone-msg]')).toHaveText('This link is no longer active. Message me and I will send you a new one.');

    // A link with no token never reaches the server.
    await page.unrouteAll();
    const calls = await mockDoc(page, [[200, docPayload()]]);
    await page.goto('/welcome/agreement/');
    await expect(main(page)).toHaveAttribute('data-agr-state', 'gone');
    await expect(page.locator('[data-agr-gone-msg]')).toHaveText('This link does not work. Please check that you opened the full link from my message.');
    expect(calls).toHaveLength(0);
  });

  test('test mode shows the ribbon', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    await expect(page.locator('[data-agr-ribbon]')).toHaveText('TEST. Nothing here is real.');
    await expect(page.locator('[data-agr-ribbon]')).toBeVisible();
    // A printed test agreement must not look real: the ribbon prints too, and the sign box does not.
    await page.emulateMedia({ media: 'print' });
    await expect(page.locator('[data-agr-ribbon]')).toBeVisible();
    await expect(page.locator('[data-agr-signbox]')).toBeHidden();
    await page.emulateMedia({ media: 'screen' });

    await page.unrouteAll();
    await mockDoc(page, [[200, docPayload({ mode: 'live', number: 'KK-2026-001' })]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-ribbon]')).toBeHidden();
  });

  test('fits a 360 px screen with no sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockDoc(page, [[200, docPayload()]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  });

  test('without <dialog> the inline review locks the form, and the posted choice is the reviewed one', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).HTMLDialogElement;
    });
    await mockDoc(page, [[200, docPayload()]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, signedPayload('private'));
    });
    await page.goto(PATH);
    const controls = ['[data-agr-name]', '[data-agr-choice="share"]', '[data-agr-choice="private"]', '[data-agr-agree]'];
    const panel = page.locator('[data-agr-dialog]');

    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    await expect(panel).toHaveClass(/agr-review--inline/);
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(LABELS.share_option);
    for (const c of controls) await expect(page.locator(c), c).toBeDisabled();
    await expect(page.locator('[data-agr-dialog-title]')).toBeFocused();

    await page.locator('[data-agr-back]').click();
    await expect(panel).toBeHidden();
    for (const c of controls) await expect(page.locator(c), c).toBeEnabled();
    await expect(page.locator('[data-agr-review]')).toBeFocused();

    await page.locator('[data-agr-choice="private"]').check();
    await page.locator('[data-agr-review]').click();
    await expect(panel).toContainText(LABELS.private_option);
    await expect(panel).not.toContainText(LABELS.share_option);
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body.choice).toBe('private');
    expect(body.text_hash).toBe(VARIANTS.private.hash);
  });

  test('a failed load says so without a word about signing, and Try again loads the page', async ({ page }) => {
    await mockDoc(page, [[503, { ok: false, error: 'storage_unavailable' }], [200, docPayload()]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'error');
    await expect(page.locator('[data-agr-load-error]')).toHaveText('This page did not load. Please try again in a minute.');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('h1:visible')).toBeFocused();
  });

  test('a document that fails to render is never left half built, and a retry rebuilds it', async ({ page }) => {
    // Section 5 cannot render: sections 0 to 4 would already be on the page when it throws.
    const broken = (c: Choice) => {
      const d = JSON.parse(VARIANTS[c].doc_json) as AgreementDoc;
      (d.sections[5].items[0] as unknown as { text: null }).text = null;
      const doc_json = JSON.stringify(d);
      return { doc_json, hash: sha256(doc_json) };
    };
    await mockDoc(page, [[200, docPayload({ variants: { share: broken('share'), private: broken('private') } })], [200, docPayload()]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, signedPayload('share'));
    });
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'error');
    await expect(doc(page).locator('section.agr-sec')).toHaveCount(0);

    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(doc(page).locator('section.agr-sec')).toHaveCount(23);
    await expect(page.locator('#sec-22 [data-agr-signbox]')).toBeVisible();
    await expect(page.locator('#sec-5')).toContainText((DOCS.share.sections[5].items[0] as { text: string }).text);
    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body.text_hash).toBe(VARIANTS.share.hash);
  });

  test('variants that differ outside their sections do not load', async ({ page }) => {
    const d = JSON.parse(VARIANTS.private.doc_json) as AgreementDoc;
    d.intro = `${d.intro} Extra.`;
    const doc_json = JSON.stringify(d);
    await mockDoc(page, [[200, docPayload({ variants: { share: VARIANTS.share, private: { doc_json, hash: sha256(doc_json) } } })]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'error');
    await expect(doc(page).locator('section.agr-sec')).toHaveCount(0);
  });

  test('a sign answered 410 shows the void message', async ({ page }) => {
    await mockDoc(page, [[200, docPayload()]]);
    await page.route('**/r/agreement/sign', (route) => reply(route, 410, { ok: false, error: 'void' }));
    await page.goto(PATH);
    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'gone');
    await expect(page.locator('[data-agr-gone-msg]')).toHaveText('This link is no longer active. Message me and I will send you a new one.');
    await expect(page.locator('[data-agr-gone-msg]')).toBeFocused();
  });

  test('no answer to the sign and no answer to the check claims nothing', async ({ page }) => {
    const calls = await mockDoc(page, [[200, docPayload()], [503, { ok: false, error: 'storage_unavailable' }]]);
    let posts = 0;
    await page.route('**/r/agreement/sign', (route) => {
      posts += 1;
      return route.abort('connectionreset');
    });
    await page.goto(PATH);
    await fillReady(page, 'share');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    const err = page.locator('[data-agr-error]');
    await expect(err).toHaveText('I could not check if that went through. Please reload this page before you try again.');
    await expect(err).toBeFocused();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    expect(calls).toHaveLength(2);
    expect(posts).toBe(1);
    for (const c of ['[data-agr-name]', '[data-agr-choice="share"]', '[data-agr-agree]']) await expect(page.locator(c), c).toBeEnabled();
  });
});
