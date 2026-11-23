// Page script for the private agreement page (/welcome/agreement/?k=<token>).
//
// 1. Read the booking by its token (doc answer v=2). A signed link opens straight in the signed state.
// 2. Build one model from either answer shape (agreement-model.ts): every mix's exact text, hash and
//    amounts, all checked before anything shows. The ready view (agreement-ready.ts) shows the mix of
//    the sharing choice and the ticked extras; before a choice, the share mix, and sections that differ
//    between the two choices show both versions.
// 3. Review and sign: the fingerprint sent is the SHA-256 of the shown mix's doc_json, the very string
//    the server hashed. Every group of controls is locked while the review is open inline and while the
//    request is out, so what is reviewed is what is posted. The two buttons of the review take no press in
//    the first 600 ms after it opens, so a double tap on "Review and sign" can neither sign unseen nor close
//    the review at once. Escape still closes it at any time while no request is out.
// 4. Thank you state, with the retainer details and the signed text, read only.
//
// This file may import only html.ts, hash.ts, token.ts, format.ts, set.ts, parts.ts and types from
// src/lib/agreement/ (also through the agreement-*.ts modules), so the clause file never ships.
import { sha256Hex } from '../lib/agreement/hash';
import type { AgreementDoc, Choice, StoredSummary } from '../lib/agreement/types';
import { CHOICES, renderSignedDoc } from './agreement-doc';
import { buildModel, type Base, type Model, type ReadyPayload } from './agreement-model';
import { buildReady, clearReady, depositText, extrasText, type ReadyView, type Selection, type Source } from './agreement-ready';

type State = 'loading' | 'ready' | 'signed' | 'not-yet' | 'gone' | 'error';

interface SignedPayload extends Base {
  status: 'signed';
  signed: { choice: Choice; signed_name: string; date: string; time: string; final_doc_json: string; final_hash: string };
  copy: { status: string; to: string };
  already?: boolean;
}
/** status 0 means the request never got an answer. */
interface Answer {
  status: number;
  body: Record<string, any> | null;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const POLL_MS = 5000;
const POLL_MAX = 24;
const SIGN_TIMEOUT_MS = 30000;
const PDF_TIMEOUT_MS = 45000; // the worker may wait up to 25 s for Apps Script to make the PDF
const PDF_URL_KEEP_MS = 60000; // some browsers read the object URL after click() returns
// On a phone a button of the review ("Sign the agreement" or "Go back") can open right under the finger that
// pressed "Review and sign": the second tap of a double tap must neither sign nor close the review. Both
// take presses this long after the review opened.
const SIGN_GUARD_MS = 600;
const MSG = {
  nameMismatch: (name: string, first: string) =>
    `Please type your name exactly as it is written here: ${name}. Only ${first} can sign. If that name is wrong, do not sign. Message me and I will fix it.`,
  partnerCannotSign: (name: string, first: string) => `Only ${name} can sign this agreement. Please ask ${first} to sign.`,
  textChanged: 'This agreement was updated. Please reload the page and read it again.',
  failed: 'That did not go through. Nothing was signed. Please try again.',
  unchecked: 'I could not check if that went through. Please reload this page before you try again.',
  unknown: 'This link does not work. Please check that you opened the full link from my message.',
  void: 'This link is no longer active. Message me and I will send you a new one.',
  copyLate: 'If the PDF copy does not arrive in a few minutes, message me and I will send it again.',
  pdfPreparing: 'Preparing your PDF. This can take a few seconds.',
  pdfSaved: 'Your PDF is in your downloads. Nothing happened? Open this page in Safari or Chrome and try again.',
  printHint: 'Nothing happened? Open this page in Safari or Chrome, then print it or save it as a PDF.',
  fixTooShort: 'Please write what I should fix.',
  fixFailed: 'That did not go through. Please reply to the email or message me on WhatsApp.',
};

const pick = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T => root.querySelector(sel) as T;

/** With timeoutMs, a request that has not answered by then is aborted and counts as no answer. */
async function call(path: string, init: RequestInit = {}, timeoutMs?: number): Promise<Answer> {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : 0;
  try {
    const res = await fetch(path, { cache: 'no-store', credentials: 'same-origin', ...init, ...(controller ? { signal: controller.signal } : {}) });
    let body: Answer['body'] = null;
    try {
      const v = await res.json();
      if (v && typeof v === 'object' && !Array.isArray(v)) body = v;
    } catch {
      /* not JSON */
    }
    return { status: res.status, body };
  } catch {
    return { status: 0, body: null };
  } finally {
    if (timer) window.clearTimeout(timer);
  }
}
// v=2: a booking with a set answers with the whole set and its page content (an older booking answers as always).
const getDoc = (k: string) => call(`/r/agreement/doc?k=${encodeURIComponent(k)}&v=2`, { headers: { accept: 'application/json' } });
const post = (path: string, body: Record<string, unknown>, timeoutMs?: number) =>
  call(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) },
    timeoutMs,
  );

