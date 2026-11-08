// Same-origin proxy for the engagement-offer form. IG/FB in-app webviews
// silently drop cross-origin form POSTs to script.google.com, so the form
// posts here instead and the worker forwards to Apps Script server-side.
// Returns a tiny same-origin HTML body so the form's hidden iframe `load`
// event fires reliably across all browsers.
import onboardingSchemaJson from './data/onboarding-fields.json';
import packagesJson from './data/packages.json';
import {
  cleanBookingId,
  coupleName,
  isUuid,
  renderSummary,
  stripControl,
  validate,
  withPackageLabels,
  type Payload,
  type Schema,
} from './lib/onboarding';

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

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'x-robots-tag': 'noindex, nofollow',
};

interface Env {
  ASSETS: Fetcher;
  FALL_COLOUR_ENABLED?: string;
  /** Durable copy of every onboarding brief. Optional so a missing binding
   *  degrades to "forward only" instead of failing the submission. */
  ONBOARDING_KV?: KVNamespace;
}

// Preview hosts (wrangler versions upload --preview-alias) and local
// `wrangler dev` serve the site on their own origin. Accept a POST whose
// Origin equals the request's own origin on those hosts only, so previews can
// submit without opening the live endpoint to other sites.
function isPreviewHost(hostname: string): boolean {
  return hostname.endsWith('.workers.dev') || hostname === 'localhost' || hostname === '127.0.0.1';
}

// Accept lead POSTs only from our own site. Real submissions (including from
// IG/FB in-app webviews, which render same-origin) send an Origin header; we
// fall back to Referer when Origin is absent. This closes the open-proxy abuse
// vector — without it, anyone can script POSTs to /r/intake to flood the
// Inquiries sheet + inbox and bury genuine leads.
function isSameOrigin(request: Request): boolean {
  const self = new URL(request.url);
  const allowed = isPreviewHost(self.hostname) ? [...ALLOWED_ORIGINS, self.origin] : ALLOWED_ORIGINS;
  const origin = request.headers.get('origin');
  if (origin) return allowed.includes(origin);
  const referer = request.headers.get('referer');
  if (referer) return allowed.some((o) => referer === o || referer.startsWith(o + '/'));
  return false;
}

type GuardResult = { response: Response } | { formData: FormData };

// Shared front door for every lead POST: method, origin, body parse, honeypot.
// `style` picks the response flavour so the legacy routes keep their tiny HTML
// bodies and the onboarding route gets JSON.
async function guardLeadPost(request: Request, style: 'html' | 'json' = 'html'): Promise<GuardResult> {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

  if (request.method !== 'POST') {
    return {
      response: new Response('Method Not Allowed', { status: 405, headers: { 'cache-control': 'no-store' } }),
    };
  }

  // Reject cross-origin / origin-less POSTs before touching the upstream.
  if (!isSameOrigin(request)) {
    return {
      response:
        style === 'json'
          ? json(403, { ok: false, error: 'forbidden' })
          : new Response('<!doctype html>err', { status: 403, headers: HTML_HEADERS }),
    };
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return {
      response:
        style === 'json'
          ? json(400, { ok: false, error: 'bad_body' })
          : new Response('<!doctype html>err', { status: 500, headers: HTML_HEADERS }),
    };
  }

  // Honeypot: real users never fill the hidden `_gotcha` field. Silently
  // accept (200 'ok') so bots don't retry, but never forward to Apps Script.
  const honeypot = formData.get('_gotcha');
  if (typeof honeypot === 'string' && honeypot.trim() !== '') {
    return {
      response:
        style === 'json'
          ? json(200, { ok: true })
          : new Response('<!doctype html><meta charset="utf-8"><title>OK</title>ok', {
              status: 200,
              headers: HTML_HEADERS,
            }),
    };
  }

  return { formData };
}

