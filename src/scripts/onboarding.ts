// Page script for the client shoot brief (/welcome/brief-.../).
//
// Responsibilities, in load order:
//   1. Restore the localStorage draft (couples fill this across sittings).
//   2. Apply the personal link (?b=&p=&n1=&n2=&d=), filling only empty fields,
//      then strip those params from the address bar so names never reach
//      analytics (the pixels boot after window load, this runs before).
//   3. Wire the pickers: location rank badges, film notes, "Add another".
//   4. Autosave on every change, validate with the shared schema on submit,
//      post JSON to /r/onboarding, and swap in the done state.
//
// Selectors are plain strings where possible so
// scripts/check-onboarding-selectors.mjs can confirm they exist in the build.

import schemaJson from '../data/onboarding-fields.json';
import {
  allFields,
  cleanBookingId,
  coupleName,
  isUuid,
  validate,
  validateField,
  type Payload,
  type Schema,
} from '../lib/onboarding';

const schema = schemaJson as unknown as Schema;
const FIELDS = allFields(schema);
const FIELD_BY_NAME = new Map(FIELDS.map((f) => [f.name, f]));
const STORE = schema.meta.storagePrefix + schema.meta.path;
const PREFILL_CAP = 80;
const PREFILL_KEYS = ['b', 'p', 'n1', 'n2', 'd'];

interface Draft {
  v: 1;
  data: Payload;
  locOrder: string[];
  key: string;
  bookingId: string;
  at: number;
}

function uuid(): string {
  try {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function readDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1 || typeof d.data !== 'object' || d.data === null) return null;
    return {
      v: 1,
      data: d.data,
      locOrder: Array.isArray(d.locOrder) ? d.locOrder.filter((x: unknown) => typeof x === 'string') : [],
      key: isUuid(d.key) ? d.key : uuid(),
      bookingId: cleanBookingId(d.bookingId),
      at: typeof d.at === 'number' ? d.at : Date.now(),
    };
  } catch {
    return null;
  }
}

function writeDraft(d: Draft): boolean {
  try {
    localStorage.setItem(STORE, JSON.stringify(d));
    return true;
  } catch {
    return false;
  }
}

function clearDraft(): void {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* private mode */
  }
}

const clock = (t: number): string => {
  try {
    return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  } catch {
    return '';
  }
};

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