const isSigned = (a: Answer): boolean =>
  a.status === 200 && a.body?.ok === true && a.body.status === 'signed' && typeof a.body.signed?.final_doc_json === 'string';
const isReady = (a: Answer): boolean => {
  if (a.status !== 200 || a.body?.ok !== true || a.body.status === 'signed') return false;
  const set = a.body.set;
  if (set && Array.isArray(set.pool) && set.mixes?.share && set.mixes?.private) return true;
  return CHOICES.every((c) => typeof a.body?.variants?.[c]?.doc_json === 'string');
};

/** Joins the parts when every one is a string; null when any is missing. */
const text = (...parts: unknown[]): string | null => (parts.every((p) => typeof p === 'string') ? parts.join('') : null);

/** The later payments of a booking paid in three parts, as [label, text] rows; null when there are none or they are malformed. */
const laterPayments = (s: StoredSummary | undefined): [string, string][] | null => {
  const list = s?.later_payments;
  if (!Array.isArray(list) || !list.length || !list.every((r) => typeof r?.label === 'string' && typeof r?.text === 'string')) return null;
  return list.map((r) => [r.label, r.text]);
};
/**
 * The balance of a summary with how it is paid ("$375.25, in cash"), as the signed view and the review show
 * it; null when the balance is missing. A summary stored before `balance_how` existed reads as it always did.
 */
const balanceText = (s: StoredSummary | undefined): string | null => text(s?.balance, ', ', s?.balance_how ?? 'e-transfer or cash');
/** The refundable deposit of a summary, when it is whole. */
const depositOf = (s: StoredSummary | undefined): NonNullable<StoredSummary['deposit']> | null => {
  const d = s?.deposit;
  return d && typeof d.label === 'string' && typeof d.amount === 'string' && typeof d.note === 'string' ? d : null;
};

/** One <div><dt>…</dt><dd>…</dd></div> row of an agr-rows list. */
const dlRow = (dt: string, dd: string): HTMLDivElement => {
  const row = document.createElement('div');
  row.append(Object.assign(document.createElement('dt'), { textContent: dt }), Object.assign(document.createElement('dd'), { textContent: dd }));
  return row;
};

function setBusy(btn: HTMLButtonElement, on: boolean, label?: string) {
  btn.disabled = on;
  if (on) btn.setAttribute('aria-busy', 'true');
  else btn.removeAttribute('aria-busy');
  if (label) btn.textContent = label;
}

