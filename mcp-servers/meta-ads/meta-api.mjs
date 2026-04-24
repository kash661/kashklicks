// Thin wrapper around Graph API. Throws on non-2xx with the Meta error message.

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

function env(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

function token() {
  return env('META_ACCESS_TOKEN');
}

async function request(method, path, { query, body, form } = {}) {
  const url = new URL(`${GRAPH_BASE}${path}`);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined) url.searchParams.set(k, v);

  const init = { method, headers: {} };

  if (method === 'GET') {
    url.searchParams.set('access_token', token());
  } else if (form) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(form)) if (v !== undefined) fd.append(k, v);
    fd.append('access_token', token());
    init.body = fd;
  } else {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify({ ...body, access_token: token() });
  }

  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }

  if (!res.ok || json.error) {
    const err = json.error || {};
    const msg = err.message || `HTTP ${res.status}`;
    const full = `${msg}${err.error_user_msg ? ` — ${err.error_user_msg}` : ''}${err.fbtrace_id ? ` (fbtrace_id=${err.fbtrace_id})` : ''}`;
    throw new Error(`Meta API: ${full}`);
  }
  return json;
}

export const meta = {
  get: (path, query) => request('GET', path, { query }),
  post: (path, body) => request('POST', path, { body }),
  postForm: (path, form) => request('POST', path, { form }),
  del: (path) => request('DELETE', path),

  adAccountId: () => env('META_AD_ACCOUNT_ID'),
  pageId: () => env('META_PAGE_ID'),
  businessId: () => env('META_BUSINESS_ID'),
};