export function initOnboarding(): void {
  const form = document.querySelector<HTMLFormElement>('#onb-form');
  const root = document.querySelector<HTMLElement>('[data-onb-root]');
  if (!form || !root || form.dataset.bound) return;
  form.dataset.bound = '1';

  const doneEl = root.querySelector<HTMLElement>('[data-onb-done]');
  const jumpEl = root.querySelector<HTMLElement>('.onb-jump');
  const errorEl = form.querySelector<HTMLElement>('[data-onb-error]');
  const problemEl = form.querySelector<HTMLElement>('[data-onb-problem]');
  const submitBtn = form.querySelector<HTMLButtonElement>('[data-onb-submit]');
  const submitLabel = form.querySelector<HTMLElement>('[data-onb-submit-label]');
  const savedEls = Array.from(root.querySelectorAll<HTMLElement>('[data-onb-saved]'));
  const bookingInput = form.querySelector<HTMLInputElement>('#onb-booking-id');
  const keyInput = form.querySelector<HTMLInputElement>('#onb-idempotency-key');
  const payloadInput = form.querySelector<HTMLInputElement>('#onb-payload-json');
  const honeypot = form.querySelector<HTMLInputElement>('#onb-gotcha');
  const greeting = document.querySelector<HTMLElement>('[data-onb-greeting]');
  const doneNames = root.querySelector<HTMLElement>('[data-onb-done-names]');

  const draft = readDraft();
  let idemKey = draft?.key ?? uuid();
  let bookingId = draft?.bookingId ?? '';
  let locOrder: string[] = [];
  let sending = false;

  const named = (name: string): Control | null => {
    const el = form.elements.namedItem(name);
    return el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement ? el : null;
  };
  const inputsNamed = (name: string): HTMLInputElement[] =>
    Array.from(form.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`));
  const wrapOf = (name: string): HTMLElement | null => form.querySelector<HTMLElement>(`[data-onb-field="${name}"]`);

  // ── Locations ─────────────────────────────────────────────────────────
  const locRoot = form.querySelector<HTMLElement>('[data-onb-locs]');
  const locMax = Number(locRoot?.dataset.max ?? 8) || 8;
  const locInputs = new Map<string, HTMLInputElement>();
  form.querySelectorAll<HTMLInputElement>('.onb-loc-input').forEach((el) => locInputs.set(el.value, el));
  const locSlots = Array.from(form.querySelectorAll<HTMLElement>('[data-loc-slot]'));
  const locEmpty = form.querySelector<HTMLElement>('[data-loc-empty]');
  const locCap = form.querySelector<HTMLElement>('[data-loc-cap]');
  const locGroups = Array.from(form.querySelectorAll<HTMLDetailsElement>('[data-loc-group]'));
  const locItems = Array.from(form.querySelectorAll<HTMLElement>('[data-loc-item]'));
  const locSearch = form.querySelector<HTMLInputElement>('[data-loc-search]');
  const locNone = form.querySelector<HTMLElement>('[data-loc-none]');

  function renderLocs(): void {
    locInputs.forEach((input, id) => {
      const rank = locOrder.indexOf(id) + 1;
      input.checked = rank > 0;
      const badge = input.closest('label')?.querySelector<HTMLElement>('[data-loc-badge]');
      if (badge) badge.textContent = rank > 0 ? String(rank) : '';
    });
    locSlots.forEach((slot, i) => {
      const id = locOrder[i];
      slot.hidden = !id;
      const name = id ? locInputs.get(id)?.dataset.locName ?? id : '';
      const nameEl = slot.querySelector<HTMLElement>('[data-loc-slot-name]');
      const srEl = slot.querySelector<HTMLElement>('[data-loc-slot-sr]');
      if (nameEl) nameEl.textContent = name;
      if (srEl) srEl.textContent = name ? ` ${name}` : '';
    });
    if (locEmpty) locEmpty.hidden = locOrder.length > 0;
    if (locCap && locOrder.length < locMax) locCap.hidden = true;
    locGroups.forEach((group) => {
      const count = Array.from(group.querySelectorAll<HTMLInputElement>('.onb-loc-input')).filter((i) => i.checked).length;
      const countEl = group.querySelector<HTMLElement>('[data-loc-group-count]');
      if (countEl) {
        countEl.hidden = count === 0;
        countEl.textContent = `${count} picked`;
      }
    });
  }

  locInputs.forEach((input, id) => {
    input.addEventListener('change', () => {
      if (input.checked) {
        if (locOrder.length >= locMax) {
          input.checked = false;
          if (locCap) locCap.hidden = false;
          return;
        }
        if (!locOrder.includes(id)) locOrder.push(id);
      } else {
        locOrder = locOrder.filter((x) => x !== id);
      }
      renderLocs();
    });
  });

  locSlots.forEach((slot, i) => {
    slot.querySelector<HTMLButtonElement>('[data-loc-remove]')?.addEventListener('click', () => {
      const id = locOrder[i];
      if (!id) return;
      locOrder = locOrder.filter((x) => x !== id);
      renderLocs();
      scheduleSave();
      const next = locSlots[Math.min(i, locOrder.length - 1)];
      (next && !next.hidden ? next.querySelector<HTMLElement>('[data-loc-remove]') : locSearch)?.focus();
    });
  });

  locSearch?.addEventListener('input', () => {
    const q = locSearch.value.trim().toLowerCase();
    let any = false;
    locItems.forEach((item) => {
      const match = !q || (item.dataset.haystack ?? '').includes(q);
      item.hidden = !match;
      if (match) any = true;
    });
    locGroups.forEach((group, gi) => {
      const has = Array.from(group.querySelectorAll<HTMLElement>('[data-loc-item]')).some((i) => !i.hidden);
      group.hidden = !has;
      if (q) group.open = has;
      else group.open = gi === 0 || group.querySelector('.onb-loc-input:checked') !== null;
    });
    if (locNone) locNone.hidden = any;
  });

  // ── Films ─────────────────────────────────────────────────────────────
  const filmRows = Array.from(form.querySelectorAll<HTMLElement>('.onb-film'));
  const syncFilm = (row: HTMLElement): void => {
    const pick = row.querySelector<HTMLInputElement>('[data-film-pick]');
    row.toggleAttribute('data-picked', !!pick?.checked);
  };
  filmRows.forEach((row) => {
    const pick = row.querySelector<HTMLInputElement>('[data-film-pick]');
    const note = row.querySelector<HTMLInputElement>('[data-film-note]');
    pick?.addEventListener('change', () => syncFilm(row));
    note?.addEventListener('input', () => {
      if (pick && note.value.trim() && !pick.checked) {
        pick.checked = true;
        syncFilm(row);
      }
    });
  });

  // ── Repeat rows ───────────────────────────────────────────────────────
  const repeats = Array.from(form.querySelectorAll<HTMLElement>('[data-onb-repeat]'));
  function syncRepeat(block: HTMLElement): void {
    const rows = Array.from(block.querySelectorAll<HTMLElement>('[data-repeat-row]'));
    const btn = block.querySelector<HTMLButtonElement>('[data-repeat-add]');
    // Reveal every row up to the last one holding a value.
    let last = 0;
    rows.forEach((r, i) => {
      if (Array.from(r.querySelectorAll('input')).some((x) => x.value.trim())) last = i;
    });
    rows.forEach((r, i) => {
      if (i <= last) r.hidden = false;
    });
    if (btn) btn.hidden = rows.every((r) => !r.hidden);
  }
  repeats.forEach((block) => {
    const btn = block.querySelector<HTMLButtonElement>('[data-repeat-add]');
    btn?.addEventListener('click', () => {
      const next = Array.from(block.querySelectorAll<HTMLElement>('[data-repeat-row]')).find((r) => r.hidden);
      if (next) {
        next.hidden = false;
        next.querySelector<HTMLInputElement>('input')?.focus();
      }
      syncRepeat(block);
    });
  });

  // ── Options that depend on another answer (third location) ────────────
  const gated = Array.from(form.querySelectorAll<HTMLInputElement>('[data-only-with]'));
  function syncGated(): void {
    gated.forEach((input) => {
      let ok = true;
      try {
        const rule = JSON.parse(input.dataset.onlyWith ?? '{}') as Record<string, string[]>;
        for (const [other, allowed] of Object.entries(rule)) {
          if (!allowed.includes(named(other)?.value ?? '')) ok = false;
        }
      } catch {
        ok = true;
      }
      input.disabled = !ok;
      if (!ok && input.checked) input.checked = false;
    });
  }

  // ── Read and write the whole form ─────────────────────────────────────
  function collect(): Payload {
    const out: Payload = {};
    for (const f of FIELDS) {
      switch (f.kind) {
        case 'radio':
          out[f.name] = inputsNamed(f.name).find((e) => e.checked)?.value ?? '';
          break;
        case 'checkboxes':
          out[f.name] = inputsNamed(f.name).filter((e) => e.checked).map((e) => e.value);
          break;
        case 'checkbox':
          out[f.name] = !!inputsNamed(f.name)[0]?.checked;
          break;
        case 'films':
          out[f.name] = filmRows
            .map((row) => ({
              id: row.dataset.filmId ?? '',
              title: row.dataset.filmTitle ?? '',
              note: row.querySelector<HTMLInputElement>('[data-film-note]')?.value.trim() ?? '',
              picked: !!row.querySelector<HTMLInputElement>('[data-film-pick]')?.checked,
            }))
            .filter((x) => x.picked || x.note)
            .map(({ id, title, note }) => ({ id, title, note }));
          break;
        case 'locations':
          out[f.name] = locOrder.map((id) => ({ id, name: locInputs.get(id)?.dataset.locName ?? id }));
          break;
        case 'repeat': {
          const rows: Record<string, string>[] = [];
          for (let i = 0; i < (f.rows ?? 3); i++) {
            const row: Record<string, string> = {};
            for (const c of f.columns ?? []) row[c.name] = named(`${f.name}.${i}.${c.name}`)?.value ?? '';
            rows.push(row);
          }
          out[f.name] = rows;
          break;
        }
        default:
          out[f.name] = named(f.name)?.value ?? '';
      }
    }
    return out;
  }

  function apply(data: Payload): void {
    for (const f of FIELDS) {
      const v = data[f.name];
      if (v === undefined || v === null) continue;
      switch (f.kind) {
        case 'radio':
          inputsNamed(f.name).forEach((e) => (e.checked = e.value === v));
          break;
        case 'checkboxes': {
          const list = Array.isArray(v) ? v : [];
          inputsNamed(f.name).forEach((e) => (e.checked = list.includes(e.value)));
          break;
        }
        case 'checkbox': {
          const el = inputsNamed(f.name)[0];
          if (el) el.checked = v === true;
          break;
        }
        case 'films': {
          const list = (Array.isArray(v) ? v : []) as Record<string, string>[];
          filmRows.forEach((row) => {
            const hit = list.find((x) => x && x.id === row.dataset.filmId);
            const pick = row.querySelector<HTMLInputElement>('[data-film-pick]');
            const note = row.querySelector<HTMLInputElement>('[data-film-note]');
            if (pick) pick.checked = !!hit;
            if (note) note.value = hit?.note ?? '';
            syncFilm(row);
          });
          break;
        }
        case 'locations':
          // Restored from draft.locOrder, which keeps the rank order.
          break;
        case 'repeat': {
          const rows = (Array.isArray(v) ? v : []) as Record<string, string>[];
          for (let i = 0; i < (f.rows ?? 3); i++) {
            for (const c of f.columns ?? []) {
              const el = named(`${f.name}.${i}.${c.name}`);
              if (el) el.value = typeof rows[i]?.[c.name] === 'string' ? rows[i][c.name] : '';
            }
          }
          break;
        }
        default: {
          const el = named(f.name);
          if (el && typeof v === 'string') el.value = v;
        }
      }
    }
  }

  function refreshAll(): void {
    syncGated();
    renderLocs();
    repeats.forEach(syncRepeat);
    // Open any optional block that already holds an answer.
    form.querySelectorAll<HTMLDetailsElement>('[data-onb-extras]').forEach((d) => {
      const hasValue = Array.from(d.querySelectorAll<Control>('input, textarea, select')).some((c) =>
        c instanceof HTMLInputElement && (c.type === 'checkbox' || c.type === 'radio') ? c.checked : c.value.trim() !== '',
      );
      if (hasValue) d.open = true;
    });
    locGroups.forEach((g) => {
      if (g.querySelector('.onb-loc-input:checked')) g.open = true;
    });
    const p1 = named('p1_name')?.value.trim();
    const p2 = named('p2_name')?.value.trim();
    if (greeting) {
      greeting.hidden = !(p1 || p2);
      greeting.textContent = p1 || p2 ? `For ${[p1, p2].filter(Boolean).join(' and ')}` : '';
    }
  }

  // ── Draft autosave ────────────────────────────────────────────────────
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function setSaved(text: string): void {
    savedEls.forEach((el) => (el.textContent = text));
  }
  function save(): void {
    clearTimeout(saveTimer);
    const ok = writeDraft({ v: 1, data: collect(), locOrder, key: idemKey, bookingId, at: Date.now() });
    setSaved(ok ? `Saved on this device at ${clock(Date.now())}` : 'This browser is not saving drafts, so please finish in one sitting.');
  }
  function scheduleSave(): void {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  // ── Errors ────────────────────────────────────────────────────────────
  function clearError(name: string): void {
    const w = wrapOf(name);
    if (!w) return;
    w.removeAttribute('data-invalid');
    const msg = w.querySelector<HTMLElement>('.form-error-msg');
    if (msg) {
      msg.textContent = '';
      msg.hidden = true;
    }
    w.querySelectorAll('[aria-invalid]').forEach((c) => c.removeAttribute('aria-invalid'));
  }
  function setError(name: string, message: string): void {
    const w = wrapOf(name);
    if (!w) return;
    w.setAttribute('data-invalid', '');
    const msg = w.querySelector<HTMLElement>('.form-error-msg');
    if (msg) {
      msg.textContent = message;
      msg.hidden = false;
    }
    const kind = FIELD_BY_NAME.get(name)?.kind;
    if (kind !== 'locations' && kind !== 'films') {
      w.querySelectorAll<Control>('input, select, textarea').forEach((c) => c.setAttribute('aria-invalid', 'true'));
    }
  }
  function setWarning(name: string, message: string): void {
    const el = wrapOf(name)?.querySelector<HTMLElement>('[data-onb-warn]');
    if (!el) return;
    el.textContent = message;
    el.hidden = !message;
  }
  function showErrors(errors: Record<string, string>): void {
    let first: HTMLElement | null = null;
    // Walk in schema order so focus lands on the earliest problem.
    for (const f of FIELDS) {
      const message = errors[f.name];
      if (!message) continue;
      setError(f.name, message);
      if (!first) first = wrapOf(f.name);
    }
    if (!first) return;
    const details = first.closest('details');
    if (details) details.open = true;
    const target =
      FIELD_BY_NAME.get(first.dataset.onbField ?? '')?.kind === 'locations'
        ? locSearch
        : first.querySelector<HTMLElement>('input:not([type="hidden"]):not([disabled]), select, textarea');
    target?.focus();
    if (target) target.scrollIntoView({ block: 'center' });
  }

  // Per field checks while typing, so link warnings show before submit.
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const w = t.closest<HTMLElement>('[data-onb-field]');
    const name = w?.dataset.onbField;
    const field = name ? FIELD_BY_NAME.get(name) : undefined;
    if (field && (field.kind === 'url' || field.kind === 'repeat')) {
      const payload = collect();
      const outcome = validateField(field, payload[field.name], payload, schema);
      setWarning(field.name, outcome.warning ?? '');
      if (outcome.error) setError(field.name, outcome.error);
    }
    if (t.matches('select')) syncGated();
    scheduleSave();
  });
  form.addEventListener('input', (e) => {
    const name = (e.target as HTMLElement).closest<HTMLElement>('[data-onb-field]')?.dataset.onbField;
    if (name) clearError(name);
    if (name === 'locations_own' || name === 'locations') clearError('locations');
    if (problemEl) problemEl.hidden = true;
    if (name === 'p1_name' || name === 'p2_name') refreshAll();
    scheduleSave();
  });
  locInputs.forEach((input) => input.addEventListener('change', () => clearError('locations')));

  // ── Restore, then pre-fill from the personal link ─────────────────────
  if (draft) {
    locOrder = draft.locOrder.filter((id) => locInputs.has(id)).slice(0, locMax);
    apply(draft.data);
  }

  const params = new URLSearchParams(window.location.search);
  const param = (k: string): string =>
    (params.get(k) ?? '')
      .replace(/[\u0000-\u001F\u007F]/g, '')
      .trim()
      .slice(0, PREFILL_CAP);
  const fillIfEmpty = (name: string, value: string): void => {
    const el = named(name);
    if (el && value && !el.value.trim()) el.value = value;
  };
  const b = cleanBookingId(param('b'));
  if (b) bookingId = b;
  fillIfEmpty('p1_name', param('n1'));
  fillIfEmpty('p2_name', param('n2'));
  const p = param('p');
  const pkgSelect = named('package_id');
  if (p && pkgSelect instanceof HTMLSelectElement && Array.from(pkgSelect.options).some((o) => o.value === p)) {
    fillIfEmpty('package_id', p);
  }
  const d = param('d');
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) fillIfEmpty('shoot_date', d);
  if (PREFILL_KEYS.some((k) => params.has(k))) {
    PREFILL_KEYS.forEach((k) => params.delete(k));
    const qs = params.toString();
    try {
      history.replaceState(history.state, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash);
    } catch {
      /* some in-app browsers block history writes */
    }
  }

  if (bookingInput) bookingInput.value = bookingId;
  if (keyInput) keyInput.value = idemKey;
  refreshAll();
  filmRows.forEach(syncFilm);
  if (draft) setSaved(`Draft from ${new Date(draft.at).toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${clock(draft.at)}`);
  if (b || draft) save();

  window.addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && !sending) save();
  });

  // ── Jump list highlight (desktop only, enhancement) ───────────────────
  const jumpLinks = Array.from(root.querySelectorAll<HTMLAnchorElement>('[data-onb-jump]'));
  if (jumpLinks.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const id = (entry.target as HTMLElement).dataset.onbSection;
          jumpLinks.forEach((a) => a.setAttribute('aria-current', String(a.dataset.onbJump === id)));
        });
      },
      { rootMargin: '-35% 0px -55% 0px' },
    );
    form.querySelectorAll<HTMLElement>('[data-onb-section]').forEach((s) => io.observe(s));
  }

  // ── Submit ────────────────────────────────────────────────────────────
  function setBusy(busy: boolean): void {
    sending = busy;
    if (!submitBtn) return;
    submitBtn.disabled = busy;
    submitBtn.setAttribute('aria-busy', String(busy));
    if (submitLabel) submitLabel.textContent = busy ? 'Sending your brief' : 'Send my brief';
  }

  function showDone(data: Payload): void {
    clearDraft();
    clearTimeout(saveTimer);
    form.hidden = true;
    if (jumpEl) jumpEl.hidden = true;
    if (doneNames) {
      const names = coupleName(data);
      doneNames.textContent = names === 'Unnamed couple' ? 'both of you.' : `${names}.`;
    }
    if (doneEl) {
      doneEl.hidden = false;
      doneEl.scrollIntoView({ block: 'start' });
      doneEl.focus({ preventScroll: true });
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (sending) return;
    if (honeypot && honeypot.value) return;

    FIELDS.forEach((f) => clearError(f.name));
    if (problemEl) problemEl.hidden = true;
    if (errorEl) errorEl.hidden = true;

    const result = validate(collect(), schema);
    Object.entries(result.warnings).forEach(([name, message]) => setWarning(name, message));
    if (!result.ok) {
      if (problemEl) problemEl.hidden = false;
      showErrors(result.errors);
      return;
    }

    save();
    const json = JSON.stringify(result.data);
    if (payloadInput) payloadInput.value = json;
    const body = new FormData();
    body.set('_gotcha', '');
    body.set('booking_id', bookingId);
    body.set('idempotency_key', idemKey);
    body.set('payload_json', json);
    body.set('source', 'onboarding');

    setBusy(true);
    try {
      const res = await fetch(form.action, { method: 'POST', body, headers: { Accept: 'application/json' } });
      let reply: { ok?: boolean; errors?: Record<string, string> } | null = null;
      try {
        reply = await res.json();
      } catch {
        reply = null;
      }
      if (res.ok && reply?.ok) {
        setBusy(false);
        showDone(result.data);
        return;
      }
      if (res.status === 400 && reply?.errors && Object.keys(reply.errors).length) {
        setBusy(false);
        if (problemEl) problemEl.hidden = false;
        showErrors(reply.errors);
        return;
      }
      throw new Error(`status ${res.status}`);
    } catch {
      setBusy(false);
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.scrollIntoView({ block: 'center' });
      }
    }
  });
}