export function initAgreement(): void {
  const main = pick('main.agr');
  if (!main) return;
  const k = new URLSearchParams(location.search).get('k') ?? '';
  const ribbon = pick('[data-agr-ribbon]');
  let readyView: HTMLElement | null = pick<HTMLElement>('[data-agr-view="ready"]', main);
  const docEl = pick('[data-agr-doc]', main);
  const signbox = pick('[data-agr-signbox]', main);
  const signTitle = pick('[data-agr-sign-title]', main);
  const form = pick<HTMLFormElement>('[data-agr-form]', main);
  const nameInput = pick<HTMLInputElement>('[data-agr-name]', main);
  const agreeBox = pick<HTMLInputElement>('[data-agr-agree]', main);
  const errorEl = pick('[data-agr-error]', main);
  const reviewBtn = pick<HTMLButtonElement>('[data-agr-review]', main);
  const notYetBtn = pick<HTMLButtonElement>('[data-agr-not-yet]', main);
  const fixForm = pick<HTMLFormElement>('[data-agr-fix-form]', main);
  const fixText = pick<HTMLTextAreaElement>('[data-agr-fix-text]', main);
  const fixError = pick('[data-agr-fix-error]', main);
  const fixSend = pick<HTMLButtonElement>('[data-agr-fix-send]', main);
  const fixDone = pick('[data-agr-fix-done]', main);
  const dlg = pick<HTMLDialogElement>('[data-agr-dialog]', main);
  const signBtn = pick<HTMLButtonElement>('[data-agr-sign]', main);
  const backBtn = pick<HTMLButtonElement>('[data-agr-back]', main);
  const nativeDialog = typeof HTMLDialogElement === 'function' && typeof dlg.showModal === 'function';

  // A browser may restore a ticked box or a radio on reload; the script's state starts empty, so must the form.
  form.reset();

  let ready: ReadyPayload | null = null;
  let model: Model | null = null;
  let view: ReadyView | null = null;
  let bookingNumber = ''; // for the PDF file name when the answer carries none
  let choice: Choice | null = null;
  const ticked = new Set<string>();
  let busy = false;
  let afterClose: HTMLElement | null = null;
  let armTimer = 0;

  const setState = (s: State) => {
    main.dataset.agrState = s;
    main.removeAttribute('aria-busy');
  };
  const showRibbon = (mode: unknown) => {
    ribbon.hidden = mode !== 'test';
  };
  /** The ticked extras, in tick box order. These ids, never labels, go into the sign body and the PDF query. */
  const tickedIds = (): string[] => (model ? model.ticks.filter((t) => ticked.has(t.id)).map((t) => t.id) : []);
  const selection = (): Selection => ({ choice, ids: tickedIds() });
  const formState = () => ({ name: nameInput.value.trim() !== '', agree: agreeBox.checked });
  const draw = (src: Source, anchor: Element | null = null) => view?.render(selection(), src, formState(), anchor);

  // ---------------------------------------------------------------- states

  /** Builds the whole ready view, or nothing: on any failure everything built is emptied and a retry starts over. */
  function showReady(p: ReadyPayload, focus: boolean) {
    if (!ready) {
      try {
        const m = buildModel(p, p.today);
        const v = buildReady(main, m, p);
        // The controls were just made: none may start ticked, whatever the browser restored.
        form.reset();
        choice = null;
        ticked.clear();
        model = m;
        view = v;
        draw('init');
        ready = p;
        bookingNumber = p.number;
      } catch {
        model = null;
        view = null;
        clearReady(main);
        return showError(focus);
      }
    }
    update();
    showRibbon(p.mode);
    setState('ready');
  }

  function copyLine(copy: SignedPayload['copy'] | undefined) {
    const line = pick('[data-agr-copy-line]', main);
    const verb = copy?.status === 'sent' ? 'was sent to' : 'is on its way to';
    line.textContent = text(`Your date is held once the retainer arrives. A PDF copy of the signed agreement ${verb} `, copy?.to, '.') ?? '';
  }

  /** How many checks: data-agr-poll-max on the page (a test hook), else 24. Read at every check. */
  const pollMax = () => Number(main.dataset.agrPollMax) || POLL_MAX;

  /** While the copy is pending, look again every 5 s, at most 24 times. Still not sent then: say what to do. */
  function pollCopy() {
    let polls = 0;
    const tick = async () => {
      polls += 1;
      const a = await getDoc(k);
      let status: unknown;
      if (isSigned(a)) {
        status = (a.body as SignedPayload).copy?.status;
        copyLine((a.body as SignedPayload).copy);
        if (status !== 'pending') return;
      }
      if (polls < pollMax()) window.setTimeout(tick, POLL_MS);
      // The last check: still pending, or no answer.
      else pick('[data-agr-copy-line]', main).textContent = MSG.copyLate;
    };
    window.setTimeout(tick, POLL_MS);
  }

  /**
   * Every field is filled before the view switches, each on its own: a missing field leaves only
   * that field empty, never a blank page after a real signature.
   */
  function showSigned(p: SignedPayload, focus: boolean, already = false) {
    const s = p.signed;
    bookingNumber = p.number;
    const put = (sel: string, value: string | null) => {
      const el = pick(sel, main);
      el.textContent = value ?? '';
      el.hidden = value === null;
    };
    pick('[data-agr-already]', main).hidden = !already;
    put('[data-agr-signed-on]', text('Signed on ', s.date, ' at ', s.time));
    put('[data-agr-thanks-name]', text(p.client_first, '.'));
    copyLine(p.copy);
    put('[data-agr-retainer]', text(p.summary?.retainer));
    put('[data-agr-etransfer]', text(p.summary?.etransfer_email));
    put('[data-agr-reference]', text(p.number));
    put('[data-agr-balance]', balanceText(p.summary));
    // Paid in three parts: the second and the final payment take the place of the balance line.
    const later = laterPayments(p.summary);
    const balanceRow = main.querySelector<HTMLElement>('[data-agr-balance-row]');
    const rowList = balanceRow?.parentElement;
    if (balanceRow && rowList) {
      balanceRow.hidden = later !== null;
      rowList.querySelectorAll('[data-agr-later-row], [data-agr-deposit-row]').forEach((el) => el.remove());
      for (const [dt, dd] of later ?? []) {
        const row = dlRow(dt, dd);
        row.dataset.agrLaterRow = '';
        rowList.append(row);
      }
      // A refundable deposit ticked at signing: its own row, after the payments.
      const deposit = depositOf(p.summary);
      if (deposit) {
        const row = dlRow(deposit.label, depositText(deposit));
        row.dataset.agrDepositRow = '';
        rowList.append(row);
      }
    }
    put('[data-agr-step2-title]', text('Step 2 · ', p.labels?.after_signing?.title));
    put('[data-agr-step2-text]', text(p.labels?.after_signing?.text));
    put('[data-agr-signed-footer]', text('Signed by ', s.signed_name, ' · Record ', p.number, ' · Kept for 7 years'));

    const signedDoc = pick('[data-agr-signed-doc]', main);
    try {
      const doc = JSON.parse(s.final_doc_json) as AgreementDoc;
      const lines = (pick<HTMLTemplateElement>('[data-agr-siglines-tpl]', main).content.cloneNode(true) as DocumentFragment)
        .firstElementChild as HTMLElement;
      pick('[data-agr-sig-business]', lines).textContent = doc.business_signature;
      pick('[data-agr-sig-name]', lines).textContent = s.signed_name;
      pick('[data-agr-sig-when]', lines).textContent = text('Signed on ', s.date, ' at ', s.time) ?? '';
      renderSignedDoc(signedDoc, doc, s.date, lines);
    } catch {
      signedDoc.replaceChildren();
    }

    // The sign block, the ticks and the sharing cards go away for good: a signed link cannot be signed again.
    readyView?.remove();
    readyView = null;
    showRibbon(p.mode);
    setState('signed');
    if (focus) {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
      pick('[data-agr-thanks]', main).focus({ preventScroll: true });
    }
    if (p.copy?.status === 'pending') pollCopy();
  }

  function showGone(status: number, focus: boolean) {
    const msg = pick('[data-agr-gone-msg]', main);
    msg.textContent = status === 410 ? MSG.void : MSG.unknown;
    setState('gone');
    if (focus) msg.focus();
  }

  function showError(focus: boolean) {
    setState('error');
    if (focus) pick('[data-agr-load-error]', main).focus();
  }

  function route(a: Answer, focus: boolean) {
    if (isSigned(a)) return showSigned(a.body as SignedPayload, focus);
    if (isReady(a)) return showReady(a.body as ReadyPayload, focus);
    if (a.status === 404 || a.status === 410) return showGone(a.status, focus);
    return showError(focus);
  }

  async function load(focus: boolean) {
    main.dataset.agrState = 'loading';
    main.setAttribute('aria-busy', 'true');
    if (!TOKEN_RE.test(k)) return showGone(404, focus);
    route(await getDoc(k), focus);
    if (focus && main.dataset.agrState === 'ready') pick('[data-agr-title]', readyView!).focus();
  }

  // ---------------------------------------------------------------- the sign block

  const update = () => {
    reviewBtn.disabled = busy || !(nameInput.value.trim() && choice && agreeBox.checked);
  };
  /** The ticks, the sharing choice, the name and the agree tick cannot change while they are being reviewed or posted. */
  const lockForm = (on: boolean) => {
    main.querySelectorAll<HTMLFieldSetElement>('fieldset[data-agr-controls]').forEach((f) => (f.disabled = on));
  };

  function showSignError(message: string) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function openReview() {
    const p = ready!;
    const c = choice!;
    errorEl.hidden = true;
    // The amounts of the shown mix: the chosen sharing option and the ticked extras.
    const sum = model!.mix(c, tickedIds()).summary;
    const deposit = depositOf(sum);
    // Paid in three parts (a wedding made before 2026-11-23): the later payments. Otherwise the balance on
    // the day, in the words of the signed view.
    const later = laterPayments(sum);
    const balance = later ? null : balanceText(sum);
    const rows: [string, string][] = [
      ['Your name', nameInput.value.trim()],
      ['Your partner', p.partner_name],
      ['Package', sum.package],
      ['Date', sum.date],
      ...(model!.ticks.length ? [['Extras', extrasText(sum)] as [string, string]] : []),
      ['Total', sum.total],
      ['Retainer', sum.retainer],
      ...(balance === null ? [] : [['Balance on the day', balance] as [string, string]]),
      ...(later ?? []),
      ...(deposit ? [[deposit.label, depositText(deposit)] as [string, string]] : []),
      ['Sharing', view!.optionLabel[c]],
    ];
    pick('[data-agr-review-rows]', dlg).replaceChildren(...rows.map(([dt, dd]) => dlRow(dt, dd)));
    if (nativeDialog) dlg.showModal();
    else {
      // No <dialog>: the panel shows inline, and the page behind it is not inert, so lock the form.
      lockForm(true);
      dlg.classList.add('agr-review--inline');
      dlg.setAttribute('open', '');
    }
    // Not yet: a press in the first moment is the second tap of a double tap, not a look at the rows.
    const guarded = [signBtn, backBtn];
    for (const b of guarded) b.setAttribute('aria-disabled', 'true');
    window.clearTimeout(armTimer);
    armTimer = window.setTimeout(() => guarded.forEach((b) => b.removeAttribute('aria-disabled')), SIGN_GUARD_MS);
    pick('[data-agr-dialog-title]', dlg).focus();
  }

  /** Whole on screen, and below the TEST ribbon when it shows. */
  const onScreen = (e: Element): boolean => {
    const r = e.getBoundingClientRect();
    const top = ribbon.hidden ? 0 : ribbon.getBoundingClientRect().bottom;
    return r.top >= top && r.bottom <= window.innerHeight;
  };

  /** Closes the review step and unlocks the form, then moves focus to `then` (none: the state change moves it). */
  function closeReview(then: HTMLElement | null) {
    afterClose = then;
    if (!busy) lockForm(false);
    if (nativeDialog && dlg.open) dlg.close();
    else {
      dlg.removeAttribute('open');
      // The inline panel took its height with it, and WebKit does not scroll to a focused button: bring it back first.
      if (then && !onScreen(then)) then.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      then?.focus({ preventScroll: true });
    }
  }

  async function sign() {
    if (busy || !choice || !ready || !model) return;
    busy = true;
    lockForm(true);
    update();
    setBusy(signBtn, true, 'Signing…');
    backBtn.disabled = true;
    const ids = tickedIds();
    const m = model.mix(choice, ids);
    // The fingerprint of the exact string shown. Without WebCrypto, the server's own value.
    let text_hash = m.hash;
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      try {
        text_hash = await sha256Hex(m.doc_json);
      } catch {
        text_hash = m.hash;
      }
    }
    // One POST per press. It is never retried by the page. After 30 s (data-agr-sign-timeout, a test
    // hook) it is aborted, which is no clear answer: the link is read again below.
    const timeout = Number(main.dataset.agrSignTimeout) || SIGN_TIMEOUT_MS;
    const body: Record<string, unknown> = { k, choice, signed_name: nameInput.value.trim(), agree: agreeBox.checked, text_hash };
    // Only when something is ticked: a sign with nothing ticked is exactly what it always was.
    if (ids.length) body.extras = ids;
    const a = await post('/r/agreement/sign', body, timeout);
    const err = a.body?.error;
    const clear =
      isSigned(a) || a.status === 404 || a.status === 410 || err === 'name_mismatch' || err === 'partner_cannot_sign' || err === 'text_changed';
    // No clear answer (503, network, anything else): the signature may still have landed, so read the link again.
    const outcome = clear ? a : await getDoc(k);
    busy = false;
    setBusy(signBtn, false, 'Sign the agreement');
    backBtn.disabled = false;
    update();

    if (isSigned(outcome)) {
      closeReview(null);
      return showSigned(outcome.body as SignedPayload, true, a === outcome && a.body?.already === true);
    }
    if (outcome.status === 404 || outcome.status === 410) {
      closeReview(null);
      return showGone(outcome.status, true);
    }
    if (err === 'name_mismatch' || err === 'partner_cannot_sign') {
      nameInput.setAttribute('aria-invalid', 'true');
      const words = err === 'name_mismatch' ? MSG.nameMismatch : MSG.partnerCannotSign;
      showSignError(words(ready.labels.name_expected, ready.client_first));
    } else if (err === 'text_changed') showSignError(MSG.textChanged);
    // The second read answered and says not signed: then, and only then, nothing was signed.
    else showSignError(isReady(outcome) ? MSG.failed : MSG.unchecked);
    closeReview(errorEl);
  }

  /** Shows the form to say what is wrong. Nothing is sent until they press Send. */
  function notYet() {
    if (busy) return;
    fixForm.hidden = false;
    fixDone.hidden = true;
    fixError.hidden = true;
    setState('not-yet');
    fixText.focus();
  }

  function showFixError(message: string) {
    fixError.textContent = message;
    fixError.hidden = false;
    fixError.focus();
  }

  async function sendFix() {
    if (busy) return;
    const message = fixText.value.trim();
    if (message.length < 3) return showFixError(MSG.fixTooShort);
    fixError.hidden = true;
    busy = true;
    setBusy(fixSend, true, 'Sending…');
    update();
    const a = await post('/r/agreement/not-yet', { k, message }, SIGN_TIMEOUT_MS);
    busy = false;
    setBusy(fixSend, false, 'Send');
    update();
    if (a.status === 200 && a.body?.ok === true) {
      fixText.value = '';
      fixForm.hidden = true;
      fixDone.hidden = false;
      fixDone.focus();
      return;
    }
    if (a.status === 409) {
      const d = await getDoc(k);
      if (isSigned(d)) return showSigned(d.body as SignedPayload, true);
    }
    if (a.status === 404 || a.status === 410) return showGone(a.status, true);
    // Their text stays in the box.
    showFixError(MSG.fixFailed);
  }

  nameInput.addEventListener('input', () => {
    nameInput.removeAttribute('aria-invalid');
    draw('name');
    update();
  });
  // The tick boxes and the sharing cards are made at run time: one listener on the form.
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    if (!view) return;
    if (t.matches('[data-agr-extra]')) {
      const id = t.dataset.agrExtra ?? '';
      if (t.checked) ticked.add(id);
      else ticked.delete(id);
      draw('tick', t.closest('.agr-opt'));
    } else if (t.matches('[data-agr-choice]')) {
      if (!t.checked) return;
      choice = t.dataset.agrChoice === 'private' ? 'private' : 'share';
      draw('choice', t.closest('.agr-opt'));
    } else if (t === agreeBox) draw('agree');
    update();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    update();
    if (!reviewBtn.disabled) openReview();
  });
  docEl.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-agr-disc]');
    if (b && view) view.toggle(Number(b.dataset.agrDisc));
  });
  // A contents link, a "part N" link or the missing line's link: the browser scrolls, then focus follows.
  main.addEventListener('click', (e) => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a || !readyView?.contains(a)) return;
    const href = a.getAttribute('href') ?? '';
    const target = a.matches('[data-agr-missing-jump]')
      ? pick<HTMLElement>('[data-agr-choice="share"]', main)
      : href === '#sign'
        ? signTitle
        : /^#part-\d+$/.test(href)
          ? pick<HTMLElement>(`${href} > h2`, main)
          : null;
    if (target) window.setTimeout(() => target.focus({ preventScroll: true }), 0);
  });
  /** A button of the review takes no press in its first moment (aria-disabled, set by openReview). */
  const armed = (b: HTMLButtonElement) => b.getAttribute('aria-disabled') !== 'true';
  backBtn.addEventListener('click', () => {
    if (armed(backBtn)) closeReview(reviewBtn);
  });
  signBtn.addEventListener('click', () => {
    if (armed(signBtn)) void sign();
  });
  dlg.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  dlg.addEventListener('close', () => {
    const target = afterClose ?? (main.dataset.agrState === 'ready' ? reviewBtn : null);
    afterClose = null;
    if (!busy) lockForm(false);
    target?.focus();
  });
  notYetBtn.addEventListener('click', notYet);
  fixForm.addEventListener('submit', (e) => {
    e.preventDefault();
    void sendFix();
  });
  /**
   * Downloads the copy as a PDF made by the server. When the server has no PDF to give (any other
   * answer), it falls back to the print window, as before: window.print() does nothing in some in-app
   * browsers, so the line under the button then says what to do.
   */
  async function downloadPdf(b: HTMLButtonElement) {
    const hint = b.parentElement?.querySelector<HTMLElement>('[data-agr-print-hint]') ?? null;
    const say = (message: string) => {
      if (!hint) return;
      hint.textContent = message;
      hint.hidden = false;
    };
    const signedCopy = b.closest('[data-agr-signed]') !== null;
    // The copy is the mix on screen; before a choice, the share version, as the parts show it.
    const ids = tickedIds();
    const query = signedCopy ? '' : `&c=${choice ?? 'share'}${ids.length ? `&x=${ids.map(encodeURIComponent).join(',')}` : ''}`;
    setBusy(b, true);
    say(MSG.pdfPreparing);
    let blob: Blob | null = null;
    let name = '';
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
    try {
      const res = await fetch(`/r/agreement/pdf?k=${encodeURIComponent(k)}${query}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (res.status === 200 && (res.headers.get('content-type') ?? '').startsWith('application/pdf')) {
        blob = await res.blob();
        name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? '';
      }
    } catch {
      blob = null;
    } finally {
      window.clearTimeout(timer);
    }
    setBusy(b, false);
    if (!blob) {
      window.print();
      say(MSG.printHint);
      return;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name || `AD Photography agreement ${bookingNumber}${signedCopy ? '' : ' (not signed)'}.pdf`;
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), PDF_URL_KEEP_MS);
    say(MSG.pdfSaved);
  }
  main.querySelectorAll<HTMLButtonElement>('[data-agr-print]').forEach((b) => b.addEventListener('click', () => void downloadPdf(b)));
  // Back from "not yet": ticks, choice, name and open panels are as they were.
  pick('[data-agr-back-to-doc]', main).addEventListener('click', () => {
    setState('ready');
    signbox.scrollIntoView({ block: 'start', behavior: 'instant' as ScrollBehavior });
    signTitle.focus({ preventScroll: true });
  });
  pick('[data-agr-retry]', main).addEventListener('click', () => void load(true));

  void load(false);
}
