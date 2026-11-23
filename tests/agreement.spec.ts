import { test, expect, type Locator, type Page, type Route } from '@playwright/test';
import { createHash } from 'node:crypto';
import pageJson from '../src/data/agreement/page.json' with { type: 'json' };
import { buildBookingFacts, buildVariantSet, fillSignDate, renderVariant, signLabels } from '../src/lib/agreement/render';
import { longDate, money } from '../src/lib/agreement/format';
import { sectionToHtml } from '../src/lib/agreement/html';
import type { AgreementDoc, BookingFacts, Choice, PageContent, StoredSummary } from '../src/lib/agreement/types';
import { factsFor, laterPaymentRows } from '../src/lib/agreement/render';
import { mixSummaries, pageContent } from '../src/lib/agreement/page';
import { PARTS } from '../src/lib/agreement/parts';
import { docJsonFromSet, mixId } from '../src/lib/agreement/set';

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

// ---------------------------------------------------------------------------------------------
// A booking made before the simpler page: two full texts (variants), no set, no page content.
// The page asks doc with v=2 and gets this shape back: the fallback layout, nothing to tick.
// ---------------------------------------------------------------------------------------------
test.describe('a booking made before the simpler page', () => {
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
      const calls = await mockDoc(page, [[200, docPayload()]]);
      await page.goto(PATH);
      await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
      // The page always asks for the v=2 answer; a booking made before sets answers as it always did.
      expect(new URL(calls[0]).search).toBe(`?k=${TOKEN}&v=2`);
      await expect(page.locator('[data-agr-who]')).toHaveText('Priya and Arjun · Saturday 12 December 2026');
      await expect(page.locator('[data-agr-booking]')).toHaveText(`Booking ${NUMBER}`);
      await expect(page.locator('h1:visible')).toHaveText('Your agreement');
      await expect(page.locator('[data-agr-lede] p')).toHaveText(['Everything we agreed, in one place. Read it through, then sign at the end.']);
      await expect(page.locator('[data-agr-lede] p').first()).toBeVisible();
      for (const b of LABELS.intro_bullets) await expect(page.locator('[data-agr-bullets] li', { hasText: b })).toBeVisible();
      // The fallback layout: the 7 parts of parts.ts, every panel open, no disclosure, no points, nothing to tick.
      await expect(doc(page).locator('section.agr-sec')).toHaveCount(23);
      for (const s of await doc(page).locator('section.agr-sec').all()) await expect(s).toBeVisible();
      await expect(page.locator('[data-agr-disc]')).toHaveCount(0);
      await expect(page.locator('[data-agr-points]')).toHaveCount(0);
      await expect(page.locator('[data-agr-extra]')).toHaveCount(0);
      await expect(page.locator('[data-agr-toc] a')).toHaveText([...PARTS.map((p) => `${p.n} ${p.title}`), 'Sign your agreement']);
      expect(await page.locator('[data-agr-toc] a').evaluateAll((as) => as.map((a) => a.getAttribute('href')))).toEqual([
        ...PARTS.map((p) => `#part-${p.n}`),
        '#sign',
      ]);
      for (const part of PARTS) {
        await expect(page.locator(`[data-agr-part="${part.n}"] > h2`)).toHaveText(`${part.n} ${part.title}`);
        expect(await page.locator(`[data-agr-full="${part.n}"] section.agr-sec`).evaluateAll((els) => els.map((e) => e.id))).toEqual(
          part.sections.map((n) => `sec-${n}`),
        );
      }
      // Each section heading sits under its part's h2.
      await expect(page.locator('#sec-15 > h3')).toHaveText('15. Sharing your work, and your privacy');
      await expect(doc(page).locator('section.agr-sec h2')).toHaveCount(0);
      // The same frame as the PDF: the document title, then the intro as plain text, then the sections.
      const p1 = page.locator('[data-agr-full="1"]');
      await expect(p1.locator('> :nth-child(1)')).toHaveText(DOCS.share.title);
      await expect(p1.locator('> :nth-child(1)')).toHaveAttribute('data-agr-doc-title', '');
      await expect(p1.locator('> :nth-child(2)')).toHaveText(DOCS.share.intro);
      await expect(p1.locator('> :nth-child(2)')).toHaveAttribute('data-agr-doc-intro', '');
      await expect(p1.locator('> :nth-child(3)')).toHaveId('sec-0');
      await expect(page.locator('#sec-0 .agr-intro')).toHaveCount(0);
      await expect(page.locator('#sec-0')).toContainText('This agreement is dated 10 November 2026.');
      await expect(page.locator('[data-agr-full="7"] > :last-child')).toHaveAttribute('data-agr-business-signature', '');
      await expect(page.locator('[data-agr-business-signature]')).toHaveText(DOCS.share.business_signature);
      // At a glance and part 3 without page content: the stored amounts only.
      await expect(page.locator('[data-agr-glance] dt')).toHaveText(['Package', 'Date', 'Total']);
      await expect(page.locator('[data-agr-glance] dd')).toHaveText(['The Civil Ceremony', 'Saturday 12 December 2026', '$501.25']);
      await expect(page.locator('[data-agr-old-pay] dt')).toHaveText(['Total', 'Retainer', 'Balance']);
      await expect(page.locator('[data-agr-old-pay] dd')).toHaveText(['$501.25', '$251.00', '$250.25']);
      await expect(page.locator('[data-agr-total-line], [data-agr-price-lines], [data-agr-pay]')).toHaveCount(0);
      await expect(page.locator('[data-agr-ribbon]')).toBeVisible();
    });

    test('before a choice, section 15 shows both versions', async ({ page }) => {
      await mockDoc(page, [[200, docPayload()]]);
      await page.goto(PATH);
      const s15 = page.locator('#sec-15');
      await expect(s15.locator('[data-agr-variant="share"] > h4')).toHaveText('If you choose to share');
      await expect(s15.locator('[data-agr-variant="private"] > h4')).toHaveText('If you choose to keep it private');
      const firstClause = (c: Choice) => (DOCS[c].sections[15].items[0] as { text: string }).text;
      await expect(s15.locator('[data-agr-variant="share"]')).toContainText(firstClause('share'));
      await expect(s15.locator('[data-agr-variant="private"]')).toContainText(firstClause('private'));
      await expect(page.locator('#sec-1')).toContainText('You choose this in part 5.');
      await expect(page.locator('#sec-1')).not.toContainText('You allow sharing');
      await expect(page.locator('[data-agr-choice-status]')).toHaveText('');
      await expect(page.locator('[data-agr-choice]:checked')).toHaveCount(0);
      await expect(page.locator('[data-agr-agree]')).not.toBeChecked();
      await expect(page.locator('#sec-15')).toHaveCount(1);
      // The two totals are the same: no line says which total is shown.
      await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    });

    test('choosing private updates sections 1 and 15', async ({ page }) => {
      await mockDoc(page, [[200, docPayload()]]);
      await page.goto(PATH);
      await page.locator('[data-agr-choice="private"]').check();
      await expect(page.locator('#sec-1')).toContainText('Private. Your work is not shown in public.');
      await expect(page.locator('#sec-1')).not.toContainText('You choose this in part 5.');
      const s15 = page.locator('#sec-15');
      await expect(s15.locator('[data-agr-variant]')).toHaveCount(0);
      await expect(s15).toContainText((DOCS.private.sections[15].items[0] as { text: string }).text);
      await expect(s15).not.toContainText((DOCS.share.sections[15].items[1] as { text: string }).text);
      await expect(page.locator('[data-agr-choice-status]')).toHaveText('Parts 1 and 5 now show your choice.');
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
      // Nothing to tick on a booking made before sets: the body has no extras key.
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
      await expect(page.locator('[data-agr-deposit-row]')).toHaveCount(0);
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
        'Please type your name exactly as it is written here: Priya Sharma. Only Priya can sign. If that name is wrong, do not sign. Message me and I will fix it.',
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
      await expect(page.locator('[data-agr-choice], [data-agr-extra], [data-agr-disc]')).toHaveCount(0);
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

    test('without a PDF from the server each button prints and then shows what to do if nothing happened', async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { printed: number }).printed = 0;
        window.print = () => void ((window as unknown as { printed: number }).printed += 1);
      });
      const HINT = 'Nothing happened? Open this page in Safari or Chrome, then print it or save it as a PDF.';
      const printed = () => page.evaluate(() => (window as unknown as { printed: number }).printed);
      // The live Apps Script does not know agreement_pdf yet: the worker answers 502.
      await page.route('**/r/agreement/pdf**', (route) => reply(route, 502, { ok: false, error: 'pdf_unavailable' }));
      await mockDoc(page, [[200, docPayload()]]);
      await page.goto(PATH);
      const hint = page.locator('[data-agr-view="ready"] [data-agr-print-hint]');
      await expect(hint).toBeHidden();
      await expect(hint).toHaveAttribute('role', 'status');
      await page.getByRole('button', { name: 'Download a copy (PDF)' }).click();
      await expect.poll(printed).toBe(1);
      await expect(hint).toBeVisible();
      await expect(hint).toHaveText(HINT);
      await expect(page.getByRole('button', { name: 'Download a copy (PDF)' })).toBeEnabled();

      await page.unrouteAll();
      await page.route('**/r/agreement/pdf**', (route) => route.abort());
      await mockDoc(page, [[200, signedPayload('share', { copy: { status: 'sent', to: 'priya@example.com' } })]]);
      await page.goto(PATH);
      await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
      const signedHint = page.locator('[data-agr-view="signed"] [data-agr-print-hint]');
      await expect(signedHint).toBeHidden();
      await page.getByRole('button', { name: 'Download your signed copy (PDF)' }).click();
      await expect.poll(printed).toBe(1);
      await expect(signedHint).toBeVisible();
      await expect(signedHint).toHaveText(HINT);
      await expect(signedHint).toHaveAttribute('role', 'status');
    });

    test('a 200 answer that is not a PDF also falls back to printing', async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { printed: number }).printed = 0;
        window.print = () => void ((window as unknown as { printed: number }).printed += 1);
      });
      await page.route('**/r/agreement/pdf**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>hi</p>' }));
      await mockDoc(page, [[200, docPayload()]]);
      await page.goto(PATH);
      await page.getByRole('button', { name: 'Download a copy (PDF)' }).click();
      await expect.poll(() => page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
    });

    test('each button downloads the PDF the server made', async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { printed: number }).printed = 0;
        window.print = () => void ((window as unknown as { printed: number }).printed += 1);
      });
      const PDF = Buffer.from(`%PDF-1.4\n${'x'.repeat(1200)}\n%%EOF`, 'latin1');
      const SAVED = 'Your PDF is in your downloads. Nothing happened? Open this page in Safari or Chrome and try again.';
      const urls: string[] = [];
      let release: () => void = () => {};
      await page.route('**/r/agreement/pdf**', async (route) => {
        const url = new URL(route.request().url());
        urls.push(url.search);
        const signed = !url.searchParams.has('c');
        // While the PDF is being made, the button is busy and the line says so.
        if (urls.length === 1) await new Promise<void>((r) => (release = r));
        return route.fulfill({
          status: 200,
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': `attachment; filename="AD Photography agreement ${NUMBER}${signed ? '' : ' (not signed)'}.pdf"`,
          },
          body: PDF,
        });
      });
      await mockDoc(page, [[200, docPayload()]]);
      await page.goto(PATH);
      const button = page.getByRole('button', { name: 'Download a copy (PDF)' });
      const hint = page.locator('[data-agr-view="ready"] [data-agr-print-hint]');

      // Before a choice the copy is the share version.
      let download = page.waitForEvent('download');
      await button.click();
      await expect(hint).toHaveText('Preparing your PDF. This can take a few seconds.');
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('aria-busy', 'true');
      await expect.poll(() => urls.length).toBe(1);
      release();
      expect((await download).suggestedFilename()).toBe(`AD Photography agreement ${NUMBER} (not signed).pdf`);
      await expect(hint).toHaveText(SAVED);
      await expect(button).toBeEnabled();

      // After a choice, the copy is the version on screen.
      await page.locator('[data-agr-choice="private"]').check();
      download = page.waitForEvent('download');
      await button.click();
      await download;
      // Nothing to tick: exactly the queries of before, with no x.
      expect(urls).toEqual([`?k=${TOKEN}&c=share`, `?k=${TOKEN}&c=private`]);

      await mockDoc(page, [[200, signedPayload('share', { copy: { status: 'sent', to: 'priya@example.com' } })]]);
      await page.goto(PATH);
      await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
      download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download your signed copy (PDF)' }).click();
      expect((await download).suggestedFilename()).toBe(`AD Photography agreement ${NUMBER}.pdf`);
      await expect(page.locator('[data-agr-view="signed"] [data-agr-print-hint]')).toHaveText(SAVED);
      expect(urls[2]).toBe(`?k=${TOKEN}`);
      expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(0);
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
      await page.locator('[data-agr-choice="private"]').check();
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
      await expect(page.locator('[data-agr-sign-title]')).toBeFocused();
      await expect(page.locator('[data-agr-name]')).toHaveValue('Priya Sharma');
      await expect(page.locator('[data-agr-choice="private"]')).toBeChecked();
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
      for (const sel of ['[data-agr-doc]', '[data-agr-toc]', '[data-agr-glance]', '[data-agr-lede]', '[data-agr-recap]'])
        await expect(page.locator(`${sel} > *`), sel).toHaveCount(0);

      await page.getByRole('button', { name: 'Try again' }).click();
      await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
      await expect(doc(page).locator('section.agr-sec')).toHaveCount(23);
      await expect(page.locator('[data-agr-full="7"] #sec-22')).toBeVisible();
      // The sign block is its own card after the parts, never inside them.
      await expect(page.locator('[data-agr-doc] + #sign[data-agr-signbox]')).toBeVisible();
      await expect(doc(page).locator('[data-agr-signbox]')).toHaveCount(0);
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

  // A wedding paid in three parts: the second and the final payment take the place of the balance. Invented people only.
  test.describe('Private agreement page, a wedding paid in three parts', () => {
    let pageErrors: string[] = [];
    test.beforeEach(({ page }) => {
      pageErrors = [];
      page.on('pageerror', (e) => pageErrors.push(e.message));
    });
    test.afterEach(() => {
      expect(pageErrors).toEqual([]);
    });

    const W_NUMBER = 'KK-TEST-2026-007';
    const wFacts = buildBookingFacts(
      {
        package_id: 'wedding-full',
        client_name: 'Elena Marchetti',
        partner_name: 'Daniel Okafor',
        client_email: 'elena@example.com',
        client_phone: '416 555 0177',
        event_date: '2027-05-29',
        start_time: '12:00',
        end_time: '22:00',
        place: 'St. Example Church, Hamilton. Reception in Burlington',
        add_ons: [{ id: 'second-photographer', qty: 7 }],
      },
      { number: W_NUMBER, createdAt: new Date('2026-11-10T15:00:00Z') },
    );
    const wVariant = (c: Choice) => {
      const doc_json = JSON.stringify(renderVariant(wFacts, c));
      return { doc_json, hash: sha256(doc_json) };
    };
    const W_VARIANTS = { share: wVariant('share'), private: wVariant('private') };
    const W_LABELS = { ...signLabels(wFacts), name_expected: wFacts.client_name };
    const summaryOf = (f: typeof wFacts) => ({
      package: f.package_name,
      date: longDate(f.event_date),
      total: money(f.total),
      retainer: money(f.retainer),
      balance: money(f.balance),
      balance_how: 'e-transfer or cash',
      etransfer_email: 'info@kashklicks.ca',
      later_payments: laterPaymentRows(f),
    });
    const W_SUMMARY = summaryOf(wFacts);
    const W_SUMMARY_PRIVATE = summaryOf(factsFor(wFacts, 'private'));
    const SECOND =
      '$753.00 by e-transfer. Due 7 days after I deliver your engagement session gallery. If you have not had your engagement session by Tuesday 30 March 2027, it is due on that date.';
    const FINAL = '$752.00 by e-transfer. Due by Saturday 15 May 2027, which is 14 days before your wedding.';
    const base = {
      ok: true,
      mode: 'test',
      number: W_NUMBER,
      client_first: 'Elena',
      partner_first: 'Daniel',
      client_name: 'Elena Marchetti',
      partner_name: 'Daniel Okafor',
      labels: W_LABELS,
      summary: W_SUMMARY,
    };
    const wReady = { ...base, status: 'opened', today: '10 November 2026', variants: W_VARIANTS, summary_private: W_SUMMARY_PRIVATE };
    const wSigned = (choice: Choice) => {
      const final_doc_json = fillSignDate(W_VARIANTS[choice].doc_json, '10 November 2026');
      return {
        ...base,
        status: 'signed',
        signed: { choice, signed_name: 'Elena Marchetti', date: '10 November 2026', time: '10:00 am', final_doc_json, final_hash: sha256(final_doc_json) },
        copy: { status: 'sent', to: 'elena@example.com' },
      };
    };

    test('the review step lists the second and the final payment after the retainer', async ({ page }) => {
      await mockDoc(page, [[200, wReady]]);
      await page.goto(PATH);
      await fillReady(page, 'share', 'Elena Marchetti');
      await page.locator('[data-agr-review]').click();
      const rows = page.locator('[data-agr-review-rows] > div');
      await expect(rows.locator('dt')).toHaveText(['Your name', 'Your partner', 'Package', 'Date', 'Total', 'Retainer', 'Second payment', 'Final payment', 'Sharing']);
      await expect(rows.nth(6).locator('dd')).toHaveText(SECOND);
      await expect(rows.nth(7).locator('dd')).toHaveText(FINAL);
      await expect(page.locator('[data-agr-dialog]')).not.toContainText(/balance/i);
    });

    test('the review step shows the amounts of the chosen option', async ({ page }) => {
      await mockDoc(page, [[200, wReady]]);
      await page.goto(PATH);
      // Before a choice, section 1 shows both versions, and no row says the price stays the same.
      await expect(page.locator('#sec-1 [data-agr-variant="private"]')).toContainText('Marketing fee for private work');
      await expect(doc(page)).not.toContainText('It does not change your price');
      // Part 3 without page content: the later payments of the share choice, never a balance.
      await expect(page.locator('[data-agr-old-pay] dt')).toHaveText(['Total', 'Retainer', 'Second payment', 'Final payment']);
      await expect(page.locator('[data-agr-old-pay] dd')).toHaveText(['$3,010.00', '$1,505.00', SECOND, FINAL]);
      const dd = (label: string) => page.locator('[data-agr-review-rows] > div', { has: page.locator('dt', { hasText: new RegExp(`^${label}$`) }) }).locator('dd');
      for (const [choice, total, retainer, second] of [
        ['private', '$3,085.00', '$1,543.00', '$772.00'],
        ['share', '$3,010.00', '$1,505.00', '$753.00'],
      ] as const) {
        await page.locator(`[data-agr-choice="${choice}"]`).check();
        if (choice === 'private') {
          await page.locator('[data-agr-name]').fill('Elena Marchetti');
          await page.locator('[data-agr-agree]').check();
        }
        await expect(page.locator('[data-agr-glance-total]'), choice).toHaveText(total);
        await expect(page.locator('[data-agr-recap-row="total"] dd'), choice).toHaveText(total);
        await page.locator('[data-agr-review]').click();
        await expect(dd('Total'), choice).toHaveText(total);
        await expect(dd('Retainer'), choice).toHaveText(retainer);
        await expect(dd('Second payment'), choice).toContainText(second);
        await page.locator('[data-agr-back]').click();
        await expect(page.locator('[data-agr-dialog]')).toBeHidden();
      }
    });

    test('the signed view shows the two later payments instead of the balance', async ({ page }) => {
      await mockDoc(page, [[200, wSigned('share')]]);
      await page.goto(PATH);
      await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
      await expect(page.locator('[data-agr-retainer]')).toHaveText('$1,505.00');
      await expect(page.locator('[data-agr-balance-row]')).toBeHidden();
      const card = page.locator('.agr-steps .agr-card').first();
      await expect(card.locator('dl > div:visible dt')).toHaveText(['Send an e-transfer to', 'Message or reference', 'Second payment', 'Final payment']);
      await expect(card.locator('[data-agr-later-row] dd')).toHaveText([SECOND, FINAL]);
      // innerText leaves out the hidden balance row; textContent would not.
      expect(await card.innerText()).not.toMatch(/balance/i);
      await expect(page.locator('[data-agr-step2-title]')).toHaveText('Step 2 · Your engagement session');
      await expect(page.locator('[data-agr-signed-doc] #sec-1')).toContainText('Final payment');
    });

    test('a civil booking still shows its balance line and no later payment rows', async ({ page }) => {
      await mockDoc(page, [[200, signedPayload('share')]]);
      await page.goto(PATH);
      await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
      await expect(page.locator('[data-agr-balance-row]')).toBeVisible();
      await expect(page.locator('[data-agr-balance]')).toHaveText('$250.25, e-transfer or cash');
      await expect(page.locator('[data-agr-later-row]')).toHaveCount(0);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// A booking made with the simpler page: the v=2 answer with the set (every mix: index list, hash,
// summary) and the page content, made by the real engine as POST /r/agreement/new makes them.
// ---------------------------------------------------------------------------------------------
interface V2Mix {
  f: number[];
  hash: string;
  summary: StoredSummary;
}
/** A booking with a set, as GET /r/agreement/doc?v=2 answers it (src/worker/agreement.ts readDoc), plus its signed answers. */
function v2Booking(f: BookingFacts, who: { client_first: string; partner_first: string; email: string }) {
  const built = buildVariantSet(f);
  const summaries = mixSummaries(f, built.mixes);
  const mixes: Record<string, V2Mix> = {};
  const docs: Record<string, string> = {};
  built.mixes.forEach((m, i) => {
    const doc_json = docJsonFromSet(built.pool, m.f);
    docs[m.id] = doc_json;
    mixes[m.id] = { f: m.f, hash: sha256(doc_json), summary: summaries[i] };
  });
  // null when page.json has no text for the package: the answer then has a set and no page.
  const content = pageContent(f);
  const page = content as PageContent;
  const labels = { ...signLabels(f), name_expected: f.client_name };
  const base = {
    ok: true,
    mode: 'test',
    number: f.number,
    client_first: who.client_first,
    partner_first: who.partner_first,
    client_name: f.client_name,
    partner_name: f.partner_name,
    labels,
  };
  const ready = {
    ...base,
    status: 'opened',
    today: '10 November 2026',
    summary: mixes.share.summary,
    ...(f.private_fee === undefined ? {} : { summary_private: mixes.private.summary }),
    set: { pool: built.pool, mixes },
    ...(content === null ? {} : { page: content }),
  };
  const signed = (choice: Choice, extras: string[] = [], over: Record<string, unknown> = {}) => {
    const id = mixId(choice, extras);
    const final_doc_json = fillSignDate(docs[id], '10 November 2026');
    return {
      ...base,
      status: 'signed',
      signed: { choice, signed_name: f.client_name, date: '10 November 2026', time: '10:00 am', final_doc_json, final_hash: sha256(final_doc_json) },
      extras,
      summary: mixes[id].summary,
      copy: { status: 'sent', to: who.email },
      ...over,
    };
  };
  /** Numbered clauses per part of a mix's document, as the disclosure buttons count them. */
  const counts = (id: string) => {
    const d = JSON.parse(docs[id]) as AgreementDoc;
    return (content?.parts ?? PARTS).map((p) =>
      p.sections.reduce((n, num) => n + d.sections.find((s) => s.num === num)!.items.filter((it) => it.type === 'clause' && it.n !== '').length, 0),
    );
  };
  return { facts: f, mixes, docs, page, labels, ready, signed, counts };
}

/**
 * The same booking made while page.json has no text for its package (the engine reads page.json live,
 * so the entry is taken out for this one call and put back): a set with every mix, summaries of today
 * (no total line, no price lines, no steps), and no page content.
 */
function withoutPageText<T>(packageId: string, make: () => T): T {
  const packages = (pageJson as unknown as { packages: Record<string, unknown> }).packages;
  const saved = packages[packageId];
  delete packages[packageId];
  try {
    return make();
  } finally {
    packages[packageId] = saved;
  }
}

const W2 = v2Booking(
  buildBookingFacts(
    {
      package_id: 'wedding-full',
      client_name: 'Elena Marchetti',
      partner_name: 'Daniel Okafor',
      client_email: 'elena@example.com',
      client_phone: '416 555 0177',
      event_date: '2027-05-29',
      start_time: '12:00',
      end_time: '22:00',
      place: 'St. Example Church, Hamilton. Reception in Burlington',
      add_ons: [{ id: 'second-photographer', qty: 7 }],
    },
    { number: 'KK-TEST-2026-007', createdAt: new Date('2026-11-10T15:00:00Z') },
  ),
  { client_first: 'Elena', partner_first: 'Daniel', email: 'elena@example.com' },
);
const PRIYA = { client_first: 'Priya', partner_first: 'Arjun', email: 'priya@example.com' };
const C2 = v2Booking(facts, PRIYA);
// A set and no page content: the civil ceremony (two payments) and the wedding (three payments, a fee for private work).
const C3 = withoutPageText('civil-ceremony', () => v2Booking(facts, PRIYA));
const W3 = withoutPageText('wedding-full', () => v2Booking(W2.facts, { client_first: 'Elena', partner_first: 'Daniel', email: 'elena@example.com' }));
// The civil ceremony with a set retainer and the balance in cash only.
const CASH = v2Booking(
  buildBookingFacts({ ...PILOT, retainer: 51.25, balance_cash: true }, { number: NUMBER, createdAt: new Date('2026-11-10T15:00:00Z') }),
  PRIYA,
);
const RAW = 'raw-photos-wedding';
const INSTAX = 'instax-guest-prints';
const CAMERA = 'guest-camera';
const CHOICE_LIST: Choice[] = ['share', 'private'];
// A wedding with RAW photos booked when the link was made: two tick boxes left (8 mixes), one booked line.
const W_RAW = v2Booking(
  buildBookingFacts(
    {
      package_id: 'wedding-full',
      client_name: 'Elena Marchetti',
      partner_name: 'Daniel Okafor',
      client_email: 'elena@example.com',
      client_phone: '416 555 0177',
      event_date: '2027-08-14',
      start_time: '11:00',
      end_time: '21:00',
      place: 'Example Hall, 100 Example Street, Toronto',
      add_ons: [{ id: RAW, qty: 1 }],
    },
    { number: 'KK-TEST-2026-011', createdAt: new Date('2026-11-10T15:00:00Z') },
  ),
  { client_first: 'Elena', partner_first: 'Daniel', email: 'elena@example.com' },
);
// A civil ceremony with all three extras booked when the link was made: page content, nothing left to tick (2 mixes).
const C_ALL = v2Booking(
  buildBookingFacts(
    { ...PILOT, add_ons: [{ id: 'drone', qty: 1 }, { id: 'extra-retouched', qty: 1 }, { id: 'raw-photos-civil', qty: 1 }] },
    { number: NUMBER, createdAt: new Date('2026-11-10T15:00:00Z') },
  ),
  PRIYA,
);
// The sharing card titles (the stored option label up to its first full stop, without it), as the recap shows them.
const SHARE_TITLE = 'Share our work';
const PRIVATE_TITLE = 'Keep our work private';
const titleOf = (c: Choice) => (c === 'share' ? SHARE_TITLE : PRIVATE_TITLE);
const PDF = Buffer.from(`%PDF-1.4\n${'x'.repeat(1200)}\n%%EOF`, 'latin1');
const discLabel = (c: number) => `Read the full wording (${c} ${c === 1 ? 'point' : 'points'})`;
type Booking = ReturnType<typeof v2Booking>;
const tickIds = (b: Booking) => b.page.extras.ticks.map((t) => t.id);
/** Every subset of the ids, in tick box order (none, 1st, 2nd, 1st+2nd, ...). */
const subsetsOf = (ids: string[]): string[][] =>
  Array.from({ length: 1 << ids.length }, (_, mask) => ids.filter((_, i) => (mask & (1 << i)) !== 0));
/** The clause lines of one section as they read on screen: number, a space, the text (no ** marks). */
const clauseLines = (doc_json: string, num: number) =>
  (JSON.parse(doc_json) as AgreementDoc).sections
    .find((s) => s.num === num)!
    .items.filter((it) => it.type === 'clause')
    .map((c) => `${(c as { n: string }).n} ${(c as { text: string }).text}`.replace(/\*\*/g, '').trim());
/** The rows of the booking table (section 1) of a mix's text. */
const bookingRows = (doc_json: string) =>
  ((JSON.parse(doc_json) as AgreementDoc).sections[1].items.find((it) => it.type === 'table') as { rows: string[][] }).rows;

/** Ticks exactly these boxes (and unticks the others), one press per box that changes. */
async function setTicks(page: Page, b: Booking, ids: string[]) {
  for (const id of tickIds(b)) await page.locator(`[data-agr-extra="${id}"]`).setChecked(ids.includes(id));
}

/**
 * After a sharing choice: every section on screen is, node for node, the html.ts output of that mix's own
 * stored text with its one h2 made an h3 (spec 4.1). Any section from another mix, or changed, fails.
 */
async function expectShownText(page: Page, doc_json: string, label = '') {
  const d = JSON.parse(doc_json) as AgreementDoc;
  const want = d.sections.map((s) => [s.num, sectionToHtml(s, { signDateText: '10 November 2026' }).replace('<h2>', '<h3>').replace('</h2>', '</h3>')]);
  const off = await page.evaluate(
    (list) =>
      list
        .filter(([num, html]) => {
          const t = document.createElement('template');
          t.innerHTML = String(html);
          const shown = document.querySelectorAll(`#sec-${num}`);
          return shown.length !== 1 || !shown[0].isEqualNode(t.content.firstElementChild);
        })
        .map(([num]) => num),
    want,
  );
  expect(off, `sections that are not the stored text ${label}`).toEqual([]);
}

/** The top of an element once the page has stopped scrolling (smooth scrolling takes a few hundred ms). */
async function settledTop(loc: Locator): Promise<number> {
  let last = Number.NaN;
  await expect
    .poll(
      async () => {
        const top = await loc.evaluate((e) => e.getBoundingClientRect().top);
        const still = Math.abs(top - last) < 0.5;
        last = top;
        return still;
      },
      { intervals: [150], timeout: 5000 },
    )
    .toBe(true);
  return last;
}

test.describe('a booking made with the simpler page', () => {
  // Not queued behind the first group in one browser. With both groups in one WebKit browser (about 64
  // contexts), the next page.goto never sends its request and the context cannot close (seen 2026-11-23
  // on macOS, webkit-2272; each group alone, even run twice over in one worker, never stalls). These
  // tests share no state (each has its own page and routes), so they may spread over the workers.
  test.describe.configure({ mode: 'parallel' });
  let pageErrors: string[] = [];
  test.beforeEach(({ page }) => {
    pageErrors = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
  });
  test.afterEach(() => {
    expect(pageErrors).toEqual([]);
  });

  /** Every hook that follows the selection equals the stored summary of that mix. */
  async function expectMix(page: Page, b: ReturnType<typeof v2Booking>, id: string, sharing: string) {
    const s = b.mixes[id].summary;
    await expect(page.locator('[data-agr-glance-total]'), id).toHaveText(s.total);
    await expect(page.locator('[data-agr-total-line]'), id).toHaveText(s.total_line!);
    await expect(page.locator('[data-agr-price-lines] dt'), id).toHaveText(s.price_lines!.map((l) => l.label));
    await expect(page.locator('[data-agr-price-lines] dd'), id).toHaveText(s.price_lines!.map((l) => l.amount));
    const steps = page.locator('[data-agr-pay] > li');
    await expect(steps, id).toHaveCount(s.steps!.length);
    for (const [i, st] of s.steps!.entries()) await expect(steps.nth(i).locator('> span'), id).toHaveText([String(i + 1), st.title, st.amount, st.note]);
    if (s.deposit) {
      await expect(page.locator('[data-agr-deposit-line]'), id).toHaveText(`${s.deposit.label}: ${s.deposit.amount}. ${s.deposit.note}`);
      await expect(page.locator('[data-agr-recap-row="deposit"] dt'), id).toHaveText(s.deposit.label);
      await expect(page.locator('[data-agr-recap-row="deposit"] dd'), id).toHaveText(`${s.deposit.amount}. ${s.deposit.note}`);
    } else await expect(page.locator('[data-agr-deposit-line], [data-agr-recap-row="deposit"]'), id).toHaveCount(0);
    await expect(page.locator('[data-agr-recap] > div > dt'), id).toHaveText([
      'Extras',
      'Sharing',
      'Total',
      'Due today, the retainer',
      ...(s.deposit ? [s.deposit.label] : []),
    ]);
    await expect(page.locator('[data-agr-recap-row="extras"] dd'), id).toHaveText(s.extra_labels?.length ? s.extra_labels.join(', ') : 'None');
    await expect(page.locator('[data-agr-recap-row="sharing"] dd'), id).toHaveText(sharing);
    await expect(page.locator('[data-agr-recap-row="total"] dd'), id).toHaveText(s.total);
    await expect(page.locator('[data-agr-recap-row="due"] dd'), id).toHaveText(s.retainer);
  }

  test('main points per part, and the note under part 1 only', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('h1:visible')).toHaveText(W2.page.title);
    await expect(page.locator('[data-agr-lede] p')).toHaveText(W2.page.lede);
    await expect(page.locator('[data-agr-glance] dt')).toHaveText([...W2.page.glance.map((g) => g.label), 'Total']);
    await expect(page.locator('[data-agr-glance] dd')).toHaveText([...W2.page.glance.map((g) => g.value), W2.mixes.share.summary.total]);
    for (const part of W2.page.parts) {
      const points = page.locator(`[data-agr-part="${part.n}"] [data-agr-points="${part.n}"] > li`);
      if (part.points.length) await expect(points, `part ${part.n}`).toHaveText(part.points);
      else await expect(page.locator(`[data-agr-points="${part.n}"]`), `part ${part.n}`).toHaveCount(0);
    }
    expect(W2.page.parts.find((p) => p.n === 4)!.points).toEqual([]);
    await expect(page.locator('[data-agr-note]')).toHaveCount(1);
    await expect(page.locator('[data-agr-part="1"] [data-agr-note]')).toHaveText(W2.page.note);
    // Inside a point the words "part N" link to that part; nothing else in the points is linked.
    const expected = W2.page.parts.flatMap((p) => p.points.flatMap((t) => [...t.matchAll(/\bpart ([1-7])\b/g)].map((m) => [`#part-${m[1]}`, m[0]])));
    expect(expected.length).toBeGreaterThan(0);
    expect(await page.locator('[data-agr-points] a').evaluateAll((as) => as.map((a) => [a.getAttribute('href'), a.textContent]))).toEqual(expected);
    // The extras block of part 4 and the sharing points of part 5, as stored.
    await expect(page.locator('[data-agr-extras-intro]')).toHaveText(W2.page.extras.intro);
    await expect(page.locator('[data-agr-extra]')).toHaveCount(3);
    await expect(page.locator('[data-agr-more] > li')).toHaveText(W2.page.extras.more);
    await expect(page.locator('#agr-sharing > legend')).toHaveText(W2.page.sharing.legend);
    await expect(page.locator('#agr-sharing-points > li')).toHaveText(W2.page.sharing.points);
    // No placeholder ever reaches the screen.
    expect(await page.locator('[data-agr-view="ready"]').textContent()).not.toMatch(/\{\{|\}\}|\[[A-Z_]+\]/);
    // The visible text with one panel open: no en dash, no em dash, no placeholder. The closed panels too.
    await page.locator('[data-agr-disc="1"]').click();
    await expect(page.locator('[data-agr-full="1"]')).toBeVisible();
    const visible = await page.locator('[data-agr-view="ready"]').innerText();
    expect(visible).toContain(W2.page.parts[0].points[0]);
    expect(visible).toContain(clauseLines(W2.docs.share, 0)[0].slice(0, 40));
    expect(visible).not.toMatch(/[–—]/);
    expect(visible).not.toMatch(/\{\{|\}\}|\[[A-Z_]+\]/);
    expect(await page.locator('[data-agr-view="ready"]').textContent()).not.toMatch(/[–—]/);
    // The civil ceremony too.
    await page.unrouteAll();
    await mockDoc(page, [[200, C2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    for (const part of C2.page.parts)
      if (part.points.length) await expect(page.locator(`[data-agr-points="${part.n}"] > li`), `civil part ${part.n}`).toHaveText(part.points);
    await expect(page.locator('[data-agr-note]')).toHaveCount(1);
    await page.locator('[data-agr-disc="1"]').click();
    const civil = await page.locator('[data-agr-view="ready"]').innerText();
    expect(civil).not.toMatch(/[–—]/);
    expect(await page.locator('[data-agr-view="ready"]').textContent()).not.toMatch(/\{\{|\}\}|\[[A-Z_]+\]|[–—]/);
  });

  test('the seven disclosure buttons start closed, count the points of the shown text, and open one by one', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    const discs = page.locator('[data-agr-disc]');
    await expect(discs).toHaveCount(7);
    const label = (c: number) => `Read the full wording (${c} ${c === 1 ? 'point' : 'points'})`;
    // Before a sharing choice, the counts of the share text with nothing ticked.
    const share = W2.counts('share');
    expect(share).toEqual([49, 27, 9, 6, 23, 37, 12]);
    await expect(discs).toHaveText(share.map(label));
    for (let n = 1; n <= 7; n += 1) {
      const b = page.locator(`[data-agr-disc="${n}"]`);
      await expect(b).toHaveAttribute('type', 'button');
      await expect(b).toHaveAttribute('aria-expanded', 'false');
      await expect(b).toHaveAttribute('aria-controls', `agr-full-${n}`);
      await expect(b).toHaveAttribute('aria-describedby', `agr-part-${n}-title`);
      const panel = page.locator(`#agr-full-${n}`);
      await expect(panel).toBeHidden();
      await expect(panel).not.toHaveAttribute('hidden');
    }
    const open = async (n: number, on: boolean) => {
      await expect(page.locator(`[data-agr-disc="${n}"]`)).toHaveAttribute('aria-expanded', String(on));
      await expect(page.locator(`[data-agr-full="${n}"]`)).toBeVisible({ visible: on });
    };
    await page.locator('[data-agr-disc="2"]').click();
    await open(2, true);
    await expect(page.locator('[data-agr-disc="2"]')).toHaveText('Hide the full wording');
    for (const n of [1, 3, 4, 5, 6, 7]) await open(n, false);
    await page.locator('[data-agr-disc="6"]').click();
    await open(2, true);
    await open(6, true);
    await page.locator('[data-agr-disc="2"]').click();
    await open(2, false);
    await open(6, true);
    await expect(page.locator('[data-agr-disc="2"]')).toHaveText(label(share[1]));
    // The part 1 panel opens with the title and the intro of the shown text, each once, then section 0.
    await page.locator('[data-agr-disc="1"]').click();
    const p1 = page.locator('[data-agr-full="1"]');
    const shareDoc = JSON.parse(W2.docs.share) as AgreementDoc;
    await expect(p1.locator('> :nth-child(1)')).toHaveText(shareDoc.title);
    await expect(p1.locator('> :nth-child(1)')).toHaveAttribute('data-agr-doc-title', '');
    await expect(p1.locator('> :nth-child(2)')).toHaveText(shareDoc.intro);
    await expect(p1.locator('> :nth-child(2)')).toHaveAttribute('data-agr-doc-intro', '');
    await expect(p1.locator('> :nth-child(3)')).toHaveId('sec-0');
    await expect(page.locator('[data-agr-doc-title], [data-agr-doc-intro]')).toHaveCount(2);
    const p1Text = await p1.innerText();
    expect(p1Text.split(shareDoc.title).length - 1).toBe(1);
    expect(p1Text.split(shareDoc.intro).length - 1).toBe(1);
    // The part 5 count follows the sharing choice.
    await page.locator('[data-agr-choice="private"]').check();
    const priv = W2.counts('private');
    expect(priv[4]).not.toBe(share[4]);
    await expect(page.locator('[data-agr-disc="5"]')).toHaveText(label(priv[4]));
    await expect(page.locator('[data-agr-disc="6"]')).toHaveText('Hide the full wording');
    await expect(page.locator('[data-agr-disc="1"]')).toHaveText('Hide the full wording');
    await expect(discs).toHaveText(['Hide the full wording', label(priv[1]), label(priv[2]), label(priv[3]), label(priv[4]), 'Hide the full wording', label(priv[6])]);
    // After the choice an opened panel shows the chosen text word for word.
    await page.locator('[data-agr-disc="5"]').click();
    await expect(page.locator('[data-agr-full="5"]')).toBeVisible();
    await expect(page.locator('#sec-15 [data-agr-variant]')).toHaveCount(0);
    const shown = await page.locator('#sec-15 p.agr-clause').allInnerTexts();
    expect(shown.map((t) => t.replace(/\s+/g, ' ').trim())).toEqual(clauseLines(W2.docs.private, 15));
    await expectShownText(page, W2.docs.private);
    await expect(p1.locator('> :nth-child(1)')).toHaveText(shareDoc.title);
  });

  test('ticking extras and choosing sharing change every amount to the stored values of that mix', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expectMix(page, W2, 'share', 'Not chosen yet');
    await expect(page.locator('[data-agr-extra-status]')).toHaveText('');
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await expectMix(page, W2, mixId('share', [RAW]), 'Not chosen yet');
    await expect(page.locator('[data-agr-extra-status]')).toHaveText(`Total: ${W2.mixes[mixId('share', [RAW])].summary.total}.`);
    await page.locator(`[data-agr-extra="${INSTAX}"]`).check();
    await expectMix(page, W2, mixId('share', [RAW, INSTAX]), 'Not chosen yet');
    await page.locator('[data-agr-choice="private"]').check();
    await expectMix(page, W2, mixId('private', [RAW, INSTAX]), 'Keep our work private');
    await expect(page.locator('[data-agr-choice-status]')).toHaveText(
      `Parts 1, 3 and 5 now show your choice. Total: ${W2.mixes[mixId('private', [RAW, INSTAX])].summary.total}.`,
    );
    await page.locator(`[data-agr-extra="${RAW}"]`).uncheck();
    await expectMix(page, W2, mixId('private', [INSTAX]), 'Keep our work private');
    // The guest camera is a deposit: no total changes, the deposit shows.
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    const cam = W2.mixes[mixId('private', [INSTAX, CAMERA])].summary;
    expect(cam.total).toBe(W2.mixes[mixId('private', [INSTAX])].summary.total);
    await expectMix(page, W2, mixId('private', [INSTAX, CAMERA]), 'Keep our work private');
    await expect(page.locator('[data-agr-extra-status]')).toHaveText(`Total: ${cam.total}. ${cam.deposit!.label}: ${cam.deposit!.amount}.`);
    await page.locator('[data-agr-choice="share"]').check();
    await expectMix(page, W2, mixId('share', [INSTAX, CAMERA]), 'Share our work');
    // The section 1 table of the shown mix carries its total.
    await expect(page.locator('#sec-1')).toContainText(W2.mixes[mixId('share', [INSTAX, CAMERA])].summary.total);
    await page.locator(`[data-agr-extra="${INSTAX}"]`).uncheck();
    await page.locator(`[data-agr-extra="${CAMERA}"]`).uncheck();
    await expectMix(page, W2, 'share', 'Share our work');
  });

  test('before a choice the total line says it is the share total, in three places; the civil booking never shows it', async ({ page }) => {
    const LINE = 'This is your total if you share your photos. You choose in part 5.';
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    expect(W2.mixes.share.summary.total).not.toBe(W2.mixes.private.summary.total);
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(3);
    await expect(page.locator('[data-agr-total-undecided]')).toHaveText([LINE, LINE, LINE]);
    await expect(page.locator('[data-agr-glance] + [data-agr-total-undecided]')).toBeVisible();
    await expect(page.locator('[data-agr-total-line] + [data-agr-total-undecided]')).toBeVisible();
    await expect(page.locator('[data-agr-recap-row="total"] [data-agr-total-undecided]')).toBeVisible();
    // Before the choice every amount is the share mix's, and section 1 shows both versions.
    await expectMix(page, W2, 'share', 'Not chosen yet');
    await expect(page.locator('#sec-1 [data-agr-variant="share"] > h4')).toHaveText('If you choose to share');
    await expect(page.locator('#sec-1 [data-agr-variant="private"] > h4')).toHaveText('If you choose to keep it private');
    // Ticking keeps it (still no choice); choosing removes all three.
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(3);
    await expectMix(page, W2, mixId('share', [RAW]), 'Not chosen yet');
    await page.locator('[data-agr-choice="private"]').check();
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    await expectMix(page, W2, mixId('private', [RAW]), PRIVATE_TITLE);
    await expect(page.locator('#sec-1 [data-agr-variant]')).toHaveCount(0);
    await page.locator('[data-agr-choice="share"]').check();
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    await expectMix(page, W2, mixId('share', [RAW]), SHARE_TITLE);

    await page.unrouteAll();
    await mockDoc(page, [[200, C2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-extra]')).toHaveCount(3);
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    await page.locator('[data-agr-extra="drone"]').check();
    await expectMix(page, C2, mixId('share', ['drone']), 'Not chosen yet');
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    await page.locator('[data-agr-choice="private"]').check();
    await expect(page.locator('[data-agr-choice-status]')).toHaveText('Parts 1 and 5 now show your choice.');
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    await expectMix(page, C2, mixId('private', ['drone']), PRIVATE_TITLE);
  });

  test('signing posts the ticked extras and the hash of that mix', async ({ page }) => {
    // The stored hash of the signed mix is one the text can never have: with crypto on, the page must send
    // the hash it works out from the text it holds, not the stored value (the other way round: the test
    // "without crypto.subtle ..." below).
    const id = mixId('private', [RAW, CAMERA]);
    const answer = JSON.parse(JSON.stringify(W2.ready)) as typeof W2.ready;
    answer.set.mixes[id].hash = 'f'.repeat(64);
    await mockDoc(page, [[200, answer]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, W2.signed('private', [RAW, CAMERA]));
    });
    await page.goto(PATH);
    // Ticked out of order: the page sends the ids in tick box order.
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await fillReady(page, 'private', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    const s = W2.mixes[id].summary;
    const rows = page.locator('[data-agr-review-rows] > div');
    await expect(rows.locator('dt')).toHaveText([
      'Your name',
      'Your partner',
      'Package',
      'Date',
      'Extras',
      'Total',
      'Retainer',
      'Second payment',
      'Final payment',
      s.deposit!.label,
      'Sharing',
    ]);
    await expect(rows.locator('dd')).toHaveText([
      'Elena Marchetti',
      'Daniel Okafor',
      s.package,
      s.date,
      s.extra_labels!.join(', '),
      s.total,
      s.retainer,
      s.later_payments![0].text,
      s.later_payments![1].text,
      `${s.deposit!.amount}. ${s.deposit!.note}`,
      W2.labels.private_option,
    ]);
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({
      k: TOKEN,
      choice: 'private',
      signed_name: 'Elena Marchetti',
      agree: true,
      text_hash: sha256(W2.docs[id]),
      extras: [RAW, CAMERA],
    });
    expect(body.text_hash).toBe(W2.mixes[id].hash);
    // The signed view adds the deposit row after the later payments.
    const card = page.locator('.agr-steps .agr-card').first();
    await expect(card.locator('dl > div:visible dt')).toHaveText(['Send an e-transfer to', 'Message or reference', 'Second payment', 'Final payment', s.deposit!.label]);
    await expect(page.locator('[data-agr-deposit-row] dd')).toHaveText(`${s.deposit!.amount}. ${s.deposit!.note}`);
  });

  test('the PDF copy is the mix on screen, with the ticked extras in x', async ({ page }) => {
    const PDF = Buffer.from(`%PDF-1.4\n${'x'.repeat(1200)}\n%%EOF`, 'latin1');
    const urls: string[] = [];
    await page.route('**/r/agreement/pdf**', (route) => {
      urls.push(new URL(route.request().url()).search);
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf' }, body: PDF });
    });
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    const button = page.getByRole('button', { name: 'Download a copy (PDF)' });
    const download = async () => {
      const d = page.waitForEvent('download');
      await button.click();
      await d;
    };
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await download();
    await page.locator('[data-agr-choice="private"]').check();
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await download();
    await page.locator(`[data-agr-extra="${RAW}"]`).uncheck();
    await page.locator(`[data-agr-extra="${CAMERA}"]`).uncheck();
    await download();
    expect(urls).toEqual([`?k=${TOKEN}&c=share&x=${RAW}`, `?k=${TOKEN}&c=private&x=${RAW},${CAMERA}`, `?k=${TOKEN}&c=private`]);
  });

  test('every one of the 16 wedding mixes shows its stored amounts, its own section 1 and its own counts', async ({ page }) => {
    test.setTimeout(120_000);
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const seen: string[] = [];
    for (const choice of CHOICE_LIST) {
      await page.locator(`[data-agr-choice="${choice}"]`).check();
      for (const ticked of subsetsOf(tickIds(W2))) {
        await setTicks(page, W2, ticked);
        const id = mixId(choice, ticked);
        seen.push(id);
        await expectMix(page, W2, id, titleOf(choice));
        // The section 1 table on screen is the engine's table of this mix, row for row.
        expect(
          await page.locator('#sec-1 table.agr-table tr').evaluateAll((trs) => trs.map((tr) => Array.from((tr as HTMLTableRowElement).cells, (td) => td.textContent))),
          id,
        ).toEqual(bookingRows(W2.docs[id]));
        await expectShownText(page, W2.docs[id], id);
        await expect(page.locator('[data-agr-disc]'), id).toHaveText(W2.counts(id).map(discLabel));
      }
    }
    expect(seen.sort()).toEqual(Object.keys(W2.mixes).sort());
  });

  test('the guest camera changes no total, and adds the deposit line, the recap row and the review row', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    const plain = W2.mixes.share.summary;
    const camId = mixId('share', [CAMERA]);
    const cam = W2.mixes[camId].summary;
    // The engine: the same total and payments, and one deposit outside the total.
    expect([cam.total, cam.retainer, cam.total_line, cam.price_lines, cam.steps, cam.later_payments]).toEqual([
      plain.total,
      plain.retainer,
      plain.total_line,
      plain.price_lines,
      plain.steps,
      plain.later_payments,
    ]);
    expect(cam.deposit?.amount).toBe('$100.00');
    await expect(page.locator('[data-agr-deposit-line], [data-agr-recap-row="deposit"]')).toHaveCount(0);
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await expectMix(page, W2, camId, 'Not chosen yet');
    await expect(page.locator('[data-agr-glance-total]')).toHaveText(plain.total);
    await expect(page.locator('[data-agr-total-line]')).toHaveText(plain.total_line!);
    await expect(page.locator('[data-agr-pay] > li > span:nth-child(3)')).toHaveText(plain.steps!.map((s) => s.amount));
    // The deposit line right after the steps, its recap row right after the retainer.
    await expect(page.locator('[data-agr-pay] + [data-agr-deposit-line]')).toHaveText(`${cam.deposit!.label}: ${cam.deposit!.amount}. ${cam.deposit!.note}`);
    await expect(page.locator('[data-agr-recap-row="due"] + [data-agr-recap-row="deposit"]')).toHaveCount(1);
    await expect(page.locator('[data-agr-recap-row="extras"] dd')).toHaveText('Guest camera');
    await expect(page.locator('[data-agr-extra-status]')).toHaveText(`Total: ${plain.total}. ${cam.deposit!.label}: ${cam.deposit!.amount}.`);
    await fillReady(page, 'share', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    const rows = page.locator('[data-agr-review-rows] > div');
    const LIST = ['Your name', 'Your partner', 'Package', 'Date', 'Extras', 'Total', 'Retainer', 'Second payment', 'Final payment'];
    await expect(rows.locator('dt')).toHaveText([...LIST, cam.deposit!.label, 'Sharing']);
    await expect(rows.nth(4).locator('dd')).toHaveText('Guest camera');
    await expect(rows.nth(5).locator('dd')).toHaveText(plain.total);
    await expect(rows.nth(6).locator('dd')).toHaveText(plain.retainer);
    await expect(rows.nth(9).locator('dd')).toHaveText(`${cam.deposit!.amount}. ${cam.deposit!.note}`);
    await page.locator('[data-agr-back]').click();
    await expect(page.locator('[data-agr-dialog]')).toBeHidden();
    // Unticked: the deposit is gone everywhere.
    await page.locator(`[data-agr-extra="${CAMERA}"]`).uncheck();
    await expect(page.locator('[data-agr-deposit-line], [data-agr-recap-row="deposit"]')).toHaveCount(0);
    await page.locator('[data-agr-review]').click();
    await expect(rows.locator('dt')).toHaveText([...LIST, 'Sharing']);
    await expect(rows.nth(4).locator('dd')).toHaveText('None');
  });

  test('ticking every box and then unticking every box gives back the plain mix everywhere', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, W2.signed('private'));
    });
    const urls: string[] = [];
    await page.route('**/r/agreement/pdf**', (route) => {
      urls.push(new URL(route.request().url()).search);
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf' }, body: PDF });
    });
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    // Everything the ready view shows, as built at load. The extra status is left out: it speaks from the first tick on.
    const snapshot = () =>
      page.evaluate(() => {
        const v = document.querySelector('[data-agr-view="ready"]')!.cloneNode(true) as HTMLElement;
        v.querySelectorAll('[data-agr-extra-status]').forEach((n) => n.remove());
        return v.innerHTML;
      });
    // The load writes the missing line quietly (aria-live off for about 500 ms): take the picture once it is home.
    await expect(page.locator('[data-agr-missing]')).toHaveAttribute('aria-live', 'polite');
    const before = await snapshot();
    const all = tickIds(W2);
    await setTicks(page, W2, all);
    await expectMix(page, W2, mixId('share', all), 'Not chosen yet');
    expect(await snapshot()).not.toBe(before);
    await setTicks(page, W2, []);
    await expectMix(page, W2, 'share', 'Not chosen yet');
    await expect.poll(snapshot).toBe(before);
    await expect(page.locator('[data-agr-extra]:checked')).toHaveCount(0);
    await expect(page.locator('[data-agr-deposit-line], [data-agr-recap-row="deposit"]')).toHaveCount(0);
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(3);
    await expect(page.locator('[data-agr-disc]')).toHaveText(W2.counts('share').map(discLabel));
    await expect(page.locator('[data-agr-extra-status]')).toHaveText(`Total: ${W2.mixes.share.summary.total}.`);
    // The copy and the signature are those of the plain mix: no x, no extras key.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download a copy (PDF)' }).click();
    await download;
    expect(urls).toEqual([`?k=${TOKEN}&c=share`]);
    await fillReady(page, 'private', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    const rows = page.locator('[data-agr-review-rows] > div');
    await expect(rows.locator('dt')).toHaveText(['Your name', 'Your partner', 'Package', 'Date', 'Extras', 'Total', 'Retainer', 'Second payment', 'Final payment', 'Sharing']);
    await expect(rows.nth(4).locator('dd')).toHaveText('None');
    await expect(rows.nth(5).locator('dd')).toHaveText(W2.mixes.private.summary.total);
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({ k: TOKEN, choice: 'private', signed_name: 'Elena Marchetti', agree: true, text_hash: sha256(W2.docs.private) });
    expect(body.text_hash).toBe(W2.mixes.private.hash);
    await expect(page.locator('[data-agr-deposit-row]')).toHaveCount(0);
  });

  test('a signature made on another device wins over the boxes ticked here', async ({ page }) => {
    const theirs = mixId('share', [INSTAX]);
    await mockDoc(page, [[200, W2.ready]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, W2.signed('share', [INSTAX], { already: true }));
    });
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await fillReady(page, 'private', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect([body.choice, body.extras]).toEqual(['private', [RAW, CAMERA]]);
    await expect(page.locator('[data-agr-already]')).toHaveText('This agreement was already signed. Here is the signed copy.');
    // A full 1 px border and the 14 px radius, no accent bar.
    expect(
      await page.locator('[data-agr-already]').evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.borderLeftWidth, s.borderTopWidth, s.borderTopStyle, s.borderTopLeftRadius];
      }),
    ).toEqual(['1px', '1px', 'solid', '14px']);
    // The signed copy and the amounts are the first signature's, never the boxes ticked here.
    const s = W2.mixes[theirs].summary;
    const sec1 = page.locator('[data-agr-signed-doc] #sec-1');
    await expect(sec1).toContainText(bookingRows(W2.docs[theirs]).find((r) => r[0] === 'Add-ons chosen at booking')![1]);
    await expect(sec1).toContainText('You allow sharing');
    await expect(sec1).toContainText(s.total);
    await expect(sec1).not.toContainText('RAW photos, 1 ×');
    await expect(sec1).not.toContainText('Guest camera deposit');
    await expect(page.locator('[data-agr-retainer]')).toHaveText(s.retainer);
    await expect(page.locator('[data-agr-later-row] dd')).toHaveText(s.later_payments!.map((r) => r.text));
    await expect(page.locator('[data-agr-deposit-row]')).toHaveCount(0);
  });

  test('a signed wedding opens with its own rows, and a deposit row only when the camera was ticked', async ({ page }) => {
    await mockDoc(page, [[200, W2.signed('share')]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    const card = page.locator('.agr-steps .agr-card').first();
    await expect(card.locator('dl > div:visible dt')).toHaveText(['Send an e-transfer to', 'Message or reference', 'Second payment', 'Final payment']);
    await expect(page.locator('[data-agr-balance-row]')).toBeHidden();
    await expect(page.locator('[data-agr-deposit-row]')).toHaveCount(0);
    // The signed view keeps a column of at most 880 px, left aligned in the page.
    const col = await page.evaluate(() => {
      const agr = document.querySelector('main.agr') as HTMLElement;
      const view = document.querySelector('[data-agr-view="signed"]')!.getBoundingClientRect();
      return { width: view.width, left: view.left, start: agr.getBoundingClientRect().left + parseFloat(getComputedStyle(agr).paddingLeft) };
    });
    expect(col.width).toBeLessThanOrEqual(880);
    expect(Math.abs(col.left - col.start)).toBeLessThanOrEqual(1);

    await page.unrouteAll();
    const id = mixId('private', [INSTAX, CAMERA]);
    const s = W2.mixes[id].summary;
    await mockDoc(page, [[200, W2.signed('private', [INSTAX, CAMERA])]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    await expect(card.locator('dl > div:visible dt')).toHaveText(['Send an e-transfer to', 'Message or reference', 'Second payment', 'Final payment', s.deposit!.label]);
    await expect(page.locator('[data-agr-deposit-row] dd')).toHaveText(`${s.deposit!.amount}. ${s.deposit!.note}`);
    await expect(page.locator('[data-agr-retainer]')).toHaveText(s.retainer);
    await expect(page.locator('[data-agr-later-row] dd')).toHaveText(s.later_payments!.map((r) => r.text));
    // The signed copy: the full text of that mix, 23 sections, read only.
    const signedDoc = page.locator('[data-agr-signed-doc]');
    await expect(signedDoc.locator('section.agr-sec')).toHaveCount(23);
    await expect(signedDoc.locator('#sec-1')).toContainText(s.total);
    await expect(signedDoc.locator('#sec-1')).toContainText('Guest camera deposit');
    await expect(signedDoc.locator('input, button')).toHaveCount(0);
    await expect(page.locator('[data-agr-choice], [data-agr-extra], [data-agr-disc]')).toHaveCount(0);
  });

  /** Every control a lock must reach: the tick boxes, both sharing cards, the name field and the agree box. */
  const LOCKED = [...tickIds(W2).map((id) => `[data-agr-extra="${id}"]`), '[data-agr-choice="share"]', '[data-agr-choice="private"]', '[data-agr-name]', '[data-agr-agree]'];
  const disabledNow = (page: Page) => page.evaluate((sels) => sels.map((s) => document.querySelector(s)!.matches(':disabled')), LOCKED);

  test('while the review is open inline every box, card and field is locked, and a press on a card changes nothing', async ({ page }) => {
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).HTMLDialogElement;
    });
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await fillReady(page, 'share', 'Elena Marchetti');
    expect(await disabledNow(page)).toEqual(LOCKED.map(() => false));
    const state = () =>
      page.evaluate(() => ({
        checked: Array.from(document.querySelectorAll<HTMLInputElement>('[data-agr-extra], [data-agr-choice], [data-agr-agree]'), (i) => i.checked),
        recap: document.querySelector('[data-agr-recap]')!.textContent,
        total: document.querySelector('[data-agr-glance-total]')!.textContent,
        rows: document.querySelector('[data-agr-review-rows]')!.textContent,
      }));
    await page.locator('[data-agr-review]').click();
    const panel = page.locator('[data-agr-dialog]');
    await expect(panel).toHaveClass(/agr-review--inline/);
    await expect(panel).toBeVisible();
    // Inline: no max height, no inner scroll, the buttons in the flow.
    expect(
      await panel.evaluate((e) => [
        getComputedStyle(e).maxHeight,
        getComputedStyle(e.querySelector('[data-agr-review-scroll]')!).overflowY,
        getComputedStyle(e.querySelector('[data-agr-review-rows]')!).overflowY,
      ]),
    ).toEqual(['none', 'visible', 'visible']);
    expect(await disabledNow(page)).toEqual(LOCKED.map(() => true));
    const before = await state();
    expect(before.checked).toEqual([true, false, false, true, false, true]);
    // A locked card looks locked: faded, the not-allowed cursor, and a ticked card keeps its tick.
    const raw = page.locator(`[data-agr-extra="${RAW}"]`);
    // (The mark fades in over 150 ms.)
    await expect
      .poll(() =>
        raw.evaluate((i) => {
          const card = i.parentElement!;
          return [
            getComputedStyle(i).cursor,
            getComputedStyle(card.querySelector('.agr-opt-frame')!).opacity,
            getComputedStyle(card.querySelector('.agr-opt-box')!).opacity,
            getComputedStyle(card.querySelector('.agr-opt-mark')!).opacity,
          ];
        }),
      )
      .toEqual(['not-allowed', '0.6', '0.6', '1']);
    expect(await page.locator('[data-agr-name]').evaluate((e) => [getComputedStyle(e).cursor, getComputedStyle(e).backgroundColor])).toEqual([
      'not-allowed',
      'rgb(244, 244, 240)',
    ]);
    // A press on a card, ticked or not, changes nothing.
    for (const sel of [`[data-agr-extra="${RAW}"]`, `[data-agr-extra="${INSTAX}"]`, '[data-agr-choice="private"]', '[data-agr-agree]']) {
      const card = page.locator(sel).locator('xpath=..');
      await card.scrollIntoViewIfNeeded();
      const box = (await card.boundingBox())!;
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      expect(await state(), sel).toEqual(before);
    }
    await page.locator('[data-agr-back]').click();
    await expect(panel).toBeHidden();
    expect(await disabledNow(page)).toEqual(LOCKED.map(() => false));
    expect(await state()).toEqual({ ...before });
  });

  test('while the sign request is out every box, card and field is locked', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    let during: boolean[] = [];
    let buttons: boolean[] = [];
    let back: string[] = [];
    await page.route('**/r/agreement/sign', async (route) => {
      during = await disabledNow(page);
      // The review button too: never enabled while busy.
      buttons = await page.evaluate(() => ['[data-agr-review]', '[data-agr-sign]', '[data-agr-back]'].map((s) => document.querySelector(s)!.matches(':disabled')));
      // "Go back" is off while the signature is out, and looks it: faded, the not-allowed cursor.
      back = await page.locator('[data-agr-back]').evaluate((b) => [getComputedStyle(b).opacity, getComputedStyle(b).cursor]);
      return reply(route, 200, W2.signed('share', [RAW]));
    });
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await fillReady(page, 'share', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(during).toEqual(LOCKED.map(() => true));
    expect(buttons).toEqual([true, true, true]);
    expect(back).toEqual(['0.6', 'not-allowed']);
  });

  test('without crypto.subtle the page signs with the stored hash of the mix on screen', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(Crypto.prototype, 'subtle', { get: () => undefined, configurable: true });
    });
    // A hash the browser could never compute: the page must send the stored value of exactly this mix.
    const id = mixId('private', [INSTAX]);
    const answer = JSON.parse(JSON.stringify(W2.ready)) as typeof W2.ready;
    answer.set.mixes[id].hash = 'f'.repeat(64);
    await mockDoc(page, [[200, answer]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, W2.signed('private', [INSTAX]));
    });
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${INSTAX}"]`).check();
    await fillReady(page, 'private', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({ k: TOKEN, choice: 'private', signed_name: 'Elena Marchetti', agree: true, text_hash: 'f'.repeat(64), extras: [INSTAX] });
  });

  test('one action makes at most one status line speak, the one next to the control used', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const LINES = ['[data-agr-extra-status]', '[data-agr-choice-status]', '[data-agr-missing]'];
    /** The aria-live of the three lines now: the role=status lines have none of their own, the missing line is polite. */
    const homes = () => page.evaluate((sels) => sels.map((s) => document.querySelector(s)!.getAttribute('aria-live')), LINES);
    // The load writes the missing line quietly too: wait until it is home before watching.
    await expect.poll(homes).toEqual([null, null, 'polite']);
    // Every change of a status line, with its aria-live at that moment ("status" = none set, role=status speaks),
    // and every change of its aria-live, with the time it happened.
    const watch = () =>
      page.evaluate(() => {
        const w = window as unknown as { writes: string[]; live: { line: string; t: number; to: string }[] };
        w.writes = [];
        w.live = [];
        for (const [name, sel] of [
          ['extra', '[data-agr-extra-status]'],
          ['choice', '[data-agr-choice-status]'],
          ['missing', '[data-agr-missing]'],
        ]) {
          const e = document.querySelector(sel)!;
          let text = e.textContent;
          new MutationObserver(() => {
            if (e.textContent === text) return;
            text = e.textContent;
            w.writes.push(`${name} ${e.getAttribute('aria-live') ?? 'status'}: ${text}`);
          }).observe(e, { childList: true, characterData: true, subtree: true });
          new MutationObserver((records) => {
            for (const r of records) w.live.push({ line: name, t: performance.now(), to: (r.target as Element).getAttribute('aria-live') ?? 'status' });
          }).observe(e, { attributes: true, attributeFilter: ['aria-live'] });
        }
      });
    /** The aria-live changes per line since the last call, each as `value@ms after that line's first change`. */
    const liveLog = async () => {
      const list = await page.evaluate(() => {
        const g = window as unknown as { live: { line: string; t: number; to: string }[] };
        const out = g.live;
        g.live = [];
        return out;
      });
      const out: Record<string, { to: string; dt: number }[]> = {};
      for (const x of list) {
        const first = list.find((y) => y.line === x.line)!;
        (out[x.line] ??= []).push({ to: x.to, dt: Math.round(x.t - first.t) });
      }
      return out;
    };
    await watch();
    const writes = async () => {
      const w = await page.evaluate(() => {
        const g = window as unknown as { writes: string[] };
        const out = g.writes;
        g.writes = [];
        return out;
      });
      return w.sort();
    };
    const total = (choice: Choice, ids: string[]) => W2.mixes[mixId(choice, ids)].summary.total;
    // Only the sections whose text changes are replaced: the others stay the very same nodes.
    await page.evaluate(() => [1, 15, 22].forEach((n) => document.getElementById(`sec-${n}`)!.setAttribute('data-test-seen', '')));
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await expect(page.locator('[data-agr-extra-status]')).toHaveText(`Total: ${total('share', [RAW])}.`);
    expect(await writes()).toEqual([`extra status: Total: ${total('share', [RAW])}.`]);
    expect(await page.evaluate(() => [1, 15, 22].map((n) => document.getElementById(`sec-${n}`)!.hasAttribute('data-test-seen')))).toEqual([false, true, true]);
    // A sharing card speaks in its own line; the extra status and the missing line follow quietly.
    await page.locator('[data-agr-choice="private"]').check();
    await expect(page.locator('[data-agr-choice-status]')).toHaveText(`Parts 1, 3 and 5 now show your choice. Total: ${total('private', [RAW])}.`);
    expect(await writes()).toEqual(
      [
        `choice status: Parts 1, 3 and 5 now show your choice. Total: ${total('private', [RAW])}.`,
        `extra off: Total: ${total('private', [RAW])}.`,
        'missing off: Type your full name. Tick the box to agree.',
      ].sort(),
    );
    // The quiet lines get their own aria-live back after about 500 ms (a timer: Chrome and Firefox hand a
    // change to the screen reader after the frame callbacks, so a line put back in the next frame is still read out).
    await expect.poll(homes).toEqual([null, null, 'polite']);
    const afterChoice = await liveLog();
    expect(Object.keys(afterChoice).sort()).toEqual(['extra', 'missing']);
    for (const [line, home] of [
      ['extra', 'status'],
      ['missing', 'polite'],
    ]) {
      expect(afterChoice[line].map((x) => x.to), line).toEqual(['off', home]);
      expect(afterChoice[line][1].dt, line).toBeGreaterThanOrEqual(450);
    }
    await page.locator(`[data-agr-extra="${INSTAX}"]`).check();
    await expect(page.locator('[data-agr-extra-status]')).toHaveText(`Total: ${total('private', [RAW, INSTAX])}.`);
    expect(await writes()).toEqual(
      [`extra status: Total: ${total('private', [RAW, INSTAX])}.`, `choice off: Parts 1, 3 and 5 now show your choice. Total: ${total('private', [RAW, INSTAX])}.`].sort(),
    );
    // The name field and the agree box speak in the missing line only.
    await page.locator('[data-agr-name]').fill('Elena Marchetti');
    await expect(page.locator('[data-agr-missing]')).toHaveText('Tick the box to agree.');
    expect(await writes()).toEqual(['missing polite: Tick the box to agree.']);
    await page.locator('[data-agr-agree]').check();
    await expect(page.locator('[data-agr-missing]')).toHaveText('');
    expect(await writes()).toEqual(['missing polite: ']);
    // Back home after the wait: the role=status lines with no aria-live, the missing line polite.
    await expect.poll(homes).toEqual([null, null, 'polite']);

    // One timer per line: a newer quiet write on the same line replaces the older timer. Two choices 100 ms
    // apart write the extra status twice; it comes back 500 ms after the second write, once.
    await liveLog();
    await page.evaluate(async () => {
      document.querySelector<HTMLInputElement>('[data-agr-choice="share"]')!.click();
      await new Promise((r) => setTimeout(r, 100));
      document.querySelector<HTMLInputElement>('[data-agr-choice="private"]')!.click();
      await new Promise((r) => setTimeout(r, 900));
    });
    await expect.poll(homes).toEqual([null, null, 'polite']);
    const twice = await liveLog();
    expect(Object.keys(twice)).toEqual(['extra']);
    expect(twice.extra.map((x) => x.to)).toEqual(['off', 'off', 'status']);
    expect(twice.extra[2].dt - twice.extra[1].dt).toBeGreaterThanOrEqual(450);

    // A speaking write puts the value back at once and cancels the timer: nothing changes the line later.
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect.poll(homes).toEqual([null, null, 'polite']);
    await watch();
    await page.evaluate(async () => {
      document.querySelector<HTMLInputElement>('[data-agr-choice="share"]')!.click();
      await new Promise((r) => setTimeout(r, 100));
      const name = document.querySelector<HTMLInputElement>('[data-agr-name]')!;
      name.value = 'Elena Marchetti';
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 900));
    });
    expect(await writes()).toEqual(['choice status: Parts 1, 3 and 5 now show your choice. Total: ' + total('share', []) + '.', 'missing off: Type your full name. Tick the box to agree.', 'missing polite: Tick the box to agree.'].sort());
    const cancelled = await liveLog();
    expect(Object.keys(cancelled)).toEqual(['missing']);
    expect(cancelled.missing.map((x) => x.to)).toEqual(['off', 'polite']);
    expect(cancelled.missing[1].dt).toBeLessThan(450);
    expect(await homes()).toEqual([null, null, 'polite']);
  });

  test('a panel closed from far below brings its button back on screen; one closed on screen stays put', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    const ribbonBottom = await page.locator('[data-agr-ribbon]').evaluate((e) => e.getBoundingClientRect().bottom);
    const disc = page.locator('[data-agr-disc="6"]');
    await disc.click();
    await expect(page.locator('[data-agr-full="6"]')).toBeVisible();
    // The end of the open panel on screen: its button is far above.
    await page.locator('#sec-20').evaluate((e) => e.scrollIntoView({ block: 'end', behavior: 'instant' }));
    await expect(disc).not.toBeInViewport();
    // A keyboard user closes it from there.
    await disc.evaluate((b) => (b as HTMLElement).focus({ preventScroll: true }));
    await expect(disc).not.toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(disc).toHaveAttribute('aria-expanded', 'false');
    await expect(disc).toBeFocused();
    await expect(disc).toBeInViewport({ ratio: 1 });
    expect(await settledTop(disc)).toBeGreaterThanOrEqual(ribbonBottom);
    // Open and closed again while on screen: it does not move.
    await disc.click();
    await expect(page.locator('[data-agr-full="6"]')).toBeVisible();
    const before = await settledTop(disc);
    await disc.click();
    await expect(page.locator('[data-agr-full="6"]')).toBeHidden();
    expect(Math.abs((await settledTop(disc)) - before)).toBeLessThanOrEqual(1);
  });

  test('a ticked card shows its drawn mark, and an unticked one does not', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    const mark = (input: string) => page.locator(input).locator('xpath=..').locator('.agr-opt-mark');
    const opacity = (input: string) => mark(input).evaluate((e) => getComputedStyle(e).opacity);
    const raw = `[data-agr-extra="${RAW}"]`;
    const share = '[data-agr-choice="share"]';
    for (const c of [raw, share, '[data-agr-choice="private"]', '[data-agr-agree]']) expect(await opacity(c), c).toBe('0');
    await page.locator(raw).check();
    await expect.poll(() => opacity(raw)).toBe('1');
    await page.locator(share).check();
    await expect.poll(() => opacity(share)).toBe('1');
    expect(await opacity('[data-agr-choice="private"]')).toBe('0');
    await page.locator('[data-agr-agree]').check();
    await expect.poll(() => opacity('[data-agr-agree]')).toBe('1');
    await page.locator(raw).uncheck();
    await expect.poll(() => opacity(raw)).toBe('0');
    // The tick is drawn in the text colour.
    expect(await mark(raw).getAttribute('stroke')).toBe('currentColor');
    expect(await mark('[data-agr-agree]').getAttribute('stroke')).toBe('currentColor');
  });

  test('"not yet" and back keeps the ticks, the choice, the name and the open panels, and lands on the sign block', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await page.locator('[data-agr-choice="private"]').check();
    await page.locator('[data-agr-name]').fill('Elena Marchetti');
    await page.locator('[data-agr-disc="3"]').click();
    await page.locator('[data-agr-not-yet]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'not-yet');
    await page.getByRole('button', { name: 'Back to the agreement' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-sign-title]')).toBeFocused();
    const top = await settledTop(page.locator('#sign'));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(80);
    for (const sel of [`[data-agr-extra="${RAW}"]`, `[data-agr-extra="${CAMERA}"]`, '[data-agr-choice="private"]']) await expect(page.locator(sel), sel).toBeChecked();
    await expect(page.locator(`[data-agr-extra="${INSTAX}"]`)).not.toBeChecked();
    await expect(page.locator('[data-agr-name]')).toHaveValue('Elena Marchetti');
    await expectMix(page, W2, mixId('private', [RAW, CAMERA]), PRIVATE_TITLE);
    for (let n = 1; n <= 7; n += 1) {
      await expect(page.locator(`[data-agr-disc="${n}"]`)).toHaveAttribute('aria-expanded', String(n === 3));
      await expect(page.locator(`[data-agr-full="${n}"]`)).toBeVisible({ visible: n === 3 });
    }
  });

  test('the missing line names what is missing, in order, and its link brings the sharing cards into view', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    const NAME = 'Type your full name.';
    const SHARE = 'Pick a sharing option in part 5.';
    const AGREE = 'Tick the box to agree.';
    const missing = page.locator('[data-agr-missing]');
    // Never hidden: always in the DOM, shown as a block, polite. Empty, it takes no space.
    const neverHidden = (label: string) =>
      expect
        .poll(() => missing.evaluate((e) => [(e as HTMLElement).hidden, getComputedStyle(e).display, e.getAttribute('aria-live')]), { message: label })
        .toEqual([false, 'block', 'polite']);
    await expect(missing).toHaveText(`${NAME} ${SHARE} ${AGREE}`);
    await expect(missing).toHaveAttribute('id', 'agr-missing');
    await expect(page.locator('[data-agr-review]')).toHaveAttribute('aria-describedby', 'agr-missing');
    await neverHidden('at load');
    const jump = missing.locator('a[data-agr-missing-jump]');
    await expect(jump).toHaveText('part 5');
    await expect(jump).toHaveAttribute('href', '#agr-sharing');
    await expect(missing.locator('a')).toHaveCount(1);
    await page.locator('[data-agr-name]').fill('Elena Marchetti');
    await expect(missing).toHaveText(`${SHARE} ${AGREE}`);
    await page.locator('[data-agr-agree]').check();
    await expect(missing).toHaveText(SHARE);
    await page.locator('[data-agr-name]').fill('');
    await expect(missing).toHaveText(`${NAME} ${SHARE}`);
    await page.locator('[data-agr-name]').fill('Elena Marchetti');
    await expect(missing).toHaveText(SHARE);
    await neverHidden('only the choice missing');
    // Only the choice is missing: its link brings the sharing cards to the top and focuses the first, without choosing it.
    await jump.click();
    await expect(page.locator('[data-agr-choice="share"]')).toBeFocused();
    await expect(page.locator('[data-agr-sharing]')).toBeInViewport();
    const top = await settledTop(page.locator('[data-agr-sharing]'));
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThanOrEqual(80);
    await expect(page.locator('[data-agr-choice="share"]')).not.toBeChecked();
    await expect(page.locator('[data-agr-recap-row="sharing"] dd')).toHaveText('Not chosen yet');
    // A sharing card writes the missing line quietly: aria-live is off while it changes, then polite again.
    await missing.evaluate((e) => {
      const w = window as unknown as { liveLog: string[] };
      w.liveLog = [];
      new MutationObserver(() => w.liveLog.push(`${e.getAttribute('aria-live')}|${e.textContent}`)).observe(e, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
    });
    const log = () => page.evaluate(() => (window as unknown as { liveLog: string[] }).liveLog);
    await page.locator('[data-agr-choice="share"]').check();
    await expect(missing).toHaveText('');
    await neverHidden('nothing missing');
    expect(await log()).toEqual(['off|', 'polite|']);
    // The agree box sits next to the line: that one speaks.
    await page.evaluate(() => ((window as unknown as { liveLog: string[] }).liveLog = []));
    await page.locator('[data-agr-agree]').uncheck();
    await expect(missing).toHaveText(AGREE);
    expect(await log()).toEqual([`polite|${AGREE}`]);
    await neverHidden('the agree box missing');
  });

  test('the keyboard: Space ticks, an arrow chooses, Enter reviews, Enter opens a panel and Space closes it', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    const raw = page.locator(`[data-agr-extra="${RAW}"]`);
    await raw.focus();
    await page.keyboard.press('Space');
    await expect(raw).toBeChecked();
    await expect(page.locator('[data-agr-glance-total]')).toHaveText(W2.mixes[mixId('share', [RAW])].summary.total);
    await expect(page.locator('[data-agr-extra-status]')).toHaveText(`Total: ${W2.mixes[mixId('share', [RAW])].summary.total}.`);
    // ArrowDown from the share card chooses the private card.
    const share = page.locator('[data-agr-choice="share"]');
    const priv = page.locator('[data-agr-choice="private"]');
    await share.focus();
    await page.keyboard.press('ArrowDown');
    await expect(priv).toBeChecked();
    await expect(priv).toBeFocused();
    await expect(share).not.toBeChecked();
    await expectMix(page, W2, mixId('private', [RAW]), PRIVATE_TITLE);
    const agree = page.locator('[data-agr-agree]');
    await agree.focus();
    await page.keyboard.press('Space');
    await expect(agree).toBeChecked();
    // Enter in the name field opens the review only when nothing is missing.
    const name = page.locator('[data-agr-name]');
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-agr-dialog]')).toBeHidden();
    await name.fill('Elena Marchetti');
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-agr-dialog]')).toBeVisible();
    await expect(page.locator('[data-agr-dialog-title]')).toBeFocused();
    await expect(page.locator('[data-agr-review-rows]')).toContainText(W2.mixes[mixId('private', [RAW])].summary.total);
    await page.locator('[data-agr-back]').click();
    await expect(page.locator('[data-agr-dialog]')).toBeHidden();
    // Enter opens a panel, Space closes it, and the focus stays on the button.
    const disc = page.locator('[data-agr-disc="3"]');
    await disc.focus();
    await page.keyboard.press('Enter');
    await expect(disc).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-agr-full="3"]')).toBeVisible();
    await expect(disc).toBeFocused();
    await disc.focus();
    await page.keyboard.press('Space');
    await expect(disc).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-agr-full="3"]')).toBeHidden();
    await expect(disc).toBeFocused();
  });

  test('Tab from the hero reaches every control in page order, and a focused tick box shows its ring', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit on a Mac skips links and often buttons on Tab');
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await fillReady(page, 'share', 'Elena Marchetti');
    await expect(page.locator('[data-agr-review]')).toBeEnabled();
    await page.locator('[data-agr-title]').focus();
    const focused = () =>
      page.evaluate(() => {
        const e = document.activeElement as HTMLElement | null;
        if (!e) return 'none';
        const d = e.dataset;
        if (e.closest('[data-agr-toc]')) return `toc ${e.getAttribute('href')}`;
        if (d.agrExtra) return `extra ${d.agrExtra}`;
        if (d.agrDisc) return `disc ${d.agrDisc}`;
        if (d.agrChoice) return `choice ${d.agrChoice}`;
        for (const k of ['agrName', 'agrAgree', 'agrReview', 'agrPrint', 'agrNotYet']) if (k in d) return k;
        if (e.matches('[data-agr-points] a[href^="#part-"]')) return 'link in a point';
        return `other ${e.tagName} ${e.getAttribute('href') ?? ''}`;
      });
    const ring = () =>
      page.evaluate(() => {
        const e = document.activeElement!;
        const s = getComputedStyle(e.matches('.agr-opt-input') ? e.parentElement!.querySelector('.agr-opt-frame')! : e);
        return `${s.outlineStyle} ${s.outlineWidth} ${s.outlineOffset}`;
      });
    const seen: string[] = [];
    const rings: Record<string, string> = {};
    for (let i = 0; i < 60 && seen[seen.length - 1] !== 'agrNotYet'; i += 1) {
      await page.keyboard.press('Tab');
      const f = await focused();
      seen.push(f);
      if (f === `extra ${RAW}` || f === 'disc 1') rings[f] = await ring();
    }
    expect(seen.filter((f) => f !== 'link in a point')).toEqual([
      ...PARTS.map((p) => `toc #part-${p.n}`),
      'toc #sign',
      'disc 1',
      'disc 2',
      'disc 3',
      ...tickIds(W2).map((id) => `extra ${id}`),
      'disc 4',
      'choice share',
      'disc 5',
      'disc 6',
      'disc 7',
      'agrName',
      'agrAgree',
      'agrReview',
      'agrPrint',
      'agrNotYet',
    ]);
    expect(seen.filter((f) => f === 'link in a point').length).toBeGreaterThan(0);
    expect(rings).toEqual({ [`extra ${RAW}`]: 'solid 2px 3px', 'disc 1': 'solid 2px 3px' });
  });

  test('a contents link or a part link lands its heading just under the ribbon and focuses it', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const ribbonBottom = await page.locator('[data-agr-ribbon]').evaluate((e) => e.getBoundingClientRect().bottom);
    expect(ribbonBottom).toBeGreaterThan(0);
    const land = async (link: Locator, heading: Locator) => {
      await link.click();
      await expect(heading).toBeFocused();
      const top = await settledTop(heading);
      expect(top).toBeGreaterThanOrEqual(ribbonBottom);
      await expect(heading).toBeInViewport();
    };
    await land(page.locator('[data-agr-toc] a[href="#part-3"]'), page.locator('[data-agr-part="3"] > h2'));
    await land(page.locator('[data-agr-points="3"] a[href="#part-6"]'), page.locator('[data-agr-part="6"] > h2'));
    await land(page.locator('[data-agr-toc] a[href="#sign"]'), page.locator('[data-agr-sign-title]'));
    // Every jump target keeps clear of the ribbon in test mode, and 24 px without it.
    const margins = () =>
      page.evaluate(() =>
        ['[data-agr-part="1"]', '[data-agr-part="7"]', '#sign', '#agr-sharing', '[data-agr-disc="1"]'].map((s) => getComputedStyle(document.querySelector(s)!).scrollMarginTop),
      );
    expect(await margins()).toEqual(['56px', '56px', '56px', '56px', '56px']);
    await page.unrouteAll();
    await mockDoc(page, [[200, { ...W2.ready, mode: 'live', number: 'KK-2026-001' }]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-ribbon]')).toBeHidden();
    expect(await margins()).toEqual(['24px', '24px', '24px', '24px', '24px']);
  });

  test('the card just pressed stays where it was on screen while the text above it changes', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    // Open panels above part 4: section 1 and part 3 change with every tick and every choice.
    await page.locator('[data-agr-disc="1"]').click();
    await page.locator('[data-agr-disc="3"]').click();
    const stays = async (input: string, act: () => Promise<void>) => {
      const card = page.locator(input).locator('xpath=..');
      await card.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' }));
      const before = await settledTop(card);
      const docBefore = await card.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
      await act();
      const after = await settledTop(card);
      const docAfter = await card.evaluate((e) => e.getBoundingClientRect().top + window.scrollY);
      expect(Math.abs(after - before), input).toBeLessThanOrEqual(1);
      return docAfter - docBefore;
    };
    // The page above grew (so the card would have moved), and the card did not move on screen.
    expect(await stays(`[data-agr-extra="${RAW}"]`, () => page.locator(`[data-agr-extra="${RAW}"]`).check())).toBeGreaterThan(10);
    await expect(page.locator('[data-agr-glance-total]')).toHaveText(W2.mixes[mixId('share', [RAW])].summary.total);
    expect(await stays(`[data-agr-extra="${CAMERA}"]`, () => page.locator(`[data-agr-extra="${CAMERA}"]`).check())).toBeGreaterThan(10);
    expect(Math.abs(await stays('[data-agr-choice="private"]', () => page.locator('[data-agr-choice="private"]').check()))).toBeGreaterThan(10);
    await expectMix(page, W2, mixId('private', [RAW, CAMERA]), PRIVATE_TITLE);
    expect(await stays(`[data-agr-extra="${CAMERA}"]`, () => page.locator(`[data-agr-extra="${CAMERA}"]`).uncheck())).toBeLessThan(-10);
  });

  test('fits a 360 px screen with panels open and every box ticked, and in the signed view', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const width = () => page.evaluate(() => document.documentElement.scrollWidth);
    await page.locator('[data-agr-disc="4"]').click();
    await expect(page.locator('[data-agr-full="4"]')).toBeVisible();
    expect(await width()).toBeLessThanOrEqual(360);
    await setTicks(page, W2, tickIds(W2));
    await page.locator('[data-agr-choice="private"]').check();
    for (const n of [1, 2, 3, 5, 6, 7]) await page.locator(`[data-agr-disc="${n}"]`).click();
    await expect(page.locator('[data-agr-full]:visible')).toHaveCount(7);
    expect(await width()).toBeLessThanOrEqual(360);
    // Tap targets of 44 px at least: buttons, cards, the field and the contents links.
    const small = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>('[data-agr-view="ready"] button, [data-agr-view="ready"] label.agr-opt, [data-agr-name], [data-agr-toc] a'))
        .filter((e) => e.getClientRects().length > 0 && e.getBoundingClientRect().height < 44)
        .map((e) => e.outerHTML.slice(0, 80)),
    );
    expect(small).toEqual([]);
    // Below 640 px the primary button is as wide as its column.
    expect(await page.locator('[data-agr-review]').evaluate((b) => Math.abs(b.getBoundingClientRect().width - b.parentElement!.clientWidth))).toBeLessThanOrEqual(1);
    // The price lines never stack: each amount stays on the right of its label.
    const lines = await page.locator('[data-agr-price-lines] > div').evaluateAll((ds) =>
      ds.map((d) => {
        const t = d.querySelector('dt')!.getBoundingClientRect();
        const a = d.querySelector('dd')!.getBoundingClientRect();
        return a.left >= t.right - 0.5 && a.top < t.bottom;
      }),
    );
    expect(lines.length).toBeGreaterThan(3);
    expect(lines).toEqual(lines.map(() => true));
    // The tables of the text stack below 560 px.
    expect(await page.locator('#sec-1 table.agr-table td').first().evaluate((e) => getComputedStyle(e).display)).toBe('block');
    // The "not yet" view, and the way back.
    await page.locator('[data-agr-not-yet]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'not-yet');
    expect(await width()).toBeLessThanOrEqual(360);
    await page.getByRole('button', { name: 'Back to the agreement' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await page.unrouteAll();
    await mockDoc(page, [[200, W2.signed('private', [RAW, CAMERA])]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(await width()).toBeLessThanOrEqual(360);
    await page.unrouteAll();
    await mockDoc(page, [[503, { ok: false, error: 'storage_unavailable' }]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'error');
    expect(await width()).toBeLessThanOrEqual(360);
  });

  test('at 768 x 1024 the main column is as wide as the container, with the contents above it', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const layout = () =>
      page.evaluate(() => {
        const agr = document.querySelector('main.agr') as HTMLElement;
        const cs = getComputedStyle(agr);
        const box = (e: Element) => e.getBoundingClientRect();
        const links = Array.from(document.querySelectorAll('[data-agr-toc] a'), (a) => box(a));
        return {
          container: agr.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight),
          column: box(document.querySelector('[data-agr-doc]')!.parentElement!),
          parts: box(document.querySelector('[data-agr-doc]')!).width,
          sign: box(document.querySelector('#sign')!).width,
          nav: box(document.querySelector('[data-agr-toc]')!.closest('nav')!),
          links: links.map((l) => [Math.round(l.left), Math.round(l.top)]),
          cells: Array.from(document.querySelectorAll('[data-agr-glance] > div'), (c) => Math.round(c.getBoundingClientRect().top)),
          scroll: document.documentElement.scrollWidth,
        };
      });
    const m = await layout();
    expect(Math.abs(m.column.width - m.container)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.parts - m.container)).toBeLessThanOrEqual(1);
    expect(Math.abs(m.sign - m.container)).toBeLessThanOrEqual(1);
    // Below 960 px the contents sit above the parts, in two columns.
    expect(m.column.top).toBeGreaterThanOrEqual(m.nav.bottom);
    expect(m.links[1][1]).toBe(m.links[0][1]);
    expect(m.links[1][0]).toBeGreaterThan(m.links[0][0]);
    // The glance has 2 columns below 900 px: its four cells make two rows.
    expect(m.cells).toHaveLength(4);
    expect([m.cells[0] === m.cells[1], m.cells[2] === m.cells[3], m.cells[2] > m.cells[0]]).toEqual([true, true, true]);
    await page.locator('[data-agr-disc="4"]').click();
    await expect(page.locator('[data-agr-full="4"]')).toBeVisible();
    expect((await layout()).scroll).toBeLessThanOrEqual(768);
    // From 960 px the contents sit beside the parts, one link under the other.
    await page.setViewportSize({ width: 1280, height: 900 });
    const d = await layout();
    expect(d.nav.right).toBeLessThanOrEqual(d.column.left);
    expect(new Set(d.links.map((l) => l[0])).size).toBe(1);
    expect(d.links[1][1]).toBeGreaterThan(d.links[0][1]);
    expect(d.scroll).toBeLessThanOrEqual(1280);
    // From 900 px the glance has 4 columns: one row.
    expect(new Set(d.cells).size).toBe(1);
  });

  test('at 360 x 640 the review dialog shows both buttons without scrolling, with equal gaps to the screen edges', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 640 });
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await fillReady(page, 'private', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    await expect(page.locator('[data-agr-dialog]')).toBeVisible();
    await expect(page.locator('[data-agr-review-rows]')).toContainText(W2.mixes[mixId('private', [CAMERA])].summary.deposit!.note);
    const r = await page.evaluate(() => {
      const g = (s: string) => document.querySelector(s)!.getBoundingClientRect().toJSON() as DOMRect;
      return { dlg: g('[data-agr-dialog]'), sign: g('[data-agr-sign]'), back: g('[data-agr-back]'), w: window.innerWidth, h: window.innerHeight };
    });
    for (const b of [r.sign, r.back]) {
      expect(b.top).toBeGreaterThanOrEqual(0);
      expect(b.bottom).toBeLessThanOrEqual(r.h);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.right).toBeLessThanOrEqual(r.w);
    }
    expect(Math.abs(r.dlg.left - (r.w - r.dlg.right))).toBeLessThanOrEqual(1);
    expect(Math.abs(r.dlg.top - (r.h - r.dlg.bottom))).toBeLessThanOrEqual(1);
    // width min(520px, 100vw - 32px), height at most 100dvh - 32px.
    expect(r.dlg.width).toBeCloseTo(r.w - 32, 0);
    expect(r.dlg.height).toBeLessThanOrEqual(r.h - 32 + 0.5);
    // Below 640 px the buttons stack, full width, "Sign the agreement" on top.
    expect(r.sign.bottom).toBeLessThanOrEqual(r.back.top + 0.5);
    expect(Math.abs(r.sign.width - r.back.width)).toBeLessThanOrEqual(1);
    // The rows scroll on their own; the title and the buttons do not. The scroll area takes keyboard focus
    // (Safari makes no scroll area reachable by Tab by itself), as a group named by the dialog title.
    const scroller = page.locator('[data-agr-review-scroll]');
    expect(
      await scroller.evaluate((e) => [
        getComputedStyle(e).overflowY,
        (e as HTMLElement).tabIndex,
        e.getAttribute('role'),
        e.getAttribute('aria-labelledby'),
        e.querySelector(':scope > [data-agr-review-rows]') !== null,
        e.scrollHeight > e.clientHeight,
      ]),
    ).toEqual(['auto', 0, 'group', 'agr-review-title', true, true]);
    // Focus stays on the title at open; the next Tab is the scroll area, and the keys scroll it.
    await expect(page.locator('[data-agr-dialog-title]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(scroller).toBeFocused();
    expect(await scroller.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
    await page.keyboard.press('End');
    await expect.poll(() => scroller.evaluate((e) => Math.round(e.scrollTop + e.clientHeight - e.scrollHeight))).toBe(0);
  });

  test('print shows the names, the booking number and the full wording of every part, and nothing else of the ready view', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await expect(page.locator('[data-agr-full]:visible')).toHaveCount(0);
    await page.emulateMedia({ media: 'print' });
    const hide = [
      'header.agr-top',
      '[data-agr-title]',
      '[data-agr-lede]',
      '#agr-glance-title',
      '[data-agr-glance]',
      '[data-agr-toc]',
      '[data-agr-points]',
      '[data-agr-note]',
      '[data-agr-total-line]',
      '[data-agr-price-lines]',
      '[data-agr-pay]',
      '[data-agr-deposit-line]',
      '[data-agr-total-undecided]',
      '[data-agr-extras]',
      '[data-agr-extras-intro]',
      '[data-agr-booked]',
      '[data-agr-extra]',
      '[data-agr-more]',
      '[data-agr-extra-status]',
      '[data-agr-sharing]',
      '[data-agr-choice]',
      '[data-agr-choice-status]',
      '[data-agr-disc]',
      '[data-agr-signbox]',
      '[data-agr-recap]',
      '[data-agr-missing]',
      '[data-agr-view="ready"] button',
    ];
    for (const sel of hide) {
      const all = await page.locator(sel).all();
      expect(all.length, sel).toBeGreaterThan(0);
      for (const e of all) await expect(e, sel).toBeHidden();
    }
    const pointHeads = await page.locator('[data-agr-part] h3', { hasText: 'The main points' }).all();
    expect(pointHeads.length).toBe(6);
    for (const h of pointHeads) await expect(h).toBeHidden();
    for (const sel of ['[data-agr-ribbon]', '[data-agr-who]', '[data-agr-booking]', '[data-agr-doc-title]', '[data-agr-doc-intro]', '[data-agr-business-signature]'])
      await expect(page.locator(sel), sel).toBeVisible();
    for (const part of W2.page.parts) await expect(page.locator(`[data-agr-part="${part.n}"] > h2`)).toBeVisible();
    const secs = await doc(page).locator('section.agr-sec').all();
    expect(secs).toHaveLength(23);
    for (const s of secs) await expect(s).toBeVisible();
    // Every wrapper between main.agr and the clause text is a block; the panels lose their card look.
    const chain = await page
      .locator('#sec-3 p.agr-clause')
      .first()
      .evaluate((p) => {
        const out: string[] = [];
        for (let e = p.parentElement; e && !e.matches('main.agr'); e = e.parentElement) out.push(`${e.tagName.toLowerCase()} ${getComputedStyle(e).display}`);
        return out;
      });
    expect(chain.filter((c) => !c.endsWith(' block'))).toEqual([]);
    expect(
      await page.locator('[data-agr-full="3"]').evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.borderTopWidth, s.paddingTop, s.borderTopLeftRadius, s.backgroundColor];
      }),
    ).toEqual(['0px', '0px', '0px', 'rgba(0, 0, 0, 0)']);
    expect(await page.locator('[data-agr-part="1"] > h2').evaluate((e) => getComputedStyle(e).breakAfter)).toBe('avoid');
    expect(await page.locator('#sec-1 > h3').evaluate((e) => getComputedStyle(e).breakAfter)).toBe('avoid');
    expect(await page.locator('#sec-1 table.agr-table tr').first().evaluate((e) => getComputedStyle(e).breakInside)).toBe('avoid');
    // The full wording prints at the text size of the signed copy (the .agr print size, 10.5pt = 14px), not at the screen's 17 px.
    const printSizes = (sels: string[]) => page.evaluate((list) => list.map((s) => getComputedStyle(document.querySelector(s)!).fontSize), sels);
    expect(await printSizes(['main.agr', '[data-agr-full="3"]', '#sec-3 p.agr-clause', '#sec-1 table.agr-table td', '[data-agr-doc-intro]', '[data-agr-business-signature]'])).toEqual(
      ['14px', '14px', '14px', '14px', '14px', '14px'],
    );
    // Back on screen, the panels are closed again.
    await page.emulateMedia({ media: 'screen' });
    await expect(page.locator('[data-agr-full]:visible')).toHaveCount(0);
    expect(await printSizes(['#sec-3 p.agr-clause'])).toEqual(['17px']);
    // The signed copy in print: the same 14px.
    await page.unrouteAll();
    await mockDoc(page, [[200, W2.signed('share', [CAMERA])]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    await page.emulateMedia({ media: 'print' });
    expect(await printSizes(['main.agr', '[data-agr-signed-doc] #sec-3 p.agr-clause'])).toEqual(['14px', '14px']);
    await page.emulateMedia({ media: 'screen' });
  });

  test('a set that is wrong anywhere gives the error view at load with nothing built, and Try again builds it', async ({ page }) => {
    const copy = (): typeof W2.ready => JSON.parse(JSON.stringify(W2.ready));
    const missingMix = copy();
    delete missingMix.set.mixes[mixId('share', [RAW, INSTAX])];
    // One mix whose head carries another title (its hash made to match, so only the frame check can catch it).
    const otherTitle = copy();
    {
      const m = otherTitle.set.mixes[mixId('private', [CAMERA])];
      const title = (JSON.parse(W2.docs.share) as AgreementDoc).title;
      const head = otherTitle.set.pool[m.f[0]];
      const changed = head.replace(JSON.stringify(title), JSON.stringify(`${title} (draft)`));
      expect(changed).not.toBe(head);
      otherTitle.set.pool.push(changed);
      m.f = [otherTitle.set.pool.length - 1, ...m.f.slice(1)];
      m.hash = sha256(docJsonFromSet(otherTitle.set.pool, m.f));
    }
    const noSteps = copy();
    noSteps.set.mixes[mixId('private', [RAW])].summary.steps = [];
    const noTotal = copy();
    noTotal.set.mixes[mixId('share', [INSTAX, CAMERA])].summary.total = '';
    const noShare = copy();
    delete (noShare.set.mixes as Record<string, unknown>).share;
    // The frozen parts must cover every section exactly once.
    const partsGap = copy();
    partsGap.page.parts[5].sections = partsGap.page.parts[5].sections.slice(1);
    const partsTwice = copy();
    partsTwice.page.parts[0].sections = [...partsTwice.page.parts[0].sections, partsTwice.page.parts[1].sections[0]];
    // A section fragment that only one ticked mix uses, and that cannot render: nothing ticked would show fine.
    const badFragment = copy();
    {
      const users = new Map<number, string[]>();
      for (const [id, m] of Object.entries(badFragment.set.mixes)) for (const i of m.f.slice(1, -1)) users.set(i, [...(users.get(i) ?? []), id]);
      const [i] = [...users].find(([, ids]) => ids.length === 1 && ids[0].includes('+'))!;
      const sec = JSON.parse(badFragment.set.pool[i]) as AgreementDoc['sections'][number];
      (sec.items.find((it) => it.type === 'clause') as unknown as { text: null }).text = null;
      badFragment.set.pool[i] = JSON.stringify(sec);
    }
    const cases: [string, unknown][] = [
      ['a mix missing from the set', missingMix],
      ['a mix that differs in its title', otherTitle],
      ['a mix whose summary has no steps', noSteps],
      ['a mix whose summary has an empty total', noTotal],
      ['no share mix', noShare],
      ['parts that leave out a section', partsGap],
      ['parts that hold a section twice', partsTwice],
      ['a fragment of one ticked mix that cannot render', badFragment],
    ];
    for (const [what, answer] of cases) {
      await page.unrouteAll();
      await mockDoc(page, [[200, answer]]);
      await page.goto(PATH);
      await expect(main(page), what).toHaveAttribute('data-agr-state', 'error');
      await expect(page.locator('[data-agr-load-error]'), what).toBeVisible();
      for (const sel of ['[data-agr-doc]', '[data-agr-toc]', '[data-agr-glance]', '[data-agr-lede]', '[data-agr-recap]'])
        await expect(page.locator(`${sel} > *`), `${what}: ${sel}`).toHaveCount(0);
      await expect(page.locator('section.agr-sec, [data-agr-extra], [data-agr-choice], [data-agr-total-undecided]'), what).toHaveCount(0);
    }
    // Try again with a whole answer builds everything.
    await page.unrouteAll();
    await mockDoc(page, [[200, badFragment], [200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'error');
    await page.getByRole('button', { name: 'Try again' }).click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('h1:visible')).toBeFocused();
    await expect(doc(page).locator('section.agr-sec')).toHaveCount(23);
    await expect(page.locator('[data-agr-extra]')).toHaveCount(3);
    await expect(page.locator('[data-agr-disc]')).toHaveCount(7);
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(3);
    await expectMix(page, W2, 'share', 'Not chosen yet');
  });

  test('a civil booking with a set and no page content: the fallback layout, nothing to tick, the share text signed with no extras key', async ({ page }) => {
    // The engine made every mix, with summaries of today (no steps), and no page content.
    expect(C3.ready).not.toHaveProperty('page');
    expect(Object.keys(C3.mixes)).toHaveLength(16);
    expect(C3.mixes.share.summary.steps).toBeUndefined();
    expect(C3.mixes.share.summary.total_line).toBeUndefined();
    const s = C3.mixes.share.summary;
    const calls = await mockDoc(page, [[200, C3.ready]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, C3.signed('share'));
    });
    const urls: string[] = [];
    await page.route('**/r/agreement/pdf**', (route) => {
      urls.push(new URL(route.request().url()).search);
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf' }, body: PDF });
    });
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    expect(new URL(calls[0]).search).toBe(`?k=${TOKEN}&v=2`);
    await expect(page.locator('h1:visible')).toHaveText('Your agreement');
    await expect(page.locator('[data-agr-lede] p')).toHaveText(['Everything we agreed, in one place. Read it through, then sign at the end.']);
    // The fallback layout: the parts of parts.ts, every section shown, no disclosure, no points, nothing to tick.
    await expect(page.locator('[data-agr-toc] a')).toHaveText([...PARTS.map((p) => `${p.n} ${p.title}`), 'Sign your agreement']);
    await expect(doc(page).locator('section.agr-sec')).toHaveCount(23);
    for (const sec of await doc(page).locator('section.agr-sec').all()) await expect(sec).toBeVisible();
    await expect(page.locator('[data-agr-disc], [data-agr-points], [data-agr-note], [data-agr-extras], [data-agr-extras-intro], [data-agr-extra-status]')).toHaveCount(0);
    await expect(page.locator('[data-agr-extra]')).toHaveCount(0);
    await expect(page.locator('[data-agr-glance] dt')).toHaveText(['Package', 'Date', 'Total']);
    await expect(page.locator('[data-agr-glance] dd')).toHaveText([s.package, s.date, s.total]);
    await expect(page.locator('[data-agr-old-pay] dt')).toHaveText(['Total', 'Retainer', 'Balance']);
    await expect(page.locator('[data-agr-old-pay] dd')).toHaveText([s.total, s.retainer, `${s.balance}, ${s.balance_how}`]);
    await expect(page.locator('[data-agr-total-line], [data-agr-price-lines], [data-agr-pay], [data-agr-total-undecided]')).toHaveCount(0);
    await expect(page.locator('[data-agr-recap] > div > dt')).toHaveText(['Sharing', 'Total', 'Due today, the retainer']);
    await expect(page.locator('#sec-1')).toContainText('You choose this in part 5.');
    // The glance: three cells, the Total cell fills the rest of its row.
    const cells = await page.locator('[data-agr-glance]').evaluate((g) => [g.getBoundingClientRect().right, g.lastElementChild!.getBoundingClientRect().right]);
    expect(Math.abs(cells[0] - cells[1])).toBeLessThanOrEqual(2);
    // The copy before a choice is the share text; the signature too, with no extras key.
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download a copy (PDF)' }).click();
    await download;
    expect(urls).toEqual([`?k=${TOKEN}&c=share`]);
    await fillReady(page, 'share');
    await expectShownText(page, C3.docs.share);
    await page.locator('[data-agr-review]').click();
    await expect(page.locator('[data-agr-review-rows] > div > dt')).toHaveText(['Your name', 'Your partner', 'Package', 'Date', 'Total', 'Retainer', 'Sharing']);
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({ k: TOKEN, choice: 'share', signed_name: 'Priya Sharma', agree: true, text_hash: sha256(C3.docs.share) });
    expect(body.text_hash).toBe(C3.mixes.share.hash);
  });

  test('a wedding with a set and no page content: part 3 shows the later payments of the shown choice', async ({ page }) => {
    expect(W3.ready).not.toHaveProperty('page');
    expect(W3.mixes.private.summary.steps).toBeUndefined();
    const share = W3.mixes.share.summary;
    const priv = W3.mixes.private.summary;
    expect(share.total).not.toBe(priv.total);
    const rows = (s: StoredSummary) => [s.total, s.retainer, ...s.later_payments!.map((r) => r.text)];
    await mockDoc(page, [[200, W3.ready]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, W3.signed('private'));
    });
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-extra], [data-agr-disc]')).toHaveCount(0);
    await expect(page.locator('[data-agr-old-pay] dt')).toHaveText(['Total', 'Retainer', 'Second payment', 'Final payment']);
    await expect(page.locator('[data-agr-old-pay] dd')).toHaveText(rows(share));
    // The two totals differ: the undecided line in its three places.
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(3);
    for (const sel of ['[data-agr-glance] + [data-agr-total-undecided]', '[data-agr-old-pay] + [data-agr-total-undecided]', '[data-agr-recap-row="total"] [data-agr-total-undecided]'])
      await expect(page.locator(sel), sel).toHaveCount(1);
    await expect(page.locator('#sec-1 [data-agr-variant]')).toHaveCount(2);
    await page.locator('[data-agr-choice="private"]').check();
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    await expect(page.locator('[data-agr-old-pay] dd')).toHaveText(rows(priv));
    await expect(page.locator('[data-agr-glance-total]')).toHaveText(priv.total);
    await expect(page.locator('[data-agr-recap-row="total"] dd')).toHaveText(priv.total);
    await expect(page.locator('[data-agr-recap-row="due"] dd')).toHaveText(priv.retainer);
    await expect(page.locator('[data-agr-choice-status]')).toHaveText(`Parts 1, 3 and 5 now show your choice. Total: ${priv.total}.`);
    await expectShownText(page, W3.docs.private);
    await page.locator('[data-agr-name]').fill('Elena Marchetti');
    await page.locator('[data-agr-agree]').check();
    await page.locator('[data-agr-review]').click();
    await expect(page.locator('[data-agr-review-rows] > div > dt')).toHaveText(['Your name', 'Your partner', 'Package', 'Date', 'Total', 'Retainer', 'Second payment', 'Final payment', 'Sharing']);
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({ k: TOKEN, choice: 'private', signed_name: 'Elena Marchetti', agree: true, text_hash: sha256(W3.docs.private) });
  });

  test('a civil booking with a set retainer, paid in cash: every mix keeps its retainer and its cash wording', async ({ page }) => {
    test.setTimeout(120_000);
    expect([CASH.facts.retainer, CASH.facts.balance_cash]).toEqual([51.25, true]);
    const signedId = mixId('private', ['drone']);
    await mockDoc(page, [[200, CASH.ready]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, CASH.signed('private', ['drone'], { copy: { status: 'sent', to: 'priya@example.com' } }));
    });
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-points="3"] > li')).toHaveText(CASH.page.parts[2].points);
    await expect(page.locator('[data-agr-points="3"] > li').first()).toHaveText(
      'You pay the retainer by e-transfer to info@kashklicks.ca. You pay the balance in cash on the day, not by e-transfer.',
    );
    await expect(page.locator('[data-agr-total-undecided]')).toHaveCount(0);
    for (const choice of CHOICE_LIST) {
      await page.locator(`[data-agr-choice="${choice}"]`).check();
      for (const ticked of subsetsOf(tickIds(CASH))) {
        await setTicks(page, CASH, ticked);
        const id = mixId(choice, ticked);
        const s = CASH.mixes[id].summary;
        expect([s.retainer, s.balance_how, s.steps![1].note], id).toEqual(['$51.25', 'in cash', 'In cash, before I start shooting.']);
        await expectMix(page, CASH, id, titleOf(choice));
        await expectShownText(page, CASH.docs[id], id);
      }
    }
    await setTicks(page, CASH, ['drone']);
    await page.locator('[data-agr-name]').fill('Priya Sharma');
    await page.locator('[data-agr-agree]').check();
    await page.locator('[data-agr-review]').click();
    const s = CASH.mixes[signedId].summary;
    await expect(page.locator('[data-agr-review-rows] > div > dt')).toHaveText(['Your name', 'Your partner', 'Package', 'Date', 'Extras', 'Total', 'Retainer', 'Sharing']);
    await expect(page.locator('[data-agr-review-rows] > div > dd')).toHaveText([
      'Priya Sharma',
      'Arjun Mehta',
      s.package,
      s.date,
      'Drone and aerial frames',
      s.total,
      '$51.25',
      CASH.labels.private_option,
    ]);
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({
      k: TOKEN,
      choice: 'private',
      signed_name: 'Priya Sharma',
      agree: true,
      text_hash: sha256(CASH.docs[signedId]),
      extras: ['drone'],
    });
    await expect(page.locator('[data-agr-retainer]')).toHaveText('$51.25');
    await expect(page.locator('[data-agr-balance-row]')).toBeVisible();
    await expect(page.locator('[data-agr-balance]')).toHaveText(`${s.balance}, in cash`);
    await expect(page.locator('[data-agr-later-row], [data-agr-deposit-row]')).toHaveCount(0);
  });

  test('the ready view is built with the hooks of the build spec', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const ready = page.locator('[data-agr-view="ready"]');
    // The brand line, then the title with no label above it, the couple with the date, the booking number.
    await expect(page.locator('header.agr-top')).toHaveText('AD Photography');
    await expect(page.getByText('Private agreement')).toHaveCount(0);
    await expect(page.locator('h1.agr-title[data-agr-title][tabindex="-1"]')).toHaveText(W2.page.title);
    await expect(page.locator('[data-agr-who]')).toHaveText(`Elena and Daniel · ${W2.mixes.share.summary.date}`);
    await expect(page.locator('[data-agr-booking]')).toHaveText('Booking KK-TEST-2026-007');
    expect(
      await ready.evaluate((v) =>
        Array.from(v.children, (c) =>
          c.querySelector('[data-agr-title]') ? 'hero' : c.matches('[data-agr-lede]') ? 'lede' : c.querySelector('h2 + [data-agr-glance]') ? 'glance' : c.matches('form[data-agr-form][novalidate]') ? 'form' : c.tagName,
        ),
      ),
    ).toEqual(['hero', 'lede', 'glance', 'form']);
    await expect(page.locator('[data-agr-glance]').locator('xpath=preceding-sibling::h2')).toHaveText('At a glance');
    await expect(page.locator('form[data-agr-form] nav[aria-labelledby] > h2')).toHaveText('Contents');
    await expect(page.locator('form[data-agr-form] [data-agr-doc] + section#sign[data-agr-signbox][aria-labelledby="agr-sign-title"]')).toHaveCount(1);
    // Three groups of controls; the sign block's holds only the name field and the agree card.
    expect(
      await page.locator('fieldset[data-agr-controls]').evaluateAll((fs) =>
        fs.map((f) => Array.from(f.querySelectorAll('input'), (i) => i.dataset.agrExtra ?? i.dataset.agrChoice ?? (i.matches('[data-agr-name]') ? 'name' : i.matches('[data-agr-agree]') ? 'agree' : '?'))),
      ),
    ).toEqual([[RAW, INSTAX, CAMERA], ['share', 'private'], ['name', 'agree']]);
    for (const sel of ['[data-agr-error]', '[data-agr-review]', '[data-agr-missing]', '[data-agr-print]', '[data-agr-not-yet]', '[data-agr-dialog]'])
      expect(await ready.locator(sel).evaluate((e) => e.closest('fieldset[data-agr-controls]') === null), sel).toBe(true);
    // Every button but the submit button is type=button.
    expect(await ready.locator('button').evaluateAll((bs) => bs.filter((b) => b.getAttribute('type') !== 'button').map((b) => [b.getAttribute('type'), b.textContent]))).toEqual([
      ['submit', 'Review and sign'],
    ]);
    // The parts, their headings, their contents links and their panels.
    for (const part of W2.page.parts) {
      const sec = page.locator(`section#part-${part.n}[data-agr-part="${part.n}"]`);
      await expect(sec).toHaveAttribute('aria-labelledby', `agr-part-${part.n}-title`);
      await expect(sec.locator('> h2')).toHaveAttribute('id', `agr-part-${part.n}-title`);
      await expect(sec.locator('> h2')).toHaveAttribute('tabindex', '-1');
      await expect(sec.locator('> h2')).toHaveText(`${part.n} ${part.title}`);
      await expect(page.locator(`[data-agr-toc] a[href="#part-${part.n}"] > span`)).toHaveText([String(part.n), part.title]);
      await expect(sec.locator(`> div#agr-full-${part.n}.agr-full[data-agr-full="${part.n}"]`)).toHaveCount(1);
      expect(await sec.locator('section.agr-sec').evaluateAll((els) => els.map((e) => e.id))).toEqual(part.sections.map((n) => `sec-${n}`));
      if (part.points.length) await expect(sec.locator(`h3 + ul[data-agr-points="${part.n}"]`).locator('xpath=preceding-sibling::h3')).toHaveText('The main points');
    }
    await expect(page.locator('[data-agr-full="7"] > :last-child')).toHaveAttribute('data-agr-business-signature', '');
    // Part 3: the total line, the price lines, the steps, then the main points.
    expect(
      await page
        .locator('[data-agr-part="3"]')
        .evaluate((s) => Array.from(s.querySelectorAll('[data-agr-total-line], [data-agr-price-lines], [data-agr-pay], [data-agr-points]'), (e) => e.tagName.toLowerCase())),
    ).toEqual(['p', 'dl', 'ol', 'ul']);
    await expect(page.locator('ol.agr-pay[data-agr-pay]')).toHaveAttribute('role', 'list');
    await expect(page.locator('ol.agr-pay[data-agr-pay]')).toHaveAttribute('aria-label', 'Your payments');
    await expect(page.locator('[data-agr-price-lines] > div > dt + dd')).toHaveCount(W2.mixes.share.summary.price_lines!.length);
    // Part 4: the extras block stands where the points stand.
    await expect(page.locator('[data-agr-part="4"] [data-agr-extras-intro]')).toHaveText(W2.page.extras.intro);
    await expect(page.locator('[data-agr-booked]').locator('xpath=preceding-sibling::h3[1]')).toHaveText(W2.page.extras.booked_title);
    await expect(page.locator('[data-agr-booked] > li')).toHaveText(W2.page.extras.booked);
    await expect(page.locator('[data-agr-more]').locator('xpath=preceding-sibling::h3[1]')).toHaveText(W2.page.extras.more_title);
    await expect(page.locator('[data-agr-part="4"] fieldset[data-agr-controls]')).toHaveAttribute('aria-label', 'Extras you can add');
    for (const t of W2.page.extras.ticks) {
      const input = page.locator(`[data-agr-extra="${t.id}"]`);
      await expect(input).toHaveAttribute('type', 'checkbox');
      // The card reads: the label, the price on the right, the blurb below.
      const card = input.locator('xpath=..');
      await expect(card.locator('.agr-opt-title')).toHaveText(t.label);
      await expect(card.locator('.agr-opt-price')).toHaveText(t.price);
      await expect(card.locator('.agr-opt-sub')).toHaveText(t.blurb);
      await expect(card).toHaveText(`${t.label} ${t.price} ${t.blurb}`);
    }
    await expect(page.locator('p[data-agr-extra-status][role="status"]')).toHaveCount(1);
    // Part 5: the sharing fieldset, described by its points, with the two radio cards.
    const sharing = page.locator('fieldset#agr-sharing[data-agr-sharing][data-agr-controls]');
    await expect(sharing.locator('> legend')).toHaveText(W2.page.sharing.legend);
    await expect(page.locator(`#${await sharing.getAttribute('aria-describedby')} > li`)).toHaveText(W2.page.sharing.points);
    for (const c of CHOICE_LIST) {
      await expect(page.locator(`[data-agr-choice="${c}"]`)).toHaveAttribute('type', 'radio');
      await expect(page.locator(`[data-agr-choice="${c}"]`)).toHaveAttribute('name', 'agr-choice');
      const label = c === 'share' ? W2.labels.share_option : W2.labels.private_option;
      const text = page.locator(`[data-agr-${c}-option]`);
      expect(await text.evaluate((e) => e.textContent)).toBe(label);
      await expect(text.locator('> span')).toHaveText([label.slice(0, label.indexOf('. ') + 1), label.slice(label.indexOf('. ') + 1).trim()]);
    }
    await expect(page.locator('p[data-agr-choice-status][role="status"]')).toHaveCount(1);
    // One build for every card: the input, the frame, the drawn mark, the text. The input lies over the whole card.
    expect(
      await page.locator('[data-agr-view="ready"] label.agr-opt').evaluateAll((ls) =>
        ls.map((l) => Array.from(l.children, (c) => `${c.tagName.toLowerCase()}.${c.classList[0]}${c.getAttribute('aria-hidden') === 'true' ? ' hidden' : ''}`).join(', ')),
      ),
    ).toEqual([
      ...['box', 'box', 'box', 'dot', 'dot', 'box'].map((m) => `input.agr-opt-input, span.agr-opt-frame hidden, span.agr-opt-${m} hidden, span.agr-opt-text`),
    ]);
    const fits = await page.locator('[data-agr-view="ready"] label.agr-opt').evaluateAll((ls) =>
      ls.map((l) => {
        l.scrollIntoView({ block: 'center', behavior: 'instant' });
        const input = l.querySelector('input')!;
        const a = l.getBoundingClientRect();
        const b = input.getBoundingClientRect();
        const s = getComputedStyle(input);
        const frame = getComputedStyle(l.querySelector('.agr-opt-frame')!);
        const hit = document.elementFromPoint(a.left + a.width / 2, a.top + a.height / 2) === input;
        return [Math.round(a.width - b.width), Math.round(a.height - b.height), s.position, s.opacity, s.zIndex, s.marginTop, frame.position, frame.pointerEvents, hit].join(' ');
      }),
    );
    expect(fits).toEqual(fits.map(() => '0 0 absolute 0 1 0px absolute none true'));
    // The sign block.
    await expect(page.locator('#sign > h2#agr-sign-title[tabindex="-1"]')).toHaveText('Sign your agreement');
    expect(await page.locator('[data-agr-recap] > div').evaluateAll((ds) => ds.map((d) => d.getAttribute('data-agr-recap-row')))).toEqual(['extras', 'sharing', 'total', 'due']);
    await expect(page.locator('[data-agr-bullets] > li')).toHaveText(W2.labels.intro_bullets);
    await expect(page.locator('label[for="agr-name"]')).toHaveText('Your full legal name');
    const name = page.locator('input#agr-name[data-agr-name]');
    for (const [k, v] of Object.entries({
      type: 'text',
      autocomplete: 'name',
      autocapitalize: 'words',
      autocorrect: 'off',
      spellcheck: 'false',
      enterkeyhint: 'done',
      'aria-describedby': 'agr-signer',
      placeholder: W2.labels.name_expected,
    }))
      await expect(name, k).toHaveAttribute(k, v);
    await expect(page.locator('p#agr-signer[data-agr-signer]')).toHaveText(`Only ${W2.labels.name_expected} can sign this agreement.`);
    expect(await page.locator('[data-agr-agree-label]').evaluate((e) => e.textContent)).toBe(W2.labels.agree_label);
    await expect(page.locator('p[data-agr-error][tabindex="-1"]')).toBeHidden();
    await expect(page.locator('button[type="submit"][data-agr-review][aria-describedby="agr-missing"]')).toHaveText('Review and sign');
    await expect(page.locator('p#agr-missing[data-agr-missing][aria-live="polite"]')).toHaveCount(1);
    await expect(page.locator('#sign')).toContainText(
      'Next you see a short summary of your names, your date and your total. You confirm it, and the agreement is signed. I record the date, the time and the exact text you signed, and I email you a PDF copy right away.',
    );
    const print = page.locator('[data-agr-view="ready"] [data-agr-print]');
    await expect(print).toHaveText('Download a copy (PDF)');
    expect(await print.evaluate((b) => b.parentElement!.querySelector('[data-agr-print-hint][role="status"]') !== null)).toBe(true);
    await expect(page.locator('[data-agr-not-yet]')).toHaveText('Something is wrong, I do not want to sign yet');
    await expect(page.locator('#sign')).toContainText('Questions before you sign? Reply to the email or message Akash on WhatsApp.');
    await expect(page.locator('#sign').getByRole('link', { name: 'WhatsApp' })).toBeVisible();
  });

  test('the styles: hover only where a pointer hovers, no control state from :has(), the site tokens, forced colors', async ({ page, browserName }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    const rules = await page.evaluate(() => {
      const sheet = Array.from(document.styleSheets).find((s) => {
        try {
          return Array.from(s.cssRules).some((r) => r instanceof CSSStyleRule && r.selectorText.includes('.agr-opt-input'));
        } catch {
          return false;
        }
      });
      if (!sheet) return null;
      const out: { sel: string; media: string; text: string }[] = [];
      const walk = (list: CSSRuleList, media: string) => {
        for (const r of Array.from(list)) {
          if (r instanceof CSSMediaRule) walk(r.cssRules, `${media} ${r.media.mediaText}`);
          else if (r instanceof CSSStyleRule) out.push({ sel: r.selectorText, media, text: r.cssText });
        }
      };
      walk(sheet.cssRules, '');
      return out;
    });
    expect(rules).not.toBeNull();
    const css = rules!;
    expect(css.length).toBeGreaterThan(100);
    // Every hover rule sits inside @media (hover: hover).
    expect(css.filter((r) => r.sel.includes(':hover') && !/\(hover: ?hover\)/.test(r.media)).map((r) => r.sel)).toEqual([]);
    // :has() only moves things clear of the TEST ribbon; no control state depends on it.
    expect(css.filter((r) => r.sel.includes(':has(') && !r.sel.split(',').every((s) => s.trim().startsWith('html:has(.agr-ribbon:not([hidden]))'))).map((r) => r.sel)).toEqual([]);
    // Only the site tokens of spec 4.5 (and the site fonts and weights).
    const allowed = [
      '--color-background',
      '--color-surface',
      '--color-surface-dim',
      '--color-surface-container',
      '--color-surface-dark',
      '--color-on-surface',
      '--color-on-surface-variant',
      '--color-on-dark',
      '--color-error',
      '--agr-ok',
      '--font-serif',
      '--font-sans',
      '--fw-regular',
      '--fw-medium',
    ];
    const used = new Set(css.flatMap((r) => [...r.text.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1])));
    expect([...used].filter((v) => !allowed.includes(v))).toEqual([]);
    // The closed panel rule, without !important; forced colors and reduced motion are there.
    expect(css.filter((r) => r.sel === '.agr .agr-full:not([data-agr-open])' && r.media === '').map((r) => r.text)).toEqual([
      '.agr .agr-full:not([data-agr-open]) { display: none; }',
    ]);
    expect(css.filter((r) => /forced-colors: ?active/.test(r.media)).map((r) => r.sel)).toEqual(expect.arrayContaining(['.agr-opt-box, .agr-opt-dot', '.agr-opt-input']));
    expect(css.some((r) => /prefers-reduced-motion: ?reduce/.test(r.media))).toBe(true);
    // Only the two Inter weights (inherit: `font: inherit` on fields and buttons); nothing sticky or fixed but the TEST ribbon.
    const weights = new Set(css.flatMap((r) => [...r.text.matchAll(/font-weight: ([^;]+);/g)].map((m) => m[1].trim())));
    expect([...weights].filter((w) => !['var(--fw-regular)', 'var(--fw-medium)', '400', '500', 'inherit'].includes(w))).toEqual([]);
    expect(css.filter((r) => /position: (sticky|fixed)/.test(r.text)).map((r) => r.sel)).toEqual(['.agr-ribbon']);
    // Type: the serif for the title, the part titles and numbers, the first lede line and the sign title; the sans elsewhere, 17 px on 1.6.
    const type = await page.evaluate(() => {
      const f = (s: string) => getComputedStyle(document.querySelector(s)!);
      return {
        serif: ['[data-agr-title]', '[data-agr-part="3"] > h2', '[data-agr-part="3"] > h2 > span', '[data-agr-lede] > p:first-child', '#sign > h2'].map((s) => f(s).fontFamily),
        sans: ['[data-agr-lede] > p:nth-child(2)', '[data-agr-points="1"] > li', '[data-agr-disc="1"]', '[data-agr-review]', '[data-agr-name]', '#agr-glance-title', '#sec-1 > h3'].map(
          (s) => f(s).fontFamily,
        ),
        size: [f('main.agr').fontSize, f('main.agr').lineHeight, f('[data-agr-name]').fontSize].map((v) => Math.round(parseFloat(v) * 10) / 10),
      };
    });
    for (const ff of type.serif) expect(ff).toMatch(/^"?Noir et Blanc"?,/);
    for (const ff of type.sans) expect(ff).toMatch(/^"?Inter"?,/);
    expect(type.size).toEqual([17, 27.2, 17]);
    // Shapes of the approved picture.
    const radius = await page.evaluate(() =>
      Object.fromEntries(
        [
          ['card', 'label.agr-opt'],
          ['glance', '[data-agr-glance]'],
          ['step', '[data-agr-pay] > li'],
          ['panel', '[data-agr-full="1"]'],
          ['sign', '#sign'],
          ['dialog', '[data-agr-dialog]'],
          ['primary', '[data-agr-review]'],
          ['disc', '[data-agr-disc="1"]'],
          ['field', '[data-agr-name]'],
          ['contents link', '[data-agr-toc] a'],
          ['tick', '.agr-opt-box'],
          ['radio', '.agr-opt-dot'],
        ].map(([k, s]) => [k, getComputedStyle(document.querySelector(s)!).borderTopLeftRadius]),
      ),
    );
    expect(radius).toEqual({
      card: '14px',
      glance: '14px',
      step: '14px',
      panel: '14px',
      sign: '18px',
      dialog: '18px',
      primary: '999px',
      disc: '999px',
      field: '10px',
      'contents link': '8px',
      tick: '6px',
      radio: '50%',
    });
    // The page container: up to 1200 px, side padding clamp(16px, 4vw, 48px).
    const box = await page.evaluate(() => {
      const s = getComputedStyle(document.querySelector('main.agr')!);
      return { max: s.maxWidth, left: parseFloat(s.paddingLeft), right: parseFloat(s.paddingRight), vw: window.innerWidth };
    });
    expect(box.max).toBe('1200px');
    expect(box.left).toBeCloseTo(Math.min(48, Math.max(16, box.vw * 0.04)), 1);
    expect(box.right).toBeCloseTo(box.left, 3);
    // A phone with a notch, turned sideways: the page lies under the camera housing (viewport-fit=cover), so the
    // side padding is at least the safe area. No test browser has a notch: the rule itself is checked.
    const agrRule = css.filter((r) => r.sel === '.agr' && r.media === '').map((r) => r.text).join(' ');
    expect(agrRule).toMatch(/padding-left: max\(clamp\(16px, 4vw, 48px\), env\(safe-area-inset-left/);
    expect(agrRule).toMatch(/padding-right: max\(clamp\(16px, 4vw, 48px\), env\(safe-area-inset-right/);
    // Off: the primary button with nothing done yet.
    expect(await page.locator('[data-agr-review]').evaluate((b) => [getComputedStyle(b).backgroundColor, getComputedStyle(b).color, getComputedStyle(b).cursor])).toEqual([
      'rgb(228, 226, 225)',
      'rgb(92, 96, 92)',
      'not-allowed',
    ]);
    if (browserName === 'chromium') {
      // Forced colors: the drawn marks give way to the native inputs.
      await page.emulateMedia({ forcedColors: 'active' });
      const raw = page.locator(`[data-agr-extra="${RAW}"]`);
      expect(await raw.evaluate((i) => [getComputedStyle(i.parentElement!.querySelector('.agr-opt-box')!).display, getComputedStyle(i).opacity, getComputedStyle(i).position])).toEqual([
        'none',
        '1',
        'static',
      ]);
      await page.emulateMedia({ forcedColors: 'none' });
      // Hover on a pointer that hovers: the card border darkens.
      const frame = () => raw.evaluate((i) => getComputedStyle(i.parentElement!.querySelector('.agr-opt-frame')!).borderTopColor);
      // (The frame's border colour moves in 150 ms, also back from forced colors.)
      await expect.poll(frame).toBe('rgb(228, 226, 225)');
      await raw.locator('xpath=..').hover();
      await expect.poll(frame).toBe('rgb(92, 96, 92)');
    }
    // Busy: the spinner and the progress cursor while the PDF is made.
    let release: () => void = () => {};
    let asked = 0;
    await page.route('**/r/agreement/pdf**', async (route) => {
      asked += 1;
      await new Promise<void>((r) => (release = r));
      return route.fulfill({ status: 200, headers: { 'content-type': 'application/pdf' }, body: PDF });
    });
    const button = page.getByRole('button', { name: 'Download a copy (PDF)' });
    const download = page.waitForEvent('download');
    await button.click();
    await expect.poll(() => asked).toBe(1);
    await expect(button).toHaveAttribute('aria-busy', 'true');
    expect(await button.evaluate((b) => [getComputedStyle(b).cursor, getComputedStyle(b, '::after').content, getComputedStyle(b, '::after').animationName])).toEqual([
      'progress',
      '""',
      'agr-spin',
    ]);
    release();
    await download;
    // Wrong: a name the server refused gives the field the error border, and the error box a full border.
    await page.route('**/r/agreement/sign', (route) => reply(route, 400, { ok: false, error: 'name_mismatch' }));
    await fillReady(page, 'share', 'Elena M');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(page.locator('[data-agr-error]')).toBeVisible();
    await expect(page.locator('[data-agr-name]')).toHaveAttribute('aria-invalid', 'true');
    // (The field's border colour moves in 150 ms.)
    await expect.poll(() => page.locator('[data-agr-name]').evaluate((e) => getComputedStyle(e).borderTopColor)).toBe('rgb(158, 66, 44)');
    expect(
      await page.locator('[data-agr-error]').evaluate((e) => {
        const s = getComputedStyle(e);
        return [s.borderLeftWidth, s.borderTopWidth, s.borderTopStyle, s.borderTopColor, s.borderTopLeftRadius];
      }),
    ).toEqual(['1px', '1px', 'solid', 'rgb(158, 66, 44)', '14px']);
  });

  test('a fast double tap on "Review and sign" opens the review and neither signs nor closes it; Escape still closes it', async ({ page }) => {
    // On a phone both buttons are full width, so a button of the review can open right under the finger.
    await page.setViewportSize({ width: 360, height: 640 });
    await mockDoc(page, [[200, W2.ready]]);
    let posts = 0;
    await page.route('**/r/agreement/sign', (route) => {
      posts += 1;
      return reply(route, 200, W2.signed('share'));
    });
    await page.goto(PATH);
    await fillReady(page, 'share', 'Elena Marchetti');
    const review = page.locator('[data-agr-review]');
    const sign = page.locator('[data-agr-sign]');
    const back = page.locator('[data-agr-back]');
    const dlg = page.locator('[data-agr-dialog]');
    // Where the two buttons of the review open: open it once, measure them, go back.
    await review.click();
    await expect(dlg).toBeVisible();
    const centre = async (l: Locator) => {
      const b = (await l.boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const signAt = await centre(sign);
    const backAt = await centre(back);
    await back.click();
    await expect(dlg).toBeHidden();
    /** Brings "Review and sign" to that very place on screen and double taps it there. */
    const doubleTapAt = async ({ x, y }: { x: number; y: number }) => {
      await review.evaluate((b, target) => {
        const r = b.getBoundingClientRect();
        window.scrollBy({ top: r.top + r.height / 2 - target, behavior: 'instant' as ScrollBehavior });
      }, y);
      const under = (await review.boundingBox())!;
      expect(x > under.x && x < under.x + under.width && y > under.y && y < under.y + under.height).toBe(true);
      await page.mouse.dblclick(x, y);
    };
    // 1. The second tap lands on "Sign the agreement": nothing is signed.
    await doubleTapAt(signAt);
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(800);
    expect(posts).toBe(0);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(sign).toHaveText('Sign the agreement');
    await expect(dlg).toBeVisible();
    // A later press on "Go back" closes it.
    await back.click();
    await expect(dlg).toBeHidden();
    // 2. The second tap lands on "Go back": the review stays open and nothing is posted.
    await doubleTapAt(backAt);
    await expect(dlg).toBeVisible();
    await page.waitForTimeout(800);
    await expect(dlg).toBeVisible();
    expect(posts).toBe(0);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    // A later press on "Go back" closes it.
    await back.click();
    await expect(dlg).toBeHidden();
    await expect(review).toBeFocused();
    // Escape closes the review at any time while no request is out, in its first moment too.
    await page.evaluate(() =>
      document.addEventListener(
        'keydown',
        (e) => {
          if (e.key === 'Escape') (window as unknown as { guard: unknown }).guard = document.querySelector('[data-agr-back]')!.getAttribute('aria-disabled');
        },
        true,
      ),
    );
    await review.click();
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    expect(await page.evaluate(() => (window as unknown as { guard: unknown }).guard)).toBe('true');
    expect(posts).toBe(0);
    // A press made after a look at the review signs, once.
    await review.click();
    await expect(dlg).toBeVisible();
    await sign.click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(posts).toBe(1);
  });

  test('before a sharing choice, section 1 shows the booking table of exactly the boxes ticked', async ({ page }) => {
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await page.locator('[data-agr-disc="1"]').click();
    const rowsOf = (sel: string) =>
      page.locator(sel).evaluateAll((trs) => trs.map((tr) => Array.from((tr as HTMLTableRowElement).cells, (td) => td.textContent)));
    // The wedding has a fee for private work: section 1 differs in more than its sharing row, so both tables show.
    for (const ids of subsetsOf(tickIds(W2))) {
      await setTicks(page, W2, ids);
      const label = ids.join('+') || 'nothing ticked';
      await expect(page.locator('#sec-1 [data-agr-variant]'), label).toHaveCount(2);
      await expect(page.locator('#sec-1 [data-agr-variant="share"] table'), label).toBeVisible();
      await expect.poll(() => rowsOf('#sec-1 [data-agr-variant="share"] table tr'), label).toEqual(bookingRows(W2.docs[mixId('share', ids)]));
      await expect.poll(() => rowsOf('#sec-1 [data-agr-variant="private"] table tr'), label).toEqual(bookingRows(W2.docs[mixId('private', ids)]));
    }
    // The civil ceremony: section 1 differs only in the sharing row, so it shows once, that row undecided.
    await page.unrouteAll();
    await mockDoc(page, [[200, C2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    for (const ids of subsetsOf(tickIds(C2))) {
      await setTicks(page, C2, ids);
      const label = ids.join('+') || 'nothing ticked';
      const want = bookingRows(C2.docs[mixId('share', ids)]).map((r) => (r[0] === 'Sharing choice (section 15)' ? [r[0], 'You choose this in part 5.'] : r));
      expect(want.some((r) => r[1] === 'You choose this in part 5.'), label).toBe(true);
      await expect(page.locator('#sec-1 [data-agr-variant]'), label).toHaveCount(0);
      await expect.poll(() => rowsOf('#sec-1 table tr'), label).toEqual(want);
    }
  });

  test('a booking with extras booked up front: fewer tick boxes and the booked lines; with all booked, nothing to tick', async ({ page }) => {
    // Nothing booked up front: no booked lines.
    await mockDoc(page, [[200, C2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    await expect(page.locator('[data-agr-booked]')).toHaveCount(0);
    await expect(page.locator('[data-agr-extras] > h3')).toHaveText([C2.page.extras.more_title]);

    // The wedding with RAW photos booked: two boxes left, the booked line, the RAW point of part 5 says booked.
    await page.unrouteAll();
    await mockDoc(page, [[200, W_RAW.ready]]);
    let body: Record<string, unknown> = {};
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, W_RAW.signed('private', [INSTAX]));
    });
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    expect(tickIds(W_RAW)).toEqual([INSTAX, CAMERA]);
    expect(Object.keys(W_RAW.mixes)).toHaveLength(8);
    expect(await page.locator('[data-agr-extra]').evaluateAll((is) => is.map((i) => (i as HTMLElement).dataset.agrExtra))).toEqual([INSTAX, CAMERA]);
    await expect(page.locator('[data-agr-extras-intro]')).toHaveText(W_RAW.page.extras.intro);
    await expect(page.locator('[data-agr-extras] > h3')).toHaveText([W_RAW.page.extras.booked_title, W_RAW.page.extras.more_title]);
    await expect(page.locator('[data-agr-booked] li')).toHaveText(W_RAW.page.extras.booked);
    await expect(page.locator('[data-agr-booked] li')).toHaveText(['RAW photos, 1 × $121.25 = $121.25']);
    await expect(page.locator('[data-agr-points="5"] li')).toHaveText(W_RAW.page.parts[4].points);
    await expect(page.locator('[data-agr-points="5"]')).toContainText('RAW files are in your booking. They are in your total in part 3.');
    await expect(page.locator('[data-agr-points="5"]')).not.toContainText('You can add them in part 4');
    for (const choice of CHOICE_LIST)
      for (const ids of subsetsOf(tickIds(W_RAW))) {
        const id = mixId(choice, ids);
        await setTicks(page, W_RAW, ids);
        await page.locator(`[data-agr-choice="${choice}"]`).check();
        await expectMix(page, W_RAW, id, titleOf(choice));
        await expectShownText(page, W_RAW.docs[id], id);
      }
    await setTicks(page, W_RAW, [INSTAX]);
    await fillReady(page, 'private', 'Elena Marchetti');
    await page.locator('[data-agr-review]').click();
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({
      k: TOKEN,
      choice: 'private',
      signed_name: 'Elena Marchetti',
      agree: true,
      text_hash: sha256(W_RAW.docs[mixId('private', [INSTAX])]),
      extras: [INSTAX],
    });

    // The civil ceremony with all three booked: page content, the booked lines, and nothing to tick.
    await page.unrouteAll();
    await mockDoc(page, [[200, C_ALL.ready]]);
    await page.route('**/r/agreement/sign', (route) => {
      body = route.request().postDataJSON();
      return reply(route, 200, C_ALL.signed('private'));
    });
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    expect(tickIds(C_ALL)).toEqual([]);
    expect(Object.keys(C_ALL.mixes)).toEqual(['share', 'private']);
    await expect(page.locator('[data-agr-extra], [data-agr-extras-intro], [data-agr-extra-status]')).toHaveCount(0);
    await expect(page.locator('[data-agr-part="4"] fieldset')).toHaveCount(0);
    await expect(page.locator('[data-agr-booked] li')).toHaveText(C_ALL.page.extras.booked);
    expect(C_ALL.page.extras.booked).toHaveLength(3);
    await expect(page.locator('[data-agr-more] li')).toHaveText(C_ALL.page.extras.more);
    await expect(page.locator('[data-agr-points="5"]')).toContainText('RAW files are in your booking. They are in your total in part 3.');
    await expect(page.locator('[data-agr-recap] > div > dt')).toHaveText(['Sharing', 'Total', 'Due today, the retainer']);
    const s = C_ALL.mixes.private.summary;
    await fillReady(page, 'private');
    await expect(page.locator('[data-agr-glance-total]')).toHaveText(s.total);
    await expect(page.locator('[data-agr-price-lines] dt')).toHaveText(s.price_lines!.map((l) => l.label));
    await expect(page.locator('[data-agr-recap-row="total"] dd')).toHaveText(s.total);
    await expectShownText(page, C_ALL.docs.private, 'private');
    await page.locator('[data-agr-review]').click();
    await expect(page.locator('[data-agr-review-rows] > div > dt')).toHaveText(['Your name', 'Your partner', 'Package', 'Date', 'Total', 'Retainer', 'Sharing']);
    await page.locator('[data-agr-sign]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(body).toEqual({ k: TOKEN, choice: 'private', signed_name: 'Priya Sharma', agree: true, text_hash: sha256(C_ALL.docs.private) });
  });

  test('the looks of the picture: title spacing, no room for an empty status line, medium bold, the small values', async ({ page }) => {
    const viewport = page.viewportSize()!;
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    // The document title at the top of the part 1 panel: the sans, medium weight, its size clamp(1.5rem, 3vw, 1.875rem).
    await page.locator('[data-agr-disc="1"]').click();
    const docTitle = await page.locator('[data-agr-doc-title]').evaluate((e) => {
      const s = getComputedStyle(e);
      return { family: s.fontFamily, weight: s.fontWeight, size: parseFloat(s.fontSize), vw: window.innerWidth };
    });
    expect(docTitle.family).toMatch(/^"?Inter"?,/);
    expect(docTitle.weight).toBe('500');
    expect(docTitle.size).toBeCloseTo(Math.min(30, Math.max(24, docTitle.vw * 0.03)), 1);
    await page.locator('[data-agr-disc="1"]').click();
    await expect(page.locator('[data-agr-full="1"]')).toBeHidden();
    await page.locator('[data-agr-disc="2"]').click();
    const m = await page.evaluate(() => {
      const q = (s: string) => document.querySelector<HTMLElement>(s)!;
      const r = (s: string) => q(s).getBoundingClientRect();
      const cs = (s: string) => getComputedStyle(q(s));
      // The gap between a clause number and the first letter of its clause.
      const n = q('#sec-2 p.agr-clause .agr-n');
      const after = n.nextSibling as Text;
      const range = document.createRange();
      const lead = after.data.length - after.data.trimStart().length;
      range.setStart(after, lead);
      range.setEnd(after, lead + 1);
      return {
        title: [parseFloat(cs('[data-agr-title]').letterSpacing), parseFloat(cs('[data-agr-title]').fontSize)],
        // Part 5: the sharing cards, the empty choice status, the disclosure button.
        sharingToDisc: r('[data-agr-disc="5"]').top - r('[data-agr-sharing]').bottom,
        // Part 4: the tick cards, the empty extra status, the "More extras" heading; each heading close to its own list.
        ticksToMore: r('[data-agr-extras] > h3:last-of-type').top - r('[data-agr-extras] > fieldset').bottom,
        bookedHead: r('[data-agr-booked]').top - r('[data-agr-extras] > h3:first-of-type').bottom,
        moreHead: r('[data-agr-more]').top - r('[data-agr-extras] > h3:last-of-type').bottom,
        strong: cs('#sec-0 strong').fontWeight,
        secMargin: cs('#sec-1').scrollMarginTop,
        pointsTitle: cs('[data-agr-part="1"] .agr-points__title').lineHeight,
        biz: [cs('[data-agr-business-signature]').fontSize, cs('[data-agr-business-signature]').marginTop],
        controlsGap: cs('#sign fieldset[data-agr-controls]').rowGap,
        linkRadius: cs('[data-agr-points] a').borderTopLeftRadius,
        numberGap: range.getBoundingClientRect().left - n.getBoundingClientRect().right,
      };
    });
    // The title's tight spacing, -0.01em, as in the picture.
    expect(m.title[0]).toBeCloseTo(-0.01 * m.title[1], 2);
    expect(Math.round(m.sharingToDisc)).toBe(24);
    // Part 4, the picture's values: 24 px from the tick cards to the next heading, 10 px from a heading to its own list.
    expect(Math.round(m.ticksToMore)).toBe(24);
    expect([Math.round(m.bookedHead), Math.round(m.moreHead)]).toEqual([10, 10]);
    // Inter has no 700 on this site: bold words in the clauses are the medium weight.
    expect(m.strong).toBe('500');
    expect(m.secMargin).toBe('0px');
    // 1.6 x 17 px (WebKit gives 27.200001px).
    expect(parseFloat(m.pointsTitle)).toBeCloseTo(27.2, 2);
    expect(m.biz).toEqual(['17px', '14px']);
    expect(m.controlsGap).toBe('28px');
    expect(m.linkRadius).toBe('6px');
    expect(m.numberGap).toBeGreaterThan(5);
    expect(m.numberGap).toBeLessThan(7.5);
    // After a tick the status line has its text and its own room again: 24 px under the cards, 24 px over the next heading.
    await page.locator(`[data-agr-extra="${RAW}"]`).check();
    await expect(page.locator('[data-agr-extra-status]')).not.toHaveText('');
    expect(
      await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        return [
          Math.round(r('[data-agr-extra-status]').top - r('[data-agr-extras] > fieldset').bottom),
          Math.round(r('[data-agr-extras] > h3:last-of-type').top - r('[data-agr-extra-status]').bottom),
        ];
      }),
    ).toEqual([24, 24]);
    // The recap rows of the sign card stack below 640 px; the tables of the text keep their 560 px.
    const recapStacked = () =>
      page.locator('[data-agr-recap] > div').evaluateAll((ds) =>
        ds.map((d) => {
          const t = d.querySelector('dt')!.getBoundingClientRect();
          const a = d.querySelector('dd')!.getBoundingClientRect();
          return a.top >= t.bottom - 0.5 && Math.abs(a.left - t.left) <= 1;
        }),
      );
    await page.setViewportSize({ width: 600, height: 900 });
    expect(await recapStacked()).toEqual([true, true, true, true]);
    expect(await page.locator('#sec-1 table.agr-table td').first().evaluate((e) => getComputedStyle(e).display)).toBe('table-cell');
    await page.setViewportSize({ width: 640, height: 900 });
    expect(await recapStacked()).toEqual([false, false, false, false]);
    await page.setViewportSize(viewport);
    // The Send button of "not yet": full width below 640 px only, like every primary button.
    await page.locator('[data-agr-not-yet]').click();
    await expect(main(page)).toHaveAttribute('data-agr-state', 'not-yet');
    const send = await page.locator('[data-agr-fix-send]').evaluate((b) => {
      const form = b.parentElement!;
      const s = getComputedStyle(form);
      return { w: b.getBoundingClientRect().width, room: form.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight), vw: window.innerWidth };
    });
    if (send.vw >= 640) expect(send.w).toBeLessThan(send.room / 2);
    else expect(Math.abs(send.w - send.room)).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Back to the agreement' }).click();
    // At 360 px every disclosure label stays on one line inside its pill, two digit counts too.
    await page.setViewportSize({ width: 360, height: 740 });
    await page.locator('[data-agr-disc="2"]').click();
    const discs = await page.locator('[data-agr-disc]').evaluateAll((bs) => bs.map((b) => [b.textContent, Math.round(b.getBoundingClientRect().height)]));
    expect(discs.filter(([t]) => /\(\d\d points\)/.test(String(t))).length).toBeGreaterThan(3);
    expect(discs.filter(([, h]) => Number(h) > 48)).toEqual([]);
    // Part 4 with everything booked (no tick cards): "More extras" sits 24 px under the booked list.
    await page.setViewportSize(viewport);
    await page.unrouteAll();
    await mockDoc(page, [[200, C_ALL.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    expect(
      await page.evaluate(() => {
        const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
        return [
          Math.round(r('[data-agr-booked]').top - r('[data-agr-extras] > h3:first-of-type').bottom),
          Math.round(r('[data-agr-extras] > h3:last-of-type').top - r('[data-agr-booked]').bottom),
          Math.round(r('[data-agr-more]').top - r('[data-agr-extras] > h3:last-of-type').bottom),
        ];
      }),
    ).toEqual([10, 24, 10]);
    // The signed copy: bold words in the medium weight too.
    await page.unrouteAll();
    await mockDoc(page, [[200, W2.signed('share')]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'signed');
    expect(await page.locator('[data-agr-signed-doc] strong').first().evaluate((e) => getComputedStyle(e).fontWeight)).toBe('500');
    // The signed view: no label above a title and no uppercase label. "Signed on ... at ..." sits right under
    // the h1 (the "already signed" line, when shown, stays first); the small captions are normal case.
    const head = await page.evaluate(() => {
      const view = document.querySelector('[data-agr-view="signed"]')!;
      const h1 = view.querySelector('[data-agr-thanks]')!;
      const ok = view.querySelector('.agr-ok')!;
      const look = (e: Element) => {
        const s = getComputedStyle(e);
        return [s.textTransform, s.letterSpacing, s.fontSize, s.fontWeight, s.color].join(' ');
      };
      return {
        order: Array.from(h1.parentElement!.children, (c) =>
          c.matches('[data-agr-already]') ? 'already' : c === h1 ? 'h1' : c === ok ? 'signed on' : c.matches('[data-agr-copy-line]') ? 'copy' : c.tagName,
        ),
        after: Boolean(h1.compareDocumentPosition(ok) & Node.DOCUMENT_POSITION_FOLLOWING),
        ok: look(ok),
        okText: ok.textContent!.trim(),
        caps: Array.from(view.querySelectorAll('.agr-cap'), (c) => [c.textContent, look(c)]),
      };
    });
    expect(head.order).toEqual(['already', 'h1', 'signed on', 'copy']);
    expect(head.after).toBe(true);
    expect(head.okText).toBe('Signed on 10 November 2026 at 10:00 am');
    expect(head.ok).toBe('none normal 15px 500 rgb(47, 107, 58)');
    expect(head.caps.map(([t]) => t)).toEqual(['Step 1 · Retainer', `Step 2 · ${W2.labels.after_signing.title}`, 'AD Photography', 'You']);
    for (const [t, l] of head.caps) expect(l, String(t)).toBe('none normal 15px 500 rgb(92, 96, 92)');
  });

  test('without the site colour tokens (an old Safari drops the theme layer) the drawn marks, the chosen card, the review button, the name field, the error box and the disclosure button keep their states', async ({ page }) => {
    // No transitions: every value is final at once.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await expect(main(page)).toHaveAttribute('data-agr-state', 'ready');
    // Tailwind writes the tokens in @layer theme. A browser without cascade layers (Safari before 15.4, the
    // phones of the inline review) never sees them: here every colour token the page uses is unset.
    await page.addStyleTag({
      content:
        ':root{--color-background:initial;--color-surface:initial;--color-surface-dim:initial;--color-surface-container:initial;--color-surface-dark:initial;--color-on-surface:initial;--color-on-surface-variant:initial;--color-on-dark:initial;--color-error:initial}',
    });
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('main.agr')!).getPropertyValue('--color-surface-dark').trim())).toBe('');
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await page.locator('[data-agr-choice="private"]').check();
    // (Off every card: a pointer that hovers would give the card under it its hover colours.)
    const look = async () => {
      await page.mouse.move(1, 1);
      return page.evaluate(() => {
        const card = (sel: string) => document.querySelector(sel)!.parentElement!;
        const cs = (root: Element, sel: string) => getComputedStyle(root.querySelector(sel)!);
        const line = (s: CSSStyleDeclaration) => `${s.borderTopStyle} ${s.borderTopColor}`;
        const chosen = card('[data-agr-choice="private"]');
        const other = card('[data-agr-choice="share"]');
        const ticked = card('[data-agr-extra="guest-camera"]');
        const plain = card('[data-agr-extra="raw-photos-wedding"]');
        const review = getComputedStyle(document.querySelector('[data-agr-review]')!);
        return {
          chosenDot: [cs(chosen, '.agr-opt-dot .agr-opt-mark').backgroundColor, cs(chosen, '.agr-opt-dot .agr-opt-mark').opacity, line(cs(chosen, '.agr-opt-dot'))],
          otherDot: [cs(other, '.agr-opt-dot .agr-opt-mark').opacity, line(cs(other, '.agr-opt-dot'))],
          chosenFrame: [line(cs(chosen, '.agr-opt-frame')), cs(chosen, '.agr-opt-frame').boxShadow.includes('inset')],
          otherFrame: [line(cs(other, '.agr-opt-frame')), cs(other, '.agr-opt-frame').boxShadow],
          tickedBox: [cs(ticked, '.agr-opt-box').backgroundColor, line(cs(ticked, '.agr-opt-box')), cs(ticked, '.agr-opt-mark').color, cs(ticked, '.agr-opt-mark').opacity],
          plainBox: [cs(plain, '.agr-opt-box').backgroundColor, line(cs(plain, '.agr-opt-box')), cs(plain, '.agr-opt-mark').opacity],
          review: [review.backgroundColor, review.color],
        };
      });
    };
    const off = await look();
    expect(off.chosenDot).toEqual(['rgb(44, 40, 36)', '1', 'solid rgb(44, 40, 36)']);
    expect(off.otherDot).toEqual(['0', 'solid rgb(92, 96, 92)']);
    expect(off.chosenFrame).toEqual(['solid rgb(26, 26, 24)', true]);
    expect(off.otherFrame).toEqual(['solid rgb(228, 226, 225)', 'none']);
    expect(off.tickedBox).toEqual(['rgb(44, 40, 36)', 'solid rgb(44, 40, 36)', 'rgb(250, 249, 246)', '1']);
    expect(off.plainBox).toEqual(['rgb(255, 255, 255)', 'solid rgb(92, 96, 92)', '0']);
    // The review button: off, then on once the name and the agree tick are there.
    expect(off.review).toEqual(['rgb(228, 226, 225)', 'rgb(92, 96, 92)']);
    // The name field still looks like a field, and its placeholder (the expected name) stays grey, so it
    // never reads as a name already typed. The error box stays red. The "Read the full wording" button
    // keeps its frame and its open look.
    const rest = await page.evaluate(() => {
      const line = (s: CSSStyleDeclaration) => `${s.borderTopStyle} ${s.borderTopColor}`;
      const name = getComputedStyle(document.querySelector('[data-agr-name]')!);
      const error = getComputedStyle(document.querySelector('[data-agr-error]')!);
      const disc = getComputedStyle(document.querySelector('[data-agr-disc="1"]')!);
      // getComputedStyle cannot read ::placeholder in every engine: read the page's own rule.
      let placeholder = '';
      for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
          rules = sheet.cssRules;
        } catch {
          continue;
        }
        for (const r of Array.from(rules))
          if (r instanceof CSSStyleRule && r.selectorText === '.agr-input::placeholder') placeholder = r.style.getPropertyValue('color');
      }
      return {
        name: [line(name), name.backgroundColor],
        error: [line(error), error.color],
        disc: [line(disc), disc.backgroundColor],
        placeholder,
      };
    });
    expect(rest.name).toEqual(['solid rgb(92, 96, 92)', 'rgb(255, 255, 255)']);
    expect(rest.error).toEqual(['solid rgb(158, 66, 44)', 'rgb(158, 66, 44)']);
    expect(rest.disc).toEqual(['solid rgb(228, 226, 225)', 'rgb(255, 255, 255)']);
    expect(rest.placeholder.replace(/\s+/g, '')).toBe('var(--color-on-surface-variant,#5c605c)');
    await page.locator('[data-agr-disc="1"]').click();
    await page.mouse.move(1, 1);
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('[data-agr-disc="1"]')!).backgroundColor)).toBe('rgb(244, 244, 240)');
    await page.locator('[data-agr-disc="1"]').click();
    await page.locator('[data-agr-name]').fill('Elena Marchetti');
    await page.locator('[data-agr-agree]').check();
    await expect(page.locator('[data-agr-review]')).toBeEnabled();
    expect((await look()).review).toEqual(['rgb(44, 40, 36)', 'rgb(250, 249, 246)']);
  });

  test('without <dialog>, Go back at the end of the long inline review brings "Review and sign" back on screen, clear of the ribbon', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.addInitScript(() => {
      delete (window as unknown as Record<string, unknown>).HTMLDialogElement;
    });
    await mockDoc(page, [[200, W2.ready]]);
    await page.goto(PATH);
    await page.locator(`[data-agr-extra="${CAMERA}"]`).check();
    await fillReady(page, 'private', 'Elena Marchetti');
    const review = page.locator('[data-agr-review]');
    await review.click();
    const panel = page.locator('[data-agr-dialog]');
    await expect(panel).toHaveClass(/agr-review--inline/);
    await expect(panel).toBeVisible();
    // The client reads down to the buttons at the end of the panel and presses Go back there.
    const back = page.locator('[data-agr-back]');
    await back.evaluate((e) => e.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior }));
    await back.click();
    await expect(panel).toBeHidden();
    await expect(review).toBeFocused();
    await settledTop(review);
    const at = await review.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, ribbon: document.querySelector('[data-agr-ribbon]')!.getBoundingClientRect().bottom, h: window.innerHeight };
    });
    expect(at.top).toBeGreaterThanOrEqual(at.ribbon);
    expect(at.bottom).toBeLessThanOrEqual(at.h);
  });

  test('in test mode, after a refused name the focused error box lands clear of the ribbon', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 360 });
    await mockDoc(page, [[200, W2.ready]]);
    await page.route('**/r/agreement/sign', (route) => reply(route, 400, { ok: false, error: 'name_mismatch' }));
    await page.goto(PATH);
    await fillReady(page, 'share', 'Elena Marchet');
    await page.locator('[data-agr-review]').click();
    await expect(page.locator('[data-agr-dialog]')).toBeVisible();
    // The page behind the review moves a little (a scroll on the backdrop): "Review and sign" ends 40 px above
    // the top edge. The error box opens in its place, so it is cut by the top edge, and focusing it brings its
    // top edge in (Chromium aligns a box that is partly on screen to the nearest edge).
    const top0 = await page.locator('[data-agr-review]').evaluate((b) => {
      window.scrollBy({ top: b.getBoundingClientRect().top + 40, behavior: 'instant' as ScrollBehavior });
      return b.getBoundingClientRect().top;
    });
    expect(top0).toBeGreaterThan(-45);
    expect(top0).toBeLessThan(-35);
    await page.locator('[data-agr-sign]').click();
    const error = page.locator('[data-agr-error]');
    await expect(error).toBeFocused();
    await expect(error).toContainText('Please type your name exactly as it is written here: Elena Marchetti.');
    const top = await settledTop(error);
    const ribbon = await page.locator('[data-agr-ribbon]').evaluate((e) => e.getBoundingClientRect().bottom);
    expect(top).toBeGreaterThanOrEqual(ribbon);
    // The error box and the review button are jump targets too: 56 px under the top while the ribbon shows.
    expect(await page.evaluate(() => ['[data-agr-error]', '[data-agr-review]'].map((s) => getComputedStyle(document.querySelector(s)!).scrollMarginTop))).toEqual(['56px', '56px']);
  });
});