// Forward a FormData body to Apps Script. Resolves true on any 2xx/3xx, false
// on any other status. Throws on network failure or timeout so callers can
// tell "upstream said no" (502) from "upstream unreachable" (500).
async function forwardToAppsScript(body: FormData): Promise<boolean> {
  // Bound the upstream wait — Apps Script cold-starts can hang for many
  // seconds, which would otherwise stall the worker until the platform limit.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let upstream: Response;
  try {
    upstream = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      body,
      redirect: 'manual',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  // Apps Script answers a successful doPost with a 302 redirect to its
  // one-time echo URL; the sheet write has already happened by then. The
  // echo endpoint now rejects followed requests (405), which made every
  // successful submission render the error state, so never follow the
  // redirect and treat any 2xx/3xx as success.
  return upstream.status >= 200 && upstream.status < 400;
}

async function handleEngagementLead(request: Request): Promise<Response> {
  const guard = await guardLeadPost(request, 'html');
  if ('response' in guard) return guard.response;

  try {
    const ok = await forwardToAppsScript(guard.formData);
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>${ok ? 'OK' : 'ERR'}</title>${ok ? 'ok' : 'err'}`,
      { status: ok ? 200 : 502, headers: HTML_HEADERS },
    );
  } catch {
    return new Response('<!doctype html>err', { status: 500, headers: HTML_HEADERS });
  }
}

// ── Client onboarding brief ───────────────────────────────────────────────
// /welcome/brief-.../ posts here. The shared schema validates the answers
// (same rules the page used), the record goes to KV first so nothing is lost
// if Apps Script is down, then a summary is forwarded for the sheet + email.
const ONBOARDING_SCHEMA = withPackageLabels(onboardingSchemaJson as unknown as Schema, packagesJson as any[]);
const ONBOARDING_MAX_BODY = 262144; // 256 KB
const ONBOARDING_MAX_PAYLOAD = 65536; // 64 KB of JSON
const ONBOARDING_TTL = 63072000; // 2 years
const ONBOARDING_IDEM_TTL = 86400; // 1 day

async function handleOnboarding(request: Request, env: Env): Promise<Response> {
  const json = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > ONBOARDING_MAX_BODY) {
    return json(413, { ok: false, error: 'too_large' });
  }
  // A chunked body has no content-length, so measure it before parsing.
  let req = request;
  if (request.method === 'POST' && !request.headers.has('content-length') && request.body) {
    const buf = await request.arrayBuffer();
    if (buf.byteLength > ONBOARDING_MAX_BODY) return json(413, { ok: false, error: 'too_large' });
    req = new Request(request.url, { method: request.method, headers: request.headers, body: buf });
  }

  const guard = await guardLeadPost(req, 'json');
  if ('response' in guard) return guard.response;
  const form = guard.formData;

  const raw = form.get('payload_json');
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > ONBOARDING_MAX_PAYLOAD) {
    return json(400, { ok: false, error: 'bad_payload' });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, error: 'bad_payload' });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return json(400, { ok: false, error: 'bad_payload' });
  }

  const result = validate(stripControl(parsed as Payload), ONBOARDING_SCHEMA);
  if (!result.ok) return json(400, { ok: false, errors: result.errors });

  const data = result.data;
  const clientKey = form.get('idempotency_key');
  const submissionId = isUuid(clientKey) ? clientKey.toLowerCase() : crypto.randomUUID();
  const bookingId = cleanBookingId(form.get('booking_id'));
  const submittedAt = new Date().toISOString();
  const couple = coupleName(data);
  const email = typeof data.email === 'string' ? data.email : '';
  const country = (request as unknown as { cf?: { country?: string } }).cf?.country ?? null;

  const kv = env.ONBOARDING_KV;
  const idemKey = `onb:idem:${submissionId}`;
  const recordKey = `onb:v1:${bookingId || 'anon'}:${submissionId}`;
  const record = {
    schema_version: 1,
    submission_id: submissionId,
    booking_id: bookingId || null,
    submitted_at: submittedAt,
    country,
    data,
  };
  const kvMeta = { couple, email, submitted_at: submittedAt };

  if (kv) {
    try {
      if (await kv.get(idemKey)) return json(200, { ok: true, duplicate: true, submission_id: submissionId });
      await kv.put(recordKey, JSON.stringify(record), { expirationTtl: ONBOARDING_TTL, metadata: kvMeta });
      await kv.put(idemKey, recordKey, { expirationTtl: ONBOARDING_IDEM_TTL });
    } catch {
      // KV trouble must not lose the brief: carry on and forward it.
    }
  }

  const summary = renderSummary(data, ONBOARDING_SCHEMA);
  const out = new FormData();
  out.set('form', 'onboarding');
  out.set('source', 'Shoot brief');
  out.set('booking_id', bookingId);
  out.set('submission_id', submissionId);
  out.set('couple', couple);
  out.set('email', email);
  out.set('summary', summary);
  out.set('payload_json', JSON.stringify(data));

  let notified = false;
  try {
    notified = await forwardToAppsScript(out);
  } catch {
    notified = false;
  }

  if (!notified) {
    if (kv) {
      try {
        await kv.put(recordKey, JSON.stringify({ ...record, notified: false }), {
          expirationTtl: ONBOARDING_TTL,
          metadata: { ...kvMeta, notified: false },
        });
      } catch {
        /* nothing more to do */
      }
    }
    // Saved (or at least validated); Akash can recover it from KV.
    return json(200, { ok: true, notified: false, stored: !!kv, submission_id: submissionId });
  }

  return json(200, { ok: true, submission_id: submissionId });
}

// ── Ontario Parks fall colour report ──────────────────────────────────────
// ontarioparks.ca/fallcolour has no API: the page ships its dataset as a
// literal array inside an inline <script>. We parse that array server side,
// keep only the factual fields (park, region, percentages, dominant colour,
// report date, coordinates) and republish them as JSON for the on-site panel.
// The content is © King's Printer for Ontario, so the panel credits and links
// the source, and the whole route sits behind the FALL_COLOUR_ENABLED kill
// switch in wrangler.jsonc.
const FALL_COLOUR_SOURCE = 'Ontario Parks Fall Colour Report';
const FALL_COLOUR_SOURCE_URL = 'https://www.ontarioparks.ca/fallcolour';
const FALL_COLOUR_UA =
  'kashklicks.ca fall colour panel (+https://kashklicks.ca/; hello@kashklicks.ca)';

// Cache API keys. They are never routable paths, only cache identities.
const FALL_COLOUR_FRESH_KEY = 'https://kashklicks.ca/__cache/fall-colour/fresh';
const FALL_COLOUR_STALE_KEY = 'https://kashklicks.ca/__cache/fall-colour/stale';
const FALL_COLOUR_FRESH_TTL = 21600; // 6 hours — the report updates a few times a day.
const FALL_COLOUR_STALE_TTL = 604800; // 7 days — last known good copy for outages.
const FALL_COLOUR_FAILURE_TTL = 600; // 10 minutes — don't hammer a broken upstream.
const FALL_COLOUR_UPSTREAM_TIMEOUT = 8000;
// A successful parse always yields dozens of rows. Anything smaller means the
// page markup changed or we got an error/interstitial page, so treat it as a
// failure and keep serving the stale copy instead of publishing garbage.
const FALL_COLOUR_MIN_PARKS = 10;

interface FallColourPark {
  park: string;
  slug: string;
  region: string;
  colourChange: number;
  leafFall: number;
  dominantColour: string;
  reportDate: string | null;
  lat: number;
  lng: number;
}

function fallColourPercent(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function fallColourSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Slice the inline array out of the HTML and parse it. Returns [] on any
// surprise so the caller can fall back rather than throw.
function extractParks(html: string): FallColourPark[] {
  const start = html.indexOf('[{"id":');
  if (start === -1) return [];
  const end = html.indexOf('}];', start);
  if (end === -1) return [];

  let rows: unknown;
  try {
    rows = JSON.parse(html.slice(start, end + 2));
  } catch {
    return [];
  }
  if (!Array.isArray(rows)) return [];

  const parks: FallColourPark[] = [];
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || typeof row !== 'object') continue;
    if (row.reporting !== 'yes') continue;

    const park = typeof row.park_name === 'string' ? row.park_name.trim() : '';
    if (!park) continue;

    const lat = Number(row.lat);
    const lng = Number(row.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat === 0 && lng === 0) continue;

    // The feed spells the same region two ways ("Northwest" / "Northwestern").
    const rawRegion = typeof row.region === 'string' ? row.region.trim() : '';
    const region = rawRegion === 'Northwest' ? 'Northwestern' : rawRegion;

    const seconds = Number(row.report_date);
    const reportDate =
      Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : null;

    const shortname = typeof row.shortname === 'string' ? row.shortname.trim() : '';

    parks.push({
      park,
      slug: shortname || fallColourSlug(park),
      region,
      colourChange: fallColourPercent(row.colour_change),
      leafFall: fallColourPercent(row.leaf_fall),
      dominantColour: typeof row.dominant_colour === 'string' ? row.dominant_colour.trim() : '',
      reportDate,
      lat,
      lng,
    });
  }

  return parks;
}

function fallColourBody(parks: FallColourPark[]): string {
  return JSON.stringify({
    source: FALL_COLOUR_SOURCE,
    sourceUrl: FALL_COLOUR_SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    parks,
  });
}

function fallColourHeaders(maxAge: number): Record<string, string> {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': `public, max-age=${maxAge}`,
    'x-content-type-options': 'nosniff',
  };
}

async function handleFallColour(request: Request, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
    });
  }

  // `caches` is absent in some local/test runtimes; every use is optional.
  const cache: Cache | undefined =
    typeof caches !== 'undefined' ? (caches as unknown as { default?: Cache }).default : undefined;

  if (cache) {
    const fresh = await cache.match(FALL_COLOUR_FRESH_KEY);
    if (fresh) {
      const headers = new Headers(fresh.headers);
      headers.set('x-kk-cache', 'hit');
      return new Response(fresh.body, { status: fresh.status, headers });
    }
  }

  let parks: FallColourPark[] = [];
  try {
    const upstream = await fetch(FALL_COLOUR_SOURCE_URL, {
      headers: { 'user-agent': FALL_COLOUR_UA, accept: 'text/html' },
      signal: AbortSignal.timeout(FALL_COLOUR_UPSTREAM_TIMEOUT),
    });
    if (upstream.ok) parks = extractParks(await upstream.text());
  } catch {
    parks = [];
  }

  if (parks.length >= FALL_COLOUR_MIN_PARKS) {
    const body = fallColourBody(parks);
    const response = new Response(body, { headers: fallColourHeaders(FALL_COLOUR_FRESH_TTL) });
    if (cache) {
      ctx.waitUntil(cache.put(FALL_COLOUR_FRESH_KEY, response.clone()));
      // Second copy with a much longer TTL: the outage fallback below.
      ctx.waitUntil(
        cache.put(
          FALL_COLOUR_STALE_KEY,
          new Response(body, { headers: fallColourHeaders(FALL_COLOUR_STALE_TTL) }),
        ),
      );
    }
    return response;
  }

  // Upstream is down, slow, or shaped differently than we expect. Serve the
  // last good copy rather than an empty panel.
  if (cache) {
    const stale = await cache.match(FALL_COLOUR_STALE_KEY);
    if (stale) {
      const headers = new Headers(stale.headers);
      headers.set('x-kk-fallback', 'stale');
      headers.set('cache-control', `public, max-age=${FALL_COLOUR_FAILURE_TTL}`);
      return new Response(stale.body, { status: 200, headers });
    }
  }

  return new Response(fallColourBody([]), {
    status: 503,
    headers: fallColourHeaders(FALL_COLOUR_FAILURE_TTL),
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Fingerprinted, content-hashed assets (/_astro/* and /fonts/*) — cache
    // forever. Cloudflare applies _headers rules CUMULATIVELY, so each asset
    // matches BOTH its own immutable rule AND the catch-all `/*` rule and comes
    // back with a doubled, self-contradictory header:
    //   cache-control: public, max-age=0, must-revalidate, public, max-age=31536000, immutable
    // Browsers honor the FIRST directive (max-age=0, must-revalidate), so they
    // revalidate every immutable asset on every view and never cache it durably;
    // worse, must-revalidate forbids serving the cached copy when a revalidation
    // fails, so a transient blip (deploy swap, CDN hiccup, flaky mobile) shows a
    // broken image with no retry, and it recurs. These filenames change whenever
    // their content does, so overwrite Cache-Control with the correct single
    // value (Headers.set replaces the doubled value outright).
    if (path.startsWith('/_astro/') || path.startsWith('/fonts/')) {
      const assetRes = await env.ASSETS.fetch(request);
      const headers = new Headers(assetRes.headers);
      headers.set('cache-control', 'public, max-age=31536000, immutable');
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers,
      });
    }

    // Other static prefixes (non-hashed) short-circuit the redirect/form/diag
    // chain below but keep their _headers caching as-is.
    if (path.startsWith('/sounds/')) {
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

    // Dev/preview-only scratch pages — never reachable on the live site. They
    // stay accessible under `astro dev` (no Worker) for design reference.
    if (path.startsWith('/dev/') && url.hostname === 'kashklicks.ca') {
      return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
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

    // Client onboarding brief (JSON in, JSON out). Same if chain as the lead
    // routes, above the trailing-slash 301, which would turn a POST into a GET.
    if (path === ONBOARDING_SCHEMA.meta.endpoint) {
      return handleOnboarding(request, env);
    }

    // Ontario Parks fall colour JSON for the on-site panel. Sits ABOVE the
    // trailing-slash canonicalization (which already exempts paths with a file
    // extension) so the `.json` path is never touched, and behind the
    // FALL_COLOUR_ENABLED var so the whole feature can be switched off from
    // wrangler.jsonc without a code change.
    if (path === '/api/fall-colour.json') {
      if (env.FALL_COLOUR_ENABLED !== 'true') {
        return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
      }
      return handleFallColour(request, ctx);
    }

    // Legacy Webflow URL. It still earns impressions in Search Console, and it
    // used to take TWO hops (slash canonicalization here, then the _redirects
    // rule). Collapse both variants into a single 301 straight to the service
    // page; the query string rides along because only the pathname changes.
    if (path === '/civil-ceremony' || path === '/civil-ceremony/') {
      url.pathname = '/services/civil-ceremony/';
      return Response.redirect(url.toString(), 301);
    }

    // Canonicalize trailing slash (apex host). Astro builds directory-style
    // pages (`/page/index.html`) but the absent-slash variants were being served
    // as a second canonical, fragmenting analytics and SEO. Skip paths with a
    // file extension (e.g. /robots.txt, /favicon.svg) and the root.
    if (path.length > 1 && !path.endsWith('/') && !/\.[^/]+$/.test(path)) {
      url.pathname = path + '/';
      return Response.redirect(url.toString(), 301);
    }

    // Hidden client pages (the onboarding brief). The page already carries a
    // noindex meta; the header covers crawlers that skip HTML and anything
    // else served under /welcome/. Same shape as the /_astro/ block above.
    if (path.startsWith('/welcome/')) {
      const assetRes = await env.ASSETS.fetch(request);
      const headers = new Headers(assetRes.headers);
      headers.set('x-robots-tag', 'noindex, nofollow');
      // The personal link carries names in the query string; never leak it.
      headers.set('referrer-policy', 'no-referrer');
      headers.set('cache-control', 'no-store');
      return new Response(assetRes.body, {
        status: assetRes.status,
        statusText: assetRes.statusText,
        headers,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
