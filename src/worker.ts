// Same-origin proxy for the engagement-offer form. IG/FB in-app webviews
// silently drop cross-origin form POSTs to script.google.com, so the form
// posts here instead and the worker forwards to Apps Script server-side.
// Returns a tiny same-origin HTML body so the form's hidden iframe `load`
// event fires reliably across all browsers.
const APPS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbw5c2bxZOPov3y9XUgSWZdTmAhwZM9k2E5BBr9AJDiWGp2rDded_RYYrsVaq-HWm7VepQ/exec';

async function handleEngagementLead(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  try {
    const formData = await request.formData();
    const upstream = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body: formData,
      redirect: 'follow',
    });
    const ok = upstream.ok;
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>${ok ? 'OK' : 'ERR'}</title>${ok ? 'ok' : 'err'}`,
      {
        status: ok ? 200 : 502,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      },
    );
  } catch {
    return new Response('<!doctype html>err', {
      status: 500,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  }
}

export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);

    // Canonicalize www → apex. Preserves path + query string so UTM and
    // fbclid parameters survive the redirect. Uses 301 so search engines
    // consolidate link equity onto kashklicks.ca.
    if (url.hostname === 'www.kashklicks.ca') {
      url.hostname = 'kashklicks.ca';
      return Response.redirect(url.toString(), 301);
    }

    // Diagnostic ping — returns the CF edge identifier so we can confirm a
    // user's request reached the Worker (vs being intercepted by a cached
    // asset 404, carrier middleware, or content blocker).
    if (url.pathname === '/__diag/ping') {
      return new Response(
        JSON.stringify({
          ok: true,
          ray: request.headers.get('cf-ray') || null,
          colo: request.headers.get('cf-ipcountry') || null,
          ua: request.headers.get('user-agent') || null,
          at: new Date().toISOString(),
        }, null, 2),
        {
          headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
        },
      );
    }

    // Form-submission proxy. ALL site forms (engagement offer LP, contact
    // form, intimate-wedding LP, about-page travel-log signup) post here
    // same-origin so IG/FB in-app webviews don't silently drop the POST.
    // Multiple aliases exist because cached 404s at edge nodes / browsers
    // can poison a path; aliasing keeps cached HTML working after renames.
    if (
      url.pathname === '/r/intake' ||
      url.pathname === '/r/eof-7k2x' ||
      url.pathname === '/book/intake' ||
      url.pathname === '/api/engagement-lead'
    ) {
      return handleEngagementLead(request);
    }

    // Canonicalize trailing slash. Astro builds directory-style pages
    // (`/page/index.html`) but the absent-slash variants were being served
    // as a second canonical, fragmenting analytics and SEO. Skip paths with
    // a file extension (e.g. /robots.txt, /favicon.svg) and the root.
    const p = url.pathname;
    if (p.length > 1 && !p.endsWith('/') && !/\.[^/]+$/.test(p)) {
      url.pathname = p + '/';
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
