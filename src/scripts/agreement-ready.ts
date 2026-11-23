// The ready view of the agreement page: built once from the model, then one render function updates it
// for the selection (sharing choice and ticked extras). Every amount and every word around the legal text
// comes from the model (the server's stored values). The page does no arithmetic and builds no wording.
//
// Same import rule as agreement.ts: html.ts, hash.ts, token.ts, format.ts, set.ts, parts.ts and types only.
import type { Choice, StoredSummary } from '../lib/agreement/types';
import { element } from './agreement-doc';
import type { Labels, Model, ReadyPayload } from './agreement-model';

export interface Selection {
  choice: Choice | null;
  ids: string[]; // the ticked extras, in tick box order
}
/** What caused a render: only the line next to that control may speak. */
export type Source = 'init' | 'tick' | 'choice' | 'name' | 'agree' | 'other';

const TEXT = {
  undecidedTotal: 'This is your total if you share your photos. You choose in part 5.',
  ledeNoPage: 'Everything we agreed, in one place. Read it through, then sign at the end.',
  legendNoPage: 'Sharing your work',
  choiceSame: 'Parts 1 and 5 now show your choice.',
  choiceTotal: (total: string) => `Parts 1, 3 and 5 now show your choice. Total: ${total}.`,
  open: 'Hide the full wording',
  closed: (c: number) => `Read the full wording (${c} ${c === 1 ? 'point' : 'points'})`,
  missingName: 'Type your full name.',
  missingAgree: 'Tick the box to agree.',
};
// A line written quietly gets its own aria-live back this long after the write. A timer, not the next frame:
// Chrome and Firefox hand a change to the screen reader after the frame callbacks, so a line put back in the
// next frame is still read out.
const MUTE_MS = 500;
const CHECK_SVG =
  '<svg class="agr-opt-mark" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 8.5l3 3 6-7"></path></svg>';
const CHEVRON_SVG =
  '<svg class="agr-disc__chev" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M3.5 6l4.5 4.5L12.5 6"></path></svg>';

/** An element with attributes and children; strings become text nodes (never parsed as HTML). */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...kids);
  return e;
}
const svg = (markup: string): Element => {
  const t = document.createElement('template');
  t.innerHTML = markup;
  return t.content.firstElementChild!;
};
const dlRow = (dt: string, dd: string, attrs: Record<string, string> = {}): HTMLDivElement => el('div', attrs, el('dt', {}, dt), el('dd', {}, dd));

/**
 * The card text of a sharing option: the title up to the first full stop that is followed by a space,
 * and the rest (with its leading space) as the line below. Together they are the stored label exactly.
 */
export function splitOption(label: string): { title: string; sub: string | null } {
  const i = label.indexOf('. ');
  return i < 0 ? { title: label, sub: null } : { title: label.slice(0, i + 1), sub: label.slice(i + 1) };
}

/** The Extras value of the recap and the review: the labels of the ticked extras, or None. */
export const extrasText = (s: StoredSummary): string => (s.extra_labels?.length ? s.extra_labels.join(', ') : 'None');
/** The deposit row text of the recap, the review and the signed view. */
export const depositText = (d: NonNullable<StoredSummary['deposit']>): string => `${d.amount}. ${d.note}`;

/** Inside a main point, the words "part N" link to that part. Nothing else is linked. */
function pointNodes(text: string, parts: Set<number>): (Node | string)[] {
  const out: (Node | string)[] = [];
  const re = /\bpart ([1-7])\b/g;
  let at = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (!parts.has(Number(m[1]))) continue;
    out.push(text.slice(at, m.index), el('a', { href: `#part-${m[1]}` }, m[0]));
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return out.filter((x) => x !== '');
}

/** A tick card, a sharing card or the agree card: input over the whole card, frame, drawn mark, text. */
export function optionCard(input: HTMLInputElement, mark: 'box' | 'dot', text: HTMLElement): HTMLLabelElement {
  input.classList.add('agr-opt-input');
  const drawn =
    mark === 'box'
      ? el('span', { class: 'agr-opt-box', 'aria-hidden': 'true' }, svg(CHECK_SVG))
      : el('span', { class: 'agr-opt-dot', 'aria-hidden': 'true' }, el('span', { class: 'agr-opt-mark' }));
  text.classList.add('agr-opt-text');
  return el('label', { class: 'agr-opt' }, input, el('span', { class: 'agr-opt-frame', 'aria-hidden': 'true' }), drawn, text);
}

