/**
 * The pricing configurator engine.
 *
 * Every step, package, question and add-on is already in the DOM, server
 * rendered. This script hides all but the active step, filters what is
 * relevant, totals the selection, and posts once at the end.
 */
import { totalAddOns, type Selection } from '../lib/addons';
import { captureAttribution, attributionFields, qualify, watchDwell } from './attribution';

type PkgIndex = {
  id: string; category: string; price: number | null;
  qualifier: 'firm' | 'from' | 'rate' | 'none';
  film: boolean; regions: string[] | null; addOnIds: string[];
  hours: number | null; name: string; rate: number | null;
};
type AddOnIndex = { id: string; price: number | null; unit: string; max: number | null; countable: boolean; label: string };
type Flow = { categories: Array<Record<string, string>>; questions: Record<string, any[]> };

interface State {
  categoryId?: string;
  category?: string;
  answers: Record<string, number>;
  region?: string;
  film?: boolean;
  packageId?: string;
  addOns: Record<string, number>;
  step: number;
}

const STORE = 'kk_pricing_state';
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Replay the site's own reveal animation on the step that just became visible.
 * scroll-reveal.ts unobserves after firing once, and these steps start hidden,
 * so the observer never sees them. Driving it here keeps the motion identical
 * to the rest of the site rather than inventing a second animation language.
 */
