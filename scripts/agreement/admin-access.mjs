// Shared by the agreement tools: which origins may receive the admin token, and how the
// token is read. The token is never printed, and no tool reads it before the origin passes.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOCAL_DIR = join(homedir(), '.claude/projects/-Users-akashdesai-projects-kashklicks');

// KK_AGREEMENT_TOKEN_FILE exists only so the tools can be tested with a fake token file.
export const TOKEN_FILE = process.env.KK_AGREEMENT_TOKEN_FILE || join(LOCAL_DIR, 'forms-admin-token');

// The account's workers.dev subdomain is not written in this public repo. It sits in a
// one-line local file. Without that file the tools refuse every preview host.
// KK_WORKERS_SUBDOMAIN_FILE exists only so the tools can be tested with a fake file.
export const SUBDOMAIN_FILE = process.env.KK_WORKERS_SUBDOMAIN_FILE || join(LOCAL_DIR, 'workers-subdomain');

export const LIVE_ORIGIN = 'https://kashklicks.ca';
const PREVIEW_SHAPE = 'https://<name>-kashklicks.<account>.workers.dev';

/** The account's workers.dev subdomain from the local file, or null when the file is missing or malformed. */
function accountSubdomain() {
  let text;
  try {
    text = readFileSync(SUBDOMAIN_FILE, 'utf8').trim();
  } catch {
    return null;
  }
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(text) ? text : null;
}

/** True for <name>-kashklicks.<account>.workers.dev, where <account> is the subdomain in the local file. */
function isPreviewHost(hostname, account) {
  const suffix = `-kashklicks.${account}.workers.dev`;
  if (!hostname.endsWith(suffix)) return false;
  return /^[a-z0-9-]+$/.test(hostname.slice(0, -suffix.length));
}

/**
 * The only origins the tools talk to (checked on the parsed URL; URL lower-cases the host):
 *   live    https://kashklicks.ca
 *   preview https://<name>-kashklicks.<account>.workers.dev (test mode; <account> comes from SUBDOMAIN_FILE)
 *   local   http://localhost or http://127.0.0.1, any port (test mode)
 * Returns { kind, origin } or { error }.
 */
export function checkOrigin(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return { error: `Not a URL: ${raw}` };
  }
  if (url.username || url.password) return { error: `Refused: ${raw} carries a user name or password.` };
  const { protocol, hostname, port } = url;
  if (protocol === 'https:' && hostname === 'kashklicks.ca' && port === '') return { kind: 'live', origin: url.origin };
  if (protocol === 'http:' && (hostname === 'localhost' || hostname === '127.0.0.1')) return { kind: 'local', origin: url.origin };
  if (protocol === 'https:' && port === '' && hostname.endsWith('.workers.dev')) {
    const account = accountSubdomain();
    if (!account) {
      return {
        error: `Refused: preview hosts are off on this machine. The file ${SUBDOMAIN_FILE} is missing or malformed. It holds the account's workers.dev subdomain on one line.`,
      };
    }
    if (isPreviewHost(hostname, account)) return { kind: 'preview', origin: url.origin };
  }
  return {
    error: `Refused: ${url.origin} is not a known origin. Allowed: ${LIVE_ORIGIN}, ${PREVIEW_SHAPE}, http://localhost or http://127.0.0.1.`,
  };
}

/** The admin token, or an exit with a message that never contains any of it. */
export function readAdminToken() {
  let token;
  try {
    token = readFileSync(TOKEN_FILE, 'utf8').trim();
  } catch {
    console.error(`Admin token file missing: ${TOKEN_FILE}`);
    process.exit(1);
  }
  // Printable ASCII only. A line break or other control character would make fetch
  // throw an error that quotes the header value.
  if (!/^[\x21-\x7e]+$/.test(token)) {
    console.error('The admin token file is malformed.');
    process.exit(1);
  }
  return token;
}

/** What to print for a failed fetch: a code, never the message (it can quote header values). */
export const fetchErrorCode = (err) => String(err?.cause?.code ?? err?.name ?? 'Error');
