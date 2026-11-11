// Page script for the private agreement page (/welcome/agreement/?k=<token>).
//
// 1. Read the booking by its token. A signed link opens straight in the signed state.
// 2. Show the agreement exactly as the server sent it (agreement-doc.ts). Until a sharing
//    choice is made, section 1 hides the sharing row and section 15 shows both versions.
// 3. Review and sign: the fingerprint sent is the SHA-256 of the chosen doc_json, the
//    very string the server hashed. The form is locked while the review is open inline
//    and while the request is out, so what is reviewed is what is posted.
// 4. Thank you state, with the retainer details and the signed text, read only.
//
// This file may import only html.ts, hash.ts, token.ts, format.ts and types from
// src/lib/agreement/ (here through agreement-doc.ts), so the clause file never ships.
import { sha256Hex } from '../lib/agreement/hash';
import type { AgreementDoc, Choice } from '../lib/agreement/types';
import { CHOICES, docView, parseVariants, renderSignedDoc, tocItems, type Docs } from './agreement-doc';

type State = 'loading' | 'ready' | 'signed' | 'not-yet' | 'gone' | 'error';

interface Labels {
  share_option: string;
  private_option: string;
  agree_label: string;
  intro_bullets: string[];
  after_signing: { title: string; text: string };
  name_expected: string;
}
interface Summary {
  package: string;
  date: string;
  total: string;
  retainer: string;
  balance: string;
  etransfer_email: string;
}
interface Base {
  ok: true;
  mode: 'test' | 'live';
  number: string;
  client_first: string;
  partner_first: string;
  client_name: string;
  partner_name: string;
  labels: Labels;
  summary: Summary;
}
interface ReadyPayload extends Base {
  status: 'sent' | 'opened';
  today: string;
  variants: Record<Choice, { doc_json: string; hash: string }>;
}
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
const MSG = {
  nameMismatch: (name: string, first: string) =>
    `Please type your name exactly as it is written at the top of the agreement: ${name}. Only ${first} can sign. If that name is wrong, do not sign. Message me and I will fix it.`,
  partnerCannotSign: (name: string, first: string) => `Only ${name} can sign this agreement. Please ask ${first} to sign.`,
  signer: (name: string) => `Only ${name} can sign this agreement.`,
  textChanged: 'This agreement was updated. Please reload the page and read it again.',
  failed: 'That did not go through. Nothing was signed. Please try again.',
  unchecked: 'I could not check if that went through. Please reload this page before you try again.',
  unknown: 'This link does not work. Please check that you opened the full link from my message.',
  void: 'This link is no longer active. Message me and I will send you a new one.',
  choiceShown: 'Sections 1 and 15 above now show your choice.',
  copyLate: 'If the PDF copy does not arrive in a few minutes, message me and I will send it again.',
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
const getDoc = (k: string) => call(`/r/agreement/doc?k=${encodeURIComponent(k)}`, { headers: { accept: 'application/json' } });
const post = (path: string, body: Record<string, unknown>, timeoutMs?: number) =>
  call(
    path,
    { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) },
    timeoutMs,
  );

const isSigned = (a: Answer): boolean =>
  a.status === 200 && a.body?.ok === true && a.body.status === 'signed' && typeof a.body.signed?.final_doc_json === 'string';
const isReady = (a: Answer): boolean =>
  a.status === 200 && a.body?.ok === true && a.body.status !== 'signed' && CHOICES.every((c) => typeof a.body?.variants?.[c]?.doc_json === 'string');

