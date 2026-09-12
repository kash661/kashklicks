/**
 * Ad attribution capture and the qualified-engagement gate.
 *
 * Lifted from the inline logic in EngagementOfferForm.astro and
 * free-engagement-session-toronto.astro so new surfaces share one copy.
 * Those two files are untouched for now: they carry live paid traffic and
 * refactoring them is its own change, not a side effect of this one.
 */

const UTM_KEYS = ['source', 'medium', 'campaign', 'content', 'term', 'fbclid', 'gclid'] as const;
const STORAGE_KEY = 'kk_attribution';
const LEGACY_KEY = 'eof_attribution';
export const QUALIFIED_FLAG = 'ad_qualified_engagement';

export type Attribution = Partial<Record<(typeof UTM_KEYS)[number], string>>;

const readJSON = (key: string): Attribution => {
  try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; }
};

/**
 * Merge any utm_* / fbclid / gclid on the current URL into session storage and
 * return the accumulated set. Reads the engagement LP's older key too, so a
 * visitor who landed there first keeps their attribution across the session.
 */
export function captureAttribution(): Attribution {
  const params = new URLSearchParams(window.location.search);
  const next: Attribution = { ...readJSON(LEGACY_KEY), ...readJSON(STORAGE_KEY) };
  for (const k of UTM_KEYS) {
    const urlKey = k === 'fbclid' || k === 'gclid' ? k : `utm_${k}`;
    const val = params.get(urlKey);
    if (val) next[k] = val;
  }
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
  return next;
}

/** Everything the intake sheet should receive about where this visitor came from. */
export function attributionFields(attribution: Attribution): Record<string, string> {
  const out: Record<string, string> = {
    page_url: window.location.href,
    referrer: document.referrer || '',
    user_agent: navigator.userAgent,
    submitted_at: new Date().toISOString(),
  };
  for (const k of UTM_KEYS) {
    out[k === 'fbclid' || k === 'gclid' ? k : `utm_${k}`] = attribution[k] || '';
  }
  return out;
}

export const isQualified = (): boolean => {
  try { return sessionStorage.getItem(QUALIFIED_FLAG) === 'true'; } catch { return false; }
};

/**
 * Mark this visitor as a real prospect rather than a tire kicker, so Meta and
 * Google optimise toward the right people. Idempotent for the session.
 */
export function qualify(source: string): void {
  if (isQualified()) return;
  try { sessionStorage.setItem(QUALIFIED_FLAG, 'true'); } catch { /* private mode */ }
  const w = window as unknown as { fbq?: (...a: unknown[]) => void; clarity?: (...a: unknown[]) => void };
  try { w.fbq?.('trackCustom', 'QualifiedEngagement', { source }); } catch { /* noop */ }
  try { w.clarity?.('set', 'qualified', source); } catch { /* noop */ }
}

/**
 * Start the dwell timer. Scroll depth is deliberately NOT used here: on a
 * stepped interface each screen is short, so scroll percentage says nothing.
 * Step progress is the far stronger signal and the configurator calls
 * `qualify('step')` itself once the visitor reaches a package.
 */
export function watchDwell(ms = 45000): () => void {
  if (isQualified()) return () => {};
  const t = setTimeout(() => qualify('dwell'), ms);
  return () => clearTimeout(t);
}
