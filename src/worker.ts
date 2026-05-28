// Same-origin proxy for the engagement-offer form. IG/FB in-app webviews
// silently drop cross-origin form POSTs to script.google.com, so the form
// posts here instead and the worker forwards to Apps Script server-side.
// Returns a tiny same-origin HTML body so the form's hidden iframe `load`
// event fires reliably across all browsers.
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbw5c2bxZOPov3y9XUgSWZdTmAhwZM9k2E5BBr9AJDiWGp2rDded_RYYrsVaq-HWm7VepQ/exec';

const ALLOWED_ORIGINS = ['https://kashklicks.ca', 'https://www.kashklicks.ca'];

// Headers shared by every worker-authored HTML response. run_worker_first means
// these responses bypass the static-asset `_headers` file, so we attach the
// security headers here ourselves (the static pages still get them from _headers).
const HTML_HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
};

// Accept lead POSTs only from our own site. Real submissions (including from
// IG/FB in-app webviews, which render same-origin) send an Origin header; we
// fall back to Referer when Origin is absent. This closes the open-proxy abuse
// vector — without it, anyone can script POSTs to /r/intake to flood the
// Inquiries sheet + inbox and bury genuine leads.
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) return ALLOWED_ORIGINS.includes(origin);
  const referer = request.headers.get('referer');
  if (referer) return ALLOWED_ORIGINS.some((o) => referer === o || referer.startsWith(o + '/'));
  return false;
}

async function handleEngagementLead(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { 'cache-control': 'no-store' } });
  }

  // Reject cross-origin / origin-less POSTs before touching the upstream.
  if (!isSameOrigin(request)) {
    return new Response('<!doctype html>err', { status: 403, headers: HTML_HEADERS });
  }

  try {
    const formData = await request.formData();

    // Honeypot: real users never fill the hidden `_gotcha` field. Silently
    // accept (200 'ok') so bots don't retry, but never forward to Apps Script.
    const honeypot = formData.get('_gotcha');
    if (typeof honeypot === 'string' && honeypot.trim() !== '') {
      return new Response('<!doctype html><meta charset="utf-8"><title>OK</title>ok', {
        status: 200,
        headers: HTML_HEADERS,
      });
    }

    // Bound the upstream wait — Apps Script cold-starts can hang for many
    // seconds, which would otherwise stall the worker until the platform limit.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let upstream: Response;
    try {
      upstream = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        body: formData,
        redirect: 'follow',
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const ok = upstream.ok;
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>${ok ? 'OK' : 'ERR'}</title>${ok ? 'ok' : 'err'}`,
      { status: ok ? 200 : 502, headers: HTML_HEADERS },
    );
  } catch {
    return new Response('<!doctype html>err', { status: 500, headers: HTML_HEADERS });
  }
}

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Static assets carry their own caching from _headers and never need the
    // redirect/form/diag logic below. Short-circuit so the worker doesn't run
    // its full decision chain on every hashed JS/CSS/font/sound request
    // (run_worker_first executes this handler on every asset otherwise).
    if (path.startsWith('/_astro/') || path.startsWith('/fonts/') || path.startsWith('/sounds/')) {
      return env.ASSETS.fetch(request);
    }

    // Canonicalize www → apex AND normalize the trailing slash in a SINGLE hop.
    // Preserves path + query string so UTM and fbclid parameters survive. Uses
    // 301 so search engines consolidate link equity onto kashklicks.ca.
    if (url.hostname === 'www.kashklicks.ca') {
      url.hostname = 'kashklicks.ca';
      if (path.length > 1 && !path.endsWith('/') && !/\.[^/]+$/.test(path)) {
        url.pathname = path + '/';
      }
      return Response.redirect(url.toString(), 301);
    }

    // Diagnostic ping — confirms a user's request reached the Worker (vs being
    // intercepted by a cached asset 404, carrier middleware, or a content blocker).
    if (path === '/__diag/ping') {
      return new Response(
        JSON.stringify(
          {
            ok: true,
            ray: request.headers.get('cf-ray') || null,
            colo: (request as any).cf?.colo || null,
            country: request.headers.get('cf-ipcountry') || null,
            ua: request.headers.get('user-agent') || null,
            at: new Date().toISOString(),
          },
          null,
          2,
        ),
        {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          },
        },
      );
    }

    // Form-submission proxy. ALL site forms (engagement offer LP, contact
    // form, intimate-wedding LP, about-page travel-log signup) post here
    // same-origin so IG/FB in-app webviews don't silently drop the POST.
    // Multiple aliases exist because cached 404s at edge nodes / browsers
    // can poison a path; aliasing keeps cached HTML working after renames.
    if (
      path === '/r/intake' ||
      path === '/r/eof-7k2x' ||
      path === '/book/intake' ||
      path === '/api/engagement-lead'
    ) {
      return handleEngagementLead(request);
    }

    // Canonicalize trailing slash (apex host). Astro builds directory-style
    // pages (`/page/index.html`) but the absent-slash variants were being served
    // as a second canonical, fragmenting analytics and SEO. Skip paths with a
    // file extension (e.g. /robots.txt, /favicon.svg) and the root.
    if (path.length > 1 && !path.endsWith('/') && !/\.[^/]+$/.test(path)) {
      url.pathname = path + '/';
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
