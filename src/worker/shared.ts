// Pieces every worker route shares: the Apps Script endpoint, our origins,
// response headers, the same-origin check and the JSON call to Apps Script.

export const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbw5c2bxZOPov3y9XUgSWZdTmAhwZM9k2E5BBr9AJDiWGp2rDded_RYYrsVaq-HWm7VepQ/exec';

export const ALLOWED_ORIGINS = ['https://kashklicks.ca', 'https://www.kashklicks.ca'];

// Headers shared by every worker-authored HTML response. run_worker_first means
// these responses bypass the static-asset `_headers` file, so we attach the
// security headers here ourselves (the static pages still get them from _headers).
export const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

export const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
};

// Preview hosts (wrangler versions upload --preview-alias) and local
// `wrangler dev` serve the site on their own origin. Accept a POST whose
// Origin equals the request's own origin on those hosts only, so previews can
// submit without opening the live endpoint to other sites.
export function isPreviewHost(hostname: string): boolean {
  return hostname.endsWith('.workers.dev') || hostname === 'localhost' || hostname === '127.0.0.1';
}

// Accept lead POSTs only from our own site. Real submissions (including from
// IG/FB in-app webviews, which render same-origin) send an Origin header; we
// fall back to Referer when Origin is absent. This closes the open-proxy abuse
// vector — without it, anyone can script POSTs to /r/intake to flood the
// Inquiries sheet + inbox and bury genuine leads.
export function isSameOrigin(request: Request): boolean {
  const self = new URL(request.url);
  const allowed = isPreviewHost(self.hostname) ? [...ALLOWED_ORIGINS, self.origin] : ALLOWED_ORIGINS;
  const origin = request.headers.get('origin');
  if (origin) return allowed.includes(origin);
  const referer = request.headers.get('referer');
  if (referer) return allowed.some((o) => referer === o || referer.startsWith(o + '/'));
  return false;
}

/** Parses a body as a JSON object. Anything else (array, text, bad JSON) is null. */
const jsonObject = (text: string): Record<string, unknown> | null => {
  try {
    const v: unknown = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/**
 * POSTs form fields to an authenticated Apps Script action and returns its JSON answer.
 * Apps Script answers a doPost with a 302 to a one-time echo URL that holds the JSON,
 * so the redirect is read by hand with a GET. Resolves null on any failure: network,
 * timeout, a status that is not 2xx or 3xx, or a body that is not a JSON object.
 */
export async function callAppsScript(
  fields: Record<string, string>,
  opts: { timeoutMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Record<string, unknown> | null> {
  // Called as a plain function, never as a method: a Workers `fetch` called with
  // another `this` throws "Illegal invocation".
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 25000);
  try {
    const first = await doFetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: new URLSearchParams(fields),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (first.status >= 300 && first.status < 400) {
      const location = first.headers.get('location');
      if (!location) return null;
      const echo = await doFetch(location, { method: 'GET', signal: controller.signal });
      if (!echo.ok) return null;
      return jsonObject(await echo.text());
    }
    if (!first.ok) return null;
    return jsonObject(await first.text());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
