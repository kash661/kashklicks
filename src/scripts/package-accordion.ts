/**
 * Mobile package accordion controller (pre-wedding + wedding pages).
 *
 * Below 1024px each `.pricing-card--accordion` inside `#package-grid` becomes a
 * compact tap-to-open row: name + tag/price collapsed, details on tap, one open
 * at a time. On desktop (or with no JS) it does nothing — the cards render fully
 * open, so the UI can never break into a blank state.
 *
 * Single-package pages (civil ceremony, celebrations) deliberately do NOT call
 * this — there is nothing to collapse against, so their card stays an open tile.
 */
export function initPackageAccordion(): void {
  const grid = document.getElementById('package-grid');
  if (!grid) return;
  const cards = Array.from(grid.querySelectorAll<HTMLElement>('.pricing-card--accordion'));
  if (!cards.length) return;

  const mq = window.matchMedia('(max-width: 1023px)');
  const headOf = (card: HTMLElement) => card.querySelector<HTMLElement>('.pricing-card__head');
  const wrapOf = (card: HTMLElement) => card.querySelector<HTMLElement>('.pricing-card__body-wrap');

  function setOpen(card: HTMLElement, open: boolean) {
    card.classList.toggle('is-open', open);
    headOf(card)?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  // Single-open: opening one closes the rest.
  function openOnly(card: HTMLElement) {
    cards.forEach((c) => setOpen(c, c === card));
  }

  function toggle(card: HTMLElement) {
    if (!mq.matches) return; // never touch desktop
    if (card.classList.contains('is-open')) setOpen(card, false);
    else openOnly(card);
  }

  function enhance() {
    if (grid!.dataset.accOn === 'true') return;
    grid!.dataset.accOn = 'true';
    grid!.classList.add('is-enhanced');

    cards.forEach((card, i) => {
      const head = headOf(card);
      const wrap = wrapOf(card);
      if (!head) return;
      if (wrap && !wrap.id) wrap.id = (card.id || 'pkg-' + i) + '-body';
      head.setAttribute('role', 'button');
      head.setAttribute('tabindex', '0');
      head.setAttribute('aria-expanded', 'false');
      if (wrap) head.setAttribute('aria-controls', wrap.id);
      // Concise screen-reader label: name + tag/price, not the full deck.
      const nm = card.querySelector('.pricing-card__name')?.textContent?.trim() || '';
      const sm = card.querySelector('.pricing-card__summary')?.textContent
        ?.replace(/\s+/g, ' ').trim() || '';
      head.setAttribute('aria-label', sm ? nm + ', ' + sm : nm);

      if (head.dataset.accBound !== 'true') {
        head.dataset.accBound = 'true';
        head.addEventListener('click', () => toggle(card));
        head.addEventListener('keydown', (e: KeyboardEvent) => {
          if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            toggle(card);
          }
        });
      }
      card.classList.remove('is-open');
    });

    // Open the on-sale package, else the featured one, else the first.
    const def =
      cards.find((c) => c.dataset.sale === 'true') ||
      cards.find((c) => c.dataset.featured === 'true') ||
      cards[0];
    if (def) openOnly(def);
  }

  function teardown() {
    if (grid!.dataset.accOn !== 'true') return;
    grid!.dataset.accOn = 'false';
    grid!.classList.remove('is-enhanced');
    cards.forEach((card) => {
      card.classList.remove('is-open');
      const head = headOf(card);
      head?.removeAttribute('role');
      head?.removeAttribute('tabindex');
      head?.removeAttribute('aria-expanded');
      head?.removeAttribute('aria-controls');
    });
  }

  const apply = () => (mq.matches ? enhance() : teardown());
  apply();
  mq.addEventListener('change', apply);
}