/** Empties everything a build fills, so a failed build leaves nothing half built. */
export function clearReady(main: HTMLElement): void {
  for (const sel of ['[data-agr-doc]', '[data-agr-toc]', '[data-agr-glance]', '[data-agr-lede]', '[data-agr-recap]'])
    main.querySelector(sel)?.replaceChildren();
  main.querySelectorAll('[data-agr-view="ready"] [data-agr-total-undecided]').forEach((n) => n.remove());
}

export type ReadyView = ReturnType<typeof buildReady>;

/** Builds the ready view from the model. Throws on any failure (the caller empties it again). */
export function buildReady(main: HTMLElement, model: Model, p: ReadyPayload) {
  const pick = <T extends Element = HTMLElement>(sel: string): T => {
    const e = main.querySelector(sel);
    if (!e) throw new Error(`agreement page: no ${sel}`);
    return e as T;
  };
  const page = model.page;
  const labels: Labels = p.labels;
  const optionLabel: Record<Choice, string> = { share: labels.share_option, private: labels.private_option };
  if (![labels.share_option, labels.private_option, labels.agree_label, labels.name_expected].every((s) => typeof s === 'string') || !Array.isArray(labels.intro_bullets))
    throw new Error('agreement page: labels are malformed');
  const plain = model.mix('share', []).summary;
  const partNums = new Set(model.parts.map((x) => x.n));

  // ---- hero, lede, glance
  pick('[data-agr-title]').textContent = page?.title ?? 'Your agreement';
  pick('[data-agr-who]').textContent = `${p.client_first} and ${p.partner_first} · ${plain.date}`;
  pick('[data-agr-booking]').textContent = `Booking ${p.number}`;
  const ledeLines = page ? page.lede : [TEXT.ledeNoPage];
  pick('[data-agr-lede]').replaceChildren(...ledeLines.map((t, i) => el('p', { class: i === 0 ? 'agr-lede__lead' : 'agr-lede__line' }, t)));
  const glance = pick('[data-agr-glance]');
  const cells: [string, string][] = page ? page.glance.map((g) => [g.label, g.value]) : [['Package', plain.package], ['Date', plain.date]];
  const glanceTotal = el('dd', { 'data-agr-glance-total': '' });
  glance.replaceChildren(
    ...cells.map(([dt, dd]) => el('div', { class: 'agr-glance__cell' }, el('dt', {}, dt), el('dd', {}, dd))),
    el('div', { class: 'agr-glance__cell agr-glance__cell--total' }, el('dt', {}, 'Total'), glanceTotal),
  );

  // ---- contents
  pick('[data-agr-toc]').replaceChildren(
    ...model.parts.map((x) =>
      el('li', {}, el('a', { href: `#part-${x.n}` }, el('span', { class: 'agr-toc__n' }, String(x.n)), ' ', el('span', {}, x.title))),
    ),
    el('li', {}, el('a', { href: '#sign' }, el('span', { class: 'agr-toc__n' }), el('span', {}, 'Sign your agreement'))),
  );

  // ---- the parts
  const docEl = pick('[data-agr-doc]');
  const panels = new Map<number, HTMLElement>();
  const discs = new Map<number, HTMLButtonElement>();
  const secEls = new Map<number, HTMLElement>();
  let totalLine: HTMLElement | null = null;
  let priceLines: HTMLElement | null = null;
  let pay: HTMLElement | null = null;
  let oldPay: HTMLElement | null = null;
  let money: HTMLElement | null = null;
  let extraStatus: HTMLElement | null = null;
  let choiceStatus: HTMLElement | null = null;
  const built: HTMLElement[] = [];
  for (const part of model.parts) {
    const n = part.n;
    const titleId = `agr-part-${n}-title`;
    const sec = el('section', { id: `part-${n}`, class: 'agr-part', 'data-agr-part': String(n), 'aria-labelledby': titleId });
    sec.append(
      el('h2', { id: titleId, class: 'agr-part__title', tabindex: '-1' }, el('span', { class: 'agr-part__n' }, String(n)), ' ', el('span', {}, part.title)),
    );
    if (n === 3) {
      money = el('div', { class: 'agr-money' });
      if (page) {
        totalLine = el('p', { class: 'agr-total-line', 'data-agr-total-line': '' });
        priceLines = el('dl', { class: 'agr-price-lines', 'data-agr-price-lines': '' });
        pay = el('ol', { class: 'agr-pay', 'data-agr-pay': '', role: 'list', 'aria-label': 'Your payments' });
        money.append(totalLine, priceLines, pay);
      } else {
        oldPay = el('dl', { class: 'agr-rows', 'data-agr-old-pay': '' });
        money.append(oldPay);
      }
      sec.append(money);
    }
    if (part.points.length || (n === 1 && page)) {
      const box = el('div', { class: 'agr-points' });
      if (part.points.length)
        box.append(
          el('h3', { class: 'agr-points__title' }, 'The main points'),
          el('ul', { class: 'agr-points__list', 'data-agr-points': String(n) }, ...part.points.map((t) => el('li', {}, ...pointNodes(t, partNums)))),
        );
      if (n === 1 && page) box.append(el('p', { class: 'agr-points__note', 'data-agr-note': '' }, page.note));
      sec.append(box);
    }
    if (n === 4 && page && (model.ticks.length || page.extras.booked.length || page.extras.more.length)) {
      const box = el('div', { class: 'agr-extras', 'data-agr-extras': '' });
      if (model.ticks.length) box.append(el('p', { class: 'agr-extras__intro', 'data-agr-extras-intro': '' }, page.extras.intro));
      if (page.extras.booked.length)
        box.append(
          el('h3', { class: 'agr-points__title' }, page.extras.booked_title),
          el('ul', { class: 'agr-points__list', 'data-agr-booked': '' }, ...page.extras.booked.map((t) => el('li', {}, t))),
        );
      if (model.ticks.length) {
        const set = el('fieldset', { class: 'agr-opts', 'data-agr-controls': '', 'aria-label': 'Extras you can add' });
        for (const t of model.ticks) {
          const input = el('input', { type: 'checkbox', value: t.id, 'data-agr-extra': t.id });
          const text = el(
            'span',
            {},
            el('span', { class: 'agr-opt-head' }, el('span', { class: 'agr-opt-title' }, t.label), ' ', el('span', { class: 'agr-opt-price' }, t.price)),
            ' ',
            el('span', { class: 'agr-opt-sub' }, t.blurb),
          );
          set.append(optionCard(input, 'box', text));
        }
        extraStatus = el('p', { class: 'agr-status', 'data-agr-extra-status': '', role: 'status' });
        box.append(set, extraStatus);
      }
      if (page.extras.more.length)
        box.append(
          el('h3', { class: 'agr-points__title' }, page.extras.more_title),
          el('ul', { class: 'agr-points__list agr-points__list--quiet', 'data-agr-more': '' }, ...page.extras.more.map((t) => el('li', {}, t))),
        );
      sec.append(box);
    }
    if (n === 5) {
      const points = page?.sharing.points ?? [];
      const set = el('fieldset', {
        id: 'agr-sharing',
        class: 'agr-opts agr-sharing',
        'data-agr-sharing': '',
        'data-agr-controls': '',
        ...(points.length ? { 'aria-describedby': 'agr-sharing-points' } : {}),
      });
      set.append(el('legend', { class: 'agr-sharing__legend' }, page?.sharing.legend ?? TEXT.legendNoPage));
      if (points.length) set.append(el('ul', { id: 'agr-sharing-points', class: 'agr-points__list agr-sharing__points' }, ...points.map((t) => el('li', {}, t))));
      for (const c of ['share', 'private'] as const) {
        const input = el('input', { type: 'radio', name: 'agr-choice', value: c, 'data-agr-choice': c });
        const { title, sub } = splitOption(optionLabel[c]);
        const text = el('span', { [`data-agr-${c}-option`]: '' }, el('span', { class: 'agr-opt-title' }, title));
        if (sub !== null) text.append(el('span', { class: 'agr-opt-sub' }, sub));
        set.append(optionCard(input, 'dot', text));
      }
      choiceStatus = el('p', { class: 'agr-status', 'data-agr-choice-status': '', role: 'status' });
      sec.append(set, choiceStatus);
    }
    const panel = el('div', { id: `agr-full-${n}`, class: 'agr-full', 'data-agr-full': String(n) });
    if (!page) panel.setAttribute('data-agr-open', '');
    if (n === 1) panel.append(el('p', { class: 'agr-doc-title', 'data-agr-doc-title': '' }, model.title), el('p', { class: 'agr-intro', 'data-agr-doc-intro': '' }, model.intro));
    for (const num of part.sections) {
      const holder = el('section', { id: `sec-${num}` }); // replaced by the first render
      panel.append(holder);
      secEls.set(num, holder);
    }
    if (n === model.parts[model.parts.length - 1].n)
      panel.append(el('p', { class: 'agr-bizline', 'data-agr-business-signature': '' }, model.business_signature));
    if (page) {
      const b = el(
        'button',
        { type: 'button', class: 'agr-disc', 'data-agr-disc': String(n), 'aria-expanded': 'false', 'aria-controls': `agr-full-${n}`, 'aria-describedby': titleId },
        el('span', { class: 'agr-disc__label' }),
        svg(CHEVRON_SVG),
      );
      discs.set(n, b);
      sec.append(b);
    }
    sec.append(panel);
    panels.set(n, panel);
    built.push(sec);
  }
  docEl.replaceChildren(...built);

  // ---- the sign block
  const recap = pick('[data-agr-recap]');
  const recapDd: Record<string, HTMLElement> = {};
  const recapRow = (key: string, dt: string) => {
    const dd = el('dd', {});
    recapDd[key] = dd;
    return el('div', { 'data-agr-recap-row': key }, el('dt', {}, dt), dd);
  };
  const recapTotal = recapRow('total', 'Total');
  const recapDue = recapRow('due', 'Due today, the retainer');
  recap.replaceChildren(
    ...(model.ticks.length ? [recapRow('extras', 'Extras')] : []),
    recapRow('sharing', 'Sharing'),
    recapTotal,
    recapDue,
  );
  pick('[data-agr-bullets]').replaceChildren(...labels.intro_bullets.map((b) => el('li', {}, b)));
  pick('[data-agr-agree-label]').textContent = labels.agree_label;
  pick<HTMLInputElement>('[data-agr-name]').placeholder = labels.name_expected;
  pick('[data-agr-signer]').textContent = `Only ${labels.name_expected} can sign this agreement.`;
  const missingEl = pick('[data-agr-missing]');

  // ---- render state
  const shown = new Map<number, string>(); // section number -> the HTML on screen
  const counts = new Map<number, number>();
  let extraTouched = false;
  let priceKey = '';
  let payKey = '';
  let oldPayKey = '';

  const muted = new Map<HTMLElement, number>(); // a quiet line -> the timer that gives its aria-live back
  /**
   * Writes a line only when it changes. A line that is not the one next to the used control is written
   * muted: aria-live off, then its own value again after MUTE_MS. One timer per line: a newer write on the
   * line replaces it, and a speaking write puts the value back at once and cancels it. `home` is that value
   * (null: the implicit one of role=status), fixed here so overlapping writes can never leave it off.
   */
  const write = (node: HTMLElement, text: string, speak: boolean, home: 'polite' | null, build?: () => (Node | string)[]) => {
    if (node.textContent === text) return;
    const back = () => {
      if (home === null) node.removeAttribute('aria-live');
      else node.setAttribute('aria-live', home);
    };
    window.clearTimeout(muted.get(node));
    muted.delete(node);
    if (speak) back();
    else node.setAttribute('aria-live', 'off');
    if (build) node.replaceChildren(...build());
    else node.textContent = text;
    if (!speak)
      muted.set(
        node,
        window.setTimeout(() => {
          muted.delete(node);
          back();
        }, MUTE_MS),
      );
  };
  const undecidedLine = () => el('p', { class: 'agr-undecided', 'data-agr-total-undecided': '' }, TEXT.undecidedTotal);
  /** The undecided total line right after `after`: present or not. */
  const placeUndecided = (on: boolean, after: Element) => {
    const next = after.nextElementSibling;
    const there = next?.matches('[data-agr-total-undecided]') ? next : null;
    if (on && !there) after.after(undecidedLine());
    if (!on && there) there.remove();
  };
  /** One child element of `parent` matching sel, created after `after` or removed. */
  const placeOne = (parent: Element, sel: string, make: (() => HTMLElement) | null, after: Element | null) => {
    const old = parent.querySelector(`:scope > ${sel}`);
    if (!make) return old?.remove();
    const node = make();
    if (old) {
      if (old.outerHTML !== node.outerHTML) old.replaceWith(node);
    } else if (after) after.after(node);
    else parent.append(node);
  };

  function discLabel(n: number) {
    const b = discs.get(n);
    if (!b) return;
    const open = panels.get(n)!.hasAttribute('data-agr-open');
    const label = b.querySelector('.agr-disc__label')!;
    const text = open ? TEXT.open : TEXT.closed(counts.get(n) ?? 0);
    if (label.textContent !== text) label.textContent = text;
    b.setAttribute('aria-expanded', String(open));
  }

  /**
   * Shows the selection. Everything is worked out first, then the DOM is touched. `anchor` is the
   * control just used: it stays where it was on screen.
   */
  function render(sel: Selection, src: Source, form: { name: boolean; agree: boolean }, anchor: Element | null = null) {
    // 1. Work out what to show.
    const share = model.mix('share', sel.ids);
    const priv = model.mix('private', sel.ids);
    const m = sel.choice === 'private' ? priv : share; // before a choice: the share document
    const s = m.summary;
    const sameTotals = share.summary.total === priv.summary.total;
    const undecided = sel.choice === null && !sameTotals;
    const sections = sel.choice ? m.sections : model.undecided(sel.ids);
    const deposit = s.deposit ?? null;
    if (src === 'tick') extraTouched = true;
    const extraText = extraTouched ? `Total: ${s.total}.${deposit ? ` ${deposit.label}: ${deposit.amount}.` : ''}` : '';
    const choiceText = sel.choice === null ? '' : sameTotals ? TEXT.choiceSame : TEXT.choiceTotal(s.total);
    const missingParts: (Node | string)[][] = [];
    if (!form.name) missingParts.push([TEXT.missingName]);
    if (sel.choice === null)
      missingParts.push(['Pick a sharing option in ', el('a', { href: '#agr-sharing', 'data-agr-missing-jump': '' }, 'part 5'), '.']);
    if (!form.agree) missingParts.push([TEXT.missingAgree]);
    const missingText = missingParts.map((x) => x.map((n) => (typeof n === 'string' ? n : n.textContent)).join('')).join(' ');
    const sharingText = sel.choice ? splitOption(optionLabel[sel.choice]).title.replace(/\.$/, '') : 'Not chosen yet';
    const priceNext = s.price_lines ? JSON.stringify(s.price_lines) : '';
    const payNext = s.steps ? JSON.stringify(s.steps) : '';
    const later = s.later_payments?.length ? s.later_payments : null;
    const oldRows: [string, string][] = [
      ['Total', s.total],
      ['Retainer', s.retainer],
      ...(later
        ? later.map((r): [string, string] => [r.label, r.text])
        : [['Balance', typeof s.balance_how === 'string' ? `${s.balance}, ${s.balance_how}` : s.balance] as [string, string]]),
    ];
    const oldNext = JSON.stringify(oldRows);
    const before = anchor ? anchor.getBoundingClientRect().top : 0;

    // 2. Touch the DOM.
    if (glanceTotal.textContent !== s.total) glanceTotal.textContent = s.total;
    placeUndecided(undecided, glance);
    if (totalLine && totalLine.textContent !== s.total_line) totalLine.textContent = s.total_line ?? '';
    if (priceLines && priceKey !== priceNext) {
      priceLines.replaceChildren(...(s.price_lines ?? []).map((r) => dlRow(r.label, r.amount)));
      priceKey = priceNext;
    }
    if (pay && payKey !== payNext) {
      pay.replaceChildren(
        ...(s.steps ?? []).map((st, i) =>
          el(
            'li',
            { class: 'agr-pay__step' },
            el('span', { class: 'agr-pay__n' }, String(i + 1)),
            el('span', { class: 'agr-pay__title' }, st.title),
            el('span', { class: 'agr-pay__amount' }, st.amount),
            el('span', { class: 'agr-pay__note' }, st.note),
          ),
        ),
      );
      payKey = payNext;
    }
    if (oldPay && oldPayKey !== oldNext) {
      oldPay.replaceChildren(...oldRows.map(([dt, dd]) => dlRow(dt, dd)));
      oldPayKey = oldNext;
    }
    if (money) {
      placeUndecided(undecided, totalLine ?? oldPay!);
      placeOne(
        money,
        '[data-agr-deposit-line]',
        pay && deposit ? () => el('p', { class: 'agr-deposit-line', 'data-agr-deposit-line': '' }, `${deposit.label}: ${depositText(deposit)}`) : null,
        pay,
      );
    }
    // The recap.
    if (recapDd.extras && recapDd.extras.textContent !== extrasText(s)) recapDd.extras.textContent = extrasText(s);
    if (recapDd.sharing.textContent !== sharingText) recapDd.sharing.textContent = sharingText;
    if (recapDd.total.textContent !== s.total) recapDd.total.textContent = s.total;
    placeUndecided(undecided, recapDd.total);
    if (recapDd.due.textContent !== s.retainer) recapDd.due.textContent = s.retainer;
    placeOne(recap, '[data-agr-recap-row="deposit"]', deposit ? () => dlRow(deposit.label, depositText(deposit), { 'data-agr-recap-row': 'deposit' }) : null, recapDue);
    // The sections: only those whose HTML changed, so open panels do not jump.
    for (const num of model.order) {
      const html = sections.get(num)!;
      if (shown.get(num) === html) continue;
      const node = element(html);
      secEls.get(num)!.replaceWith(node);
      secEls.set(num, node);
      shown.set(num, html);
    }
    // The disclosure counts, from the shown mix's document.
    for (const [n, c] of m.counts) counts.set(n, c);
    for (const n of discs.keys()) discLabel(n);
    // The lines that speak: only the one next to the control used.
    if (extraStatus) write(extraStatus, extraText, src === 'tick', null);
    if (choiceStatus) write(choiceStatus, choiceText, src === 'choice', null);
    write(missingEl, missingText, src === 'name' || src === 'agree', 'polite', () =>
      missingParts.flatMap((x, i) => (i === 0 ? x : [' ', ...x])),
    );

    // 3. Keep the control just used where the reader's eyes are.
    if (anchor) {
      const delta = anchor.getBoundingClientRect().top - before;
      if (delta) window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
    }
  }

  /** Opens or closes one panel. Any number can be open. */
  function toggle(n: number) {
    const panel = panels.get(n);
    const b = discs.get(n);
    if (!panel || !b) return;
    const open = !panel.hasAttribute('data-agr-open');
    if (open) panel.setAttribute('data-agr-open', '');
    else panel.removeAttribute('data-agr-open');
    discLabel(n);
    if (!open) {
      const r = b.getBoundingClientRect();
      const ribbon = document.querySelector<HTMLElement>('[data-agr-ribbon]');
      const top = ribbon && !ribbon.hidden ? ribbon.getBoundingClientRect().bottom : 0;
      if (r.top < top || r.bottom > window.innerHeight) b.scrollIntoView({ block: 'nearest', behavior: 'instant' as ScrollBehavior });
    }
  }

  return { render, toggle, optionLabel };
}