/** Joins the parts when every one is a string; null when any is missing. */
const text = (...parts: unknown[]): string | null => (parts.every((p) => typeof p === 'string') ? parts.join('') : null);

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
  let readyView: HTMLElement | null = pick('[data-agr-view="ready"]', main);
  const docEl = pick('[data-agr-doc]', main);
  const signbox = pick('[data-agr-signbox]', main);
  const form = pick<HTMLFormElement>('[data-agr-form]', main);
  const controls = pick<HTMLFieldSetElement>('[data-agr-controls]', main);
  const nameInput = pick<HTMLInputElement>('[data-agr-name]', main);
  const agreeBox = pick<HTMLInputElement>('[data-agr-agree]', main);
  const choiceStatus = pick('[data-agr-choice-status]', main);
  const errorEl = pick('[data-agr-error]', main);
  const reviewBtn = pick<HTMLButtonElement>('[data-agr-review]', main);
  const notYetBtn = pick<HTMLButtonElement>('[data-agr-not-yet]', main);
  const dlg = pick<HTMLDialogElement>('[data-agr-dialog]', main);
  const signBtn = pick<HTMLButtonElement>('[data-agr-sign]', main);
  const backBtn = pick<HTMLButtonElement>('[data-agr-back]', main);
  const nativeDialog = typeof HTMLDialogElement === 'function' && typeof dlg.showModal === 'function';

  // A browser may restore a ticked box or a radio on reload; the script's state starts empty, so must the form.
  form.reset();

  let ready: ReadyPayload | null = null;
  let view: ReturnType<typeof docView> | null = null;
  let choice: Choice | null = null;
  let busy = false;
  let afterClose: HTMLElement | null = null;

  const setState = (s: State) => {
    main.dataset.agrState = s;
    main.removeAttribute('aria-busy');
  };
  const showRibbon = (mode: unknown) => {
    ribbon.hidden = mode !== 'test';
  };

  // ---------------------------------------------------------------- states

  /** Builds the whole ready view, or nothing: on any failure the document is emptied and a retry starts over. */
  function showReady(p: ReadyPayload, focus: boolean) {
    if (!ready) {
      try {
        const docs: Docs = parseVariants(p.variants);
        const v = docView(docEl, docs, p.today, signbox);
        v.render(null);
        pick('[data-agr-eyebrow]', main).textContent = `${p.client_first} and ${p.partner_first} · Booking ${p.number}`;
        pick('[data-agr-bullets]', main).replaceChildren(
          ...p.labels.intro_bullets.map((b) => Object.assign(document.createElement('li'), { textContent: b })),
        );
        pick('[data-agr-toc]', main).replaceChildren(...tocItems(docs.share));
        pick('[data-agr-business-signature]', main).textContent = docs.share.business_signature;
        pick('[data-agr-share-option]', main).textContent = p.labels.share_option;
        pick('[data-agr-private-option]', main).textContent = p.labels.private_option;
        pick('[data-agr-agree-label]', main).textContent = p.labels.agree_label;
        nameInput.placeholder = p.labels.name_expected;
        pick('[data-agr-signer]', main).textContent = MSG.signer(p.labels.name_expected);
        view = v;
        ready = p;
      } catch {
        docEl.replaceChildren();
        return showError(focus);
      }
    }
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
    put('[data-agr-balance]', text(p.summary?.balance, ', e-transfer or cash'));
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

    // The sign box goes away for good: a signed link cannot be signed again.
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
    if (focus && main.dataset.agrState === 'ready') pick('h1', readyView!).focus();
  }

  // ---------------------------------------------------------------- the sign box

  const update = () => {
    reviewBtn.disabled = busy || !(nameInput.value.trim() && choice && agreeBox.checked);
  };
  /** The name, the sharing choice and the tick cannot change while they are being reviewed or posted. */
  const lockForm = (on: boolean) => {
    controls.disabled = on;
  };

  function showSignError(message: string) {
    errorEl.textContent = message;
    errorEl.hidden = false;
  }

  function openReview() {
    const p = ready!;
    errorEl.hidden = true;
    const rows: [string, string][] = [
      ['Your name', nameInput.value.trim()],
      ['Your partner', p.partner_name],
      ['Package', p.summary.package],
      ['Date', p.summary.date],
      ['Total', p.summary.total],
      ['Retainer', p.summary.retainer],
      ['Sharing', choice === 'private' ? p.labels.private_option : p.labels.share_option],
    ];
    pick('[data-agr-review-rows]', dlg).replaceChildren(
      ...rows.map(([dt, dd]) => {
        const row = document.createElement('div');
        row.append(Object.assign(document.createElement('dt'), { textContent: dt }), Object.assign(document.createElement('dd'), { textContent: dd }));
        return row;
      }),
    );
    if (nativeDialog) dlg.showModal();
    else {
      // No <dialog>: the panel shows inline, and the page behind it is not inert, so lock the form.
      lockForm(true);
      dlg.classList.add('agr-review--inline');
      dlg.setAttribute('open', '');
    }
    pick('[data-agr-dialog-title]', dlg).focus();
  }

  /** Closes the review step and unlocks the form, then moves focus to `then` (none: the state change moves it). */
  function closeReview(then: HTMLElement | null) {
    afterClose = then;
    if (!busy) lockForm(false);
    if (nativeDialog && dlg.open) dlg.close();
    else {
      dlg.removeAttribute('open');
      then?.focus();
    }
  }

  async function sign() {
    if (busy || !choice || !ready) return;
    busy = true;
    lockForm(true);
    update();
    setBusy(signBtn, true, 'Signing…');
    backBtn.disabled = true;
    const v = ready.variants[choice];
    // The fingerprint of the exact string on screen. Without WebCrypto, the server's own value.
    let text_hash = v.hash;
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof crypto.subtle.digest === 'function') {
      try {
        text_hash = await sha256Hex(v.doc_json);
      } catch {
        text_hash = v.hash;
      }
    }
    // One POST per press. It is never retried by the page. After 30 s (data-agr-sign-timeout, a test
    // hook) it is aborted, which is no clear answer: the link is read again below.
    const timeout = Number(main.dataset.agrSignTimeout) || SIGN_TIMEOUT_MS;
    const a = await post('/r/agreement/sign', { k, choice, signed_name: nameInput.value.trim(), agree: agreeBox.checked, text_hash }, timeout);
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

  async function notYet() {
    if (busy) return;
    busy = true;
    setBusy(notYetBtn, true);
    update();
    const a = await post('/r/agreement/not-yet', { k });
    busy = false;
    setBusy(notYetBtn, false);
    update();
    if (a.status === 409) {
      const d = await getDoc(k);
      if (isSigned(d)) return showSigned(d.body as SignedPayload, true);
    }
    if (a.status === 404 || a.status === 410) return showGone(a.status, true);
    // Any other answer: nothing is signed either way, and the message asks them to get in touch.
    setState('not-yet');
    pick('[data-agr-not-yet-msg]', main).focus();
  }

  nameInput.addEventListener('input', () => {
    nameInput.removeAttribute('aria-invalid');
    update();
  });
  agreeBox.addEventListener('change', update);
  for (const c of CHOICES) {
    pick<HTMLInputElement>(`[data-agr-choice="${c}"]`, main).addEventListener('change', (e) => {
      if (!(e.target as HTMLInputElement).checked || !view) return;
      choice = c;
      view.render(c);
      // Set at the moment of the choice, so screen readers announce the live region.
      choiceStatus.textContent = MSG.choiceShown;
      update();
    });
  }
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    update();
    if (!reviewBtn.disabled) openReview();
  });
  backBtn.addEventListener('click', () => closeReview(reviewBtn));
  signBtn.addEventListener('click', () => void sign());
  dlg.addEventListener('cancel', (e) => {
    if (busy) e.preventDefault();
  });
  dlg.addEventListener('close', () => {
    const target = afterClose ?? (main.dataset.agrState === 'ready' ? reviewBtn : null);
    afterClose = null;
    if (!busy) lockForm(false);
    target?.focus();
  });
  notYetBtn.addEventListener('click', () => void notYet());
  // window.print() does nothing in some in-app browsers: after it, the line under the button says what to do.
  main.querySelectorAll<HTMLButtonElement>('[data-agr-print]').forEach((b) =>
    b.addEventListener('click', () => {
      window.print();
      const hint = b.parentElement?.querySelector<HTMLElement>('[data-agr-print-hint]');
      if (hint) hint.hidden = false;
    }),
  );
  pick('[data-agr-back-to-doc]', main).addEventListener('click', () => {
    setState('ready');
    signbox.focus();
  });
  pick('[data-agr-retry]', main).addEventListener('click', () => void load(true));

  void load(false);
}