function animateIn(step: HTMLElement): void {
  const items = Array.from(step.querySelectorAll<HTMLElement>('.reveal:not([hidden])'));
  const targets = items.length ? items : [];
  if (reduced()) {
    targets.forEach((el) => el.classList.add('revealed'));
    return;
  }
  targets.forEach((el) => el.classList.remove('revealed'));
  // force a reflow so removing and re-adding actually re-runs the transition
  void step.offsetHeight;
  requestAnimationFrame(() => targets.forEach((el) => el.classList.add('revealed')));
}
const money = (n: number) =>
  '$' + n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function initConfigurator(): void {
  const form = document.querySelector<HTMLFormElement>('[data-cfg]');
  const dataEl = document.getElementById('cfg-data');
  if (!form || !dataEl?.textContent) return;

  const { pkgIndex, addOnIndex, permitIndex, flow } = JSON.parse(dataEl.textContent) as {
    pkgIndex: PkgIndex[]; addOnIndex: AddOnIndex[];
    permitIndex: Array<{ name: string; fee: number | null }>; flow: Flow;
  };
  const pkgById = new Map(pkgIndex.map((p) => [p.id, p]));
  const addOnById = new Map(addOnIndex.map((a) => [a.id, a]));

  const attribution = captureAttribution();
  const cancelDwell = watchDwell();

  let lastActive: HTMLElement | null = null;
  let state: State = { answers: {}, addOns: {}, step: 0 };
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) state = { ...state, ...JSON.parse(saved) };
  } catch { /* private mode */ }

  // Drop anything the saved state remembers that no longer exists. The add-on
  // catalogue and the packages change, and a visitor's stored selection from an
  // older version must not resurrect a deleted add-on or a deleted package.
  if (state.packageId && !pkgById.has(state.packageId)) state.packageId = undefined;
  for (const id of Object.keys(state.addOns)) {
    if (!addOnById.has(id)) delete state.addOns[id];
  }

  // A saved add-on the saved package does not offer is dropped as well.
  {
    const offered = new Set(state.packageId ? pkgById.get(state.packageId)?.addOnIds ?? [] : []);
    for (const id of Object.keys(state.addOns)) {
      if (!offered.has(id)) delete state.addOns[id];
    }
  }

  // The one way to change the package. Akash's rule: a different package means
  // the add-ons start again from nothing, because whatever was ticked was
  // ticked against the old package and its price. Picking the same package
  // again keeps them. Nothing else may write state.packageId.
  function setPackage(id: string | undefined): void {
    if (id !== state.packageId) state.addOns = {};
    state.packageId = id;
  }

  const save = () => {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* private mode */ }
  };

  // ─── step sequence, built from the chosen category ────────────────
  const q = (el: string) => form.querySelector<HTMLElement>(el);
  const all = (el: string) => Array.from(form.querySelectorAll<HTMLElement>(el));
  const stepEls = all('.cfg-step');
  // catalogue order, captured once; render() reorders the live DOM from this
  const pkgEls = all('.cfg-pkg');

  function sequence(): HTMLElement[] {
    const out: HTMLElement[] = [q('[data-step="category"]')!];
    if (state.categoryId) {
      const qs = (flow.questions[state.categoryId] ?? []) as any[];
      qs.forEach((question, i) => {
        if (question.onlyWhen) {
          const gate = question.onlyWhen;
          if (state.answers[gate.question] !== gate.optionIndex) return;
        }
        const el = form.querySelector<HTMLElement>(
          `[data-step="question"][data-q-category="${state.categoryId}"][data-q-index="${i}"]`
        );
        if (el) out.push(el);
      });
      out.push(
        q('[data-step="packages"]')!,
        q('[data-step="addons"]')!,
        q('[data-step="details"]')!,
        q('[data-step="ask"]')!,
        q('[data-step="identity"]')!,
      );
    }
    return out;
  }

  // ─── what is relevant right now ───────────────────────────────────
  function eligiblePackages(): PkgIndex[] {
    return pkgIndex.filter((p) => {
      if (p.category !== state.category) return false;
      // region gated packages only appear once the visitor has said where they are
      if (p.regions) return !!state.region && p.regions.includes(state.region);
      // if they asked for film, hide the packages that do not include it, and vice versa
      if (state.film !== undefined && p.category === 'Pre-Wedding' && p.price !== null) {
        if (p.film !== state.film) return false;
      }
      return true;
    });
  }

  function render(): void {
    const seq = sequence();
    state.step = Math.max(0, Math.min(state.step, seq.length - 1));
    const active = seq[state.step];

    const changed = active !== lastActive;
    stepEls.forEach((el) => { el.hidden = el !== active; });
    q('[data-step="done"]')!.hidden = true;

    // wayfinding
    const nav = q('[data-cfg-nav]')!;
    nav.hidden = state.step === 0;
    q('[data-cfg-count]')!.textContent = `${state.step + 1} of ${seq.length}`;
    const fill = q('[data-cfg-rule-fill]')!;
    fill.style.width = `${((state.step + 1) / seq.length) * 100}%`;

    // selected states
    all('[data-cfg-category]').forEach((b) =>
      b.setAttribute('aria-pressed', String(b.dataset.cfgCategory === state.categoryId)));
    all('[data-step="question"]').forEach((sec) => {
      const qid = sec.dataset.qId!;
      sec.querySelectorAll<HTMLElement>('[data-cfg-answer]').forEach((b) =>
        b.setAttribute('aria-pressed', String(state.answers[qid] === Number(b.dataset.cfgAnswer))));
    });

    // packages
    const eligible = new Set(eligiblePackages().map((p) => p.id));
    // The recommended package, the one a question pointed at, goes first; the
    // rest keep catalogue order. The nodes are moved rather than styled with
    // CSS order so the tab order matches what is on screen. Nothing moves when
    // the order is already right.
    const packagesEl = q('.cfg-packages')!;
    const ordered = pkgEls.filter((el) => el.dataset.package === state.packageId)
      .concat(pkgEls.filter((el) => el.dataset.package !== state.packageId));
    if (ordered.some((el, i) => packagesEl.children[i] !== el)) ordered.forEach((el) => packagesEl.append(el));
    pkgEls.forEach((el) => {
      const id = el.dataset.package!;
      el.hidden = !eligible.has(id);
      const isPick = id === state.packageId;
      el.classList.toggle('cfg-pkg--recommended', isPick);
      const badge = el.querySelector<HTMLElement>('[data-cfg-badge]');
      if (badge) badge.hidden = !isPick;
      el.querySelector('[data-cfg-choose]')?.setAttribute('aria-pressed', String(isPick));
    });
    q('[data-cfg-estimate-note]')!.hidden = state.category !== 'Wedding';

    // add-ons for the chosen package
    const offered = new Set(state.packageId ? pkgById.get(state.packageId)?.addOnIds ?? [] : []);
    all('.cfg-addon').forEach((el) => {
      const id = el.dataset.addon!;
      el.hidden = !offered.has(id);
      const box = el.querySelector<HTMLInputElement>('.cfg-addon__input')!;
      const on = state.addOns[id] !== undefined;
      box.checked = on;
      const wrap = el.querySelector<HTMLElement>('[data-cfg-qty-wrap]');
      if (wrap) {
        wrap.hidden = !on;
        const out = wrap.querySelector('[data-cfg-qty]')!;
        out.textContent = String(state.addOns[id] ?? 1);
        const max = addOnById.get(id)?.max ?? Infinity;
        wrap.querySelector<HTMLButtonElement>('[data-cfg-qty-down]')!.disabled = (state.addOns[id] ?? 1) <= 1;
        wrap.querySelector<HTMLButtonElement>('[data-cfg-qty-up]')!.disabled = (state.addOns[id] ?? 1) >= max;
      }
    });

    // A celebration is a party and a headshot is one person, so neither has a
    // partner to name.
    const NO_PARTNER = new Set(['celebration', 'headshots']);
    const partner = q('[data-cfg-partner]');
    if (partner) {
      const hide = NO_PARTNER.has(state.categoryId ?? '');
      partner.hidden = hide;
      if (hide) {
        const input = partner.querySelector<HTMLInputElement>('#cfg-partner');
        if (input) input.value = '';   // never submit a stale value from a hidden field
      }
    }

    renderTotal(seq);
    renderSummary(active?.dataset.step);
    if (changed) { lastActive = active; animateIn(active); }
    save();
  }

  /** The recap on the last step: the package, what they answered, every add-on
   *  with its own line price, and the total. Deposits, quotes and pass-through
   *  costs are listed but never folded into the number. */
  function renderSummary(active: string | undefined): void {
    const box = q('[data-cfg-summary]')!;
    box.hidden = active !== 'identity' || !state.packageId;
    if (box.hidden) return;

    const pkg = pkgById.get(state.packageId!)!;
    const base = pkg.price ?? 0;
    q('[data-cfg-sum-pkg]')!.textContent =
      pkg.qualifier === 'rate' ? `${pkg.name}, ${money(pkg.rate ?? 0)} per hour`
      : pkg.qualifier === 'none' ? pkg.name
      : `${pkg.name}, ${pkg.qualifier === 'from' ? 'from ' : ''}${money(base)}`;

    const list = q('[data-cfg-sum-list]')!;
    list.textContent = '';
    const row = (label: string, value: string, isAnswer = false) => {
      const li = document.createElement('li');
      if (isAnswer) li.setAttribute('data-answer', '');
      const a = document.createElement('span'); a.textContent = label;
      const b = document.createElement('span'); b.textContent = value;
      li.append(a, b);
      list.append(li);
    };

    for (const [qid, oi] of Object.entries(state.answers)) {
      const question = (flow.questions[state.categoryId!] ?? []).find((x: any) => x.id === qid);
      const opt = question?.options?.[oi];
      if (question && opt) row(question.ask, opt.label, true);
    }

    let extras = 0;
    const notes: string[] = [];
    for (const [id, qty] of Object.entries(state.addOns)) {
      const a = addOnById.get(id);
      if (!a) continue;
      const n = a.countable ? Math.max(1, Math.min(qty, a.max ?? Infinity)) : 1;
      const label = a.countable && n > 1 ? `${a.label} x${n}` : a.label;
      if (a.unit === 'quote') { row(label, 'I will quote this'); notes.push(a.label); continue; }
      if (a.unit === 'at-cost') { row(label, 'At cost'); continue; }
      if (a.unit === 'deposit') { row(label, `${money((a.price ?? 0) * n)} refundable`); continue; }
      if (a.unit === 'included') { row(label, 'Included'); continue; }
      const line = (a.price ?? 0) * n;
      extras += line;
      row(label, money(line));
    }
    if (!Object.keys(state.addOns).length) row('No add ons', '');

    const totalEl = q('[data-cfg-sum-total]')!;
    totalEl.textContent = '';
    const l = document.createElement('span');
    l.textContent = state.category === 'Wedding' ? 'Your estimate' : 'Your total';
    const r = document.createElement('span');
    r.textContent = pkg.qualifier === 'rate'
        ? `${money(pkg.rate ?? 0)} per hour${extras ? ` plus ${money(extras)}` : ''}`
      : pkg.qualifier === 'none' ? 'Priced with you'
      : `${pkg.qualifier === 'from' ? 'From ' : ''}${money(base + extras)}`;
    totalEl.append(l, r);

    const noteBits: string[] = [];
    if (state.category === 'Wedding') noteBits.push('An estimate. I confirm it with you on the call.');
    if (notes.length) noteBits.push(`${notes.join(', ')} is quoted separately.`);
    q('[data-cfg-sum-note]')!.textContent = noteBits.join(' ');
  }

  function renderTotal(seq: HTMLElement[]): void {
    const totalEl = q('[data-cfg-total]')!;
    const showFrom = seq[state.step]?.dataset.step;
    // 'identity' is deliberately absent: that step shows the full recap, and a
    // rail repeating the package and total beside it is pure duplication.
    totalEl.hidden = !state.packageId || !['packages', 'addons', 'details', 'ask'].includes(showFrom ?? '');
    if (totalEl.hidden) return;

    // The identity step has its own submit, so a "Continue" beside it is noise.
    const nextBtn = q('[data-cfg-next]')!;
    nextBtn.hidden = showFrom === 'identity';

    const pkg = pkgById.get(state.packageId!)!;
    const selections: Selection[] = Object.entries(state.addOns).map(([id, qty]) => ({ id, qty }));
    const t = totalAddOns(selections);
    const base = pkg.price ?? 0;
    const sum = base + t.addOnsTotal;

    const sumEl = q('[data-cfg-total-sum]')!;
    sumEl.classList.add('is-changing');
    window.setTimeout(() => sumEl.classList.remove('is-changing'), 120);

    q('[data-cfg-total-pkg]')!.textContent = pkg.name;
    sumEl.textContent =
      pkg.qualifier === 'rate'
        ? `${money(pkg.rate ?? 0)} per hour${t.addOnsTotal ? `, plus ${money(t.addOnsTotal)}` : ''}`
        : pkg.qualifier === 'none' ? 'Priced with you'
        : `${pkg.qualifier === 'from' ? 'From ' : ''}${money(sum)}`;

    const notes: string[] = [];
    if (pkg.qualifier === 'rate') notes.push('We settle the hours on the call, so there is no total yet.');
    if (state.category === 'Wedding') notes.push('An estimate. I confirm it on the call.');
    if (t.depositsHeld > 0) notes.push(`${money(t.depositsHeld)} refundable deposit, held separately.`);
    if (t.quoted.length) notes.push(`${t.quoted.map((a) => a.label).join(', ')}: quoted for you.`);
    if (t.atCost.length) notes.push(`${t.atCost.map((a) => a.label).join(', ')}: at cost.`);
    q('[data-cfg-total-note]')!.textContent = notes.join(' ');
  }

  const go = (delta: number) => {
    state.step += delta;
    render();
    const seq = sequence();
    seq[state.step]?.querySelector<HTMLElement>('.cfg-ask')?.focus?.();
    seq[state.step]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ─── events ───────────────────────────────────────────────────────
  form.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;

    const cat = t.closest<HTMLElement>('[data-cfg-category]');
    if (cat) {
      state.categoryId = cat.dataset.cfgCategory!;
      state.category = cat.dataset.category!;
      state.answers = {}; state.addOns = {};
      state.packageId = undefined; state.region = undefined; state.film = undefined;
      state.step = 1;
      // a proposal has no questions, so pick its only package straight away
      const only = eligiblePackages();
      if (only.length === 1) setPackage(only[0].id);
      render();
      return;
    }

    const ans = t.closest<HTMLElement>('[data-cfg-answer]');
    if (ans) {
      const sec = ans.closest<HTMLElement>('[data-step="question"]')!;
      state.answers[sec.dataset.qId!] = Number(ans.dataset.cfgAnswer);
      if (ans.dataset.packageId) setPackage(ans.dataset.packageId);
      if (ans.dataset.region) state.region = ans.dataset.region;
      if (ans.dataset.film) state.film = ans.dataset.film === 'true';
      if (ans.dataset.addOnId) state.addOns[ans.dataset.addOnId] = 1;
      go(1);
      return;
    }

    const choose = t.closest<HTMLElement>('[data-cfg-choose]');
    if (choose) {
      setPackage(choose.dataset.cfgChoose!);
      qualify('step');
      go(1);
      return;
    }

    if (t.closest('[data-cfg-back]')) { go(-1); return; }
    if (t.closest('[data-cfg-next]')) { go(1); return; }

    const up = t.closest<HTMLElement>('[data-cfg-qty-up]');
    const down = t.closest<HTMLElement>('[data-cfg-qty-down]');
    if (up || down) {
      const row = (up ?? down)!.closest<HTMLElement>('.cfg-addon')!;
      const id = row.dataset.addon!;
      const max = addOnById.get(id)?.max ?? Infinity;
      const next = (state.addOns[id] ?? 1) + (up ? 1 : -1);
      state.addOns[id] = Math.max(1, Math.min(next, max));
      render();
    }
  });

  form.addEventListener('change', (e) => {
    const box = (e.target as HTMLElement).closest<HTMLInputElement>('.cfg-addon__input');
    if (!box) return;
    const id = box.closest<HTMLElement>('.cfg-addon')!.dataset.addon!;
    if (box.checked) state.addOns[id] = 1; else delete state.addOns[id];
    render();
  });

  // ─── the date picker ──────────────────────────────────────────────
  // No altInput: that hides the real input and forces a real date, and this
  // field has to keep accepting "not sure yet". allowInput lets them do either.
  const dateInput = form.querySelector<HTMLInputElement>('[data-cfg-date]');
  function initPicker(): void {
    const fp = (window as unknown as { flatpickr?: (el: Element, o: unknown) => void }).flatpickr;
    if (!fp || !dateInput || dateInput.dataset.fpBound) return;
    dateInput.dataset.fpBound = 'true';
    fp(dateInput, {
      dateFormat: 'F j, Y',
      minDate: 'today',
      allowInput: true,
      disableMobile: false,
      monthSelectorType: 'static',
    });
  }
  initPicker();
  if (!dateInput?.dataset.fpBound) {
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      initPicker();
      if (dateInput?.dataset.fpBound || tries > 30) window.clearInterval(timer);
    }, 200);
  }

  // permit hint from the typed location
  const locInput = form.querySelector<HTMLInputElement>('#cfg-location');
  locInput?.addEventListener('input', () => {
    const v = locInput.value.trim().toLowerCase();
    const hit = v.length > 2 ? permitIndex.find((l) => l.name.toLowerCase().includes(v) || v.includes(l.name.toLowerCase())) : null;
    const el = q('[data-cfg-permit]')!;
    el.hidden = !hit;
    if (hit) {
      el.textContent = hit.fee
        ? `${hit.name} needs a permit. It is about ${money(hit.fee)}, set by the venue and charged at cost.`
        : `${hit.name} needs a permit. I will sort it and charge it at cost.`;
    }
  });

  // ─── submit, once, at the end ─────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector<HTMLButtonElement>('[data-cfg-submit]')!;
    const fieldErr = (name: string, msg: string | null) => {
      const el = form.querySelector<HTMLElement>(`[data-cfg-err="${name}"]`);
      const wrap = el?.closest<HTMLElement>('.cfg-field');
      if (!el || !wrap) return;
      el.hidden = !msg; el.textContent = msg ?? '';
      if (msg) wrap.setAttribute('data-invalid', ''); else wrap.removeAttribute('data-invalid');
    };

    const name = (form.querySelector<HTMLInputElement>('#cfg-name')!).value.trim();
    const email = (form.querySelector<HTMLInputElement>('#cfg-email')!).value.trim();
    const referral = (form.querySelector<HTMLSelectElement>('#cfg-referral')!).value;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    fieldErr('name', name ? null : 'I need a name to know who I am talking to.');
    fieldErr('email', emailOk ? null : 'That email does not look right.');
    fieldErr('referral', referral ? null : 'Let me know how you found me.');
    if (!name || !emailOk || !referral) {
      form.querySelector<HTMLElement>('[data-invalid] input, [data-invalid] select')?.focus();
      return;
    }
    if ((form.querySelector<HTMLInputElement>('#cfg-gotcha')!).value.trim()) return;

    const pkg = state.packageId ? pkgById.get(state.packageId) : undefined;
    const selections: Selection[] = Object.entries(state.addOns).map(([id, qty]) => ({ id, qty }));
    const t = totalAddOns(selections);
    const readable = selections
      .map(({ id, qty }) => {
        const a = addOnById.get(id);
        return a ? (a.countable && (qty ?? 1) > 1 ? `${a.label} x${qty}` : a.label) : id;
      })
      .join(', ');

    const answersReadable = Object.entries(state.answers).map(([qid, oi]) => {
      const question = (flow.questions[state.categoryId!] ?? []).find((x: any) => x.id === qid);
      return question ? `${question.ask} ${question.options[oi]?.label}` : '';
    }).filter(Boolean).join(' | ');

    const set = (n: string, v: string) => {
      const el = form.querySelector<HTMLInputElement>(`[data-cfg-field="${n}"]`);
      if (el) el.value = v;
    };
    set('event_type', state.categoryId ?? '');
    set('event_region', state.region ?? '');
    set('package_id', state.packageId ?? '');
    set('package_name', pkg?.name ?? '');
    set('addons_json', JSON.stringify(selections));
    set('addons_readable', readable);
    set('estimate_total', pkg?.price != null ? String(pkg.price + t.addOnsTotal) : '');
    set('answers_readable', answersReadable);
    set('source_page', window.location.pathname);

    // The configuration also goes into message, because promote() drops Raw.
    const msgEl = form.querySelector<HTMLTextAreaElement>('#cfg-message')!;
    const summary = [
      pkg ? `Package: ${pkg.name}` : '',
      answersReadable ? `Answers: ${answersReadable}` : '',
      readable ? `Add ons: ${readable}` : '',
      pkg?.price != null ? `Estimate: ${money(pkg.price + t.addOnsTotal)}` : '',
    ].filter(Boolean).join('\n');
    msgEl.value = [msgEl.value.trim(), summary].filter(Boolean).join('\n\n');

    const body = new FormData(form);
    body.delete('_gotcha');
    for (const [k, v] of Object.entries(attributionFields(attribution))) body.set(k, v);

    submit.setAttribute('aria-busy', 'true');
    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = 'Sending';
    const err = q('[data-cfg-form-error]')!;
    err.hidden = true;

    try {
      const res = await fetch(form.action, { method: 'POST', body, cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      cancelDwell();
      try { localStorage.removeItem(STORE); } catch { /* noop */ }
      stepEls.forEach((el) => { el.hidden = true; });
      q('[data-cfg-total]')!.hidden = true;
      q('[data-cfg-nav]')!.hidden = true;
      const done = q('[data-step="done"]')!;
      done.hidden = false;
      done.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch {
      submit.removeAttribute('aria-busy');
      submit.disabled = false;
      submit.textContent = label;
      err.hidden = false;
      err.textContent = 'That did not send. Message me on Instagram at kash.klicks and I will pick it up there.';
    }
  });

  render();
}
