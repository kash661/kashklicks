#!/usr/bin/env node
/**
 * Read client shoot briefs straight from Cloudflare KV (ONBOARDING_KV).
 *
 * Works even before the Apps Script update is deployed, because the worker
 * saves every brief to KV first. Uses the wrangler login on this machine.
 *
 * Usage (run from the repo root):
 *   node scripts/list-briefs.mjs                 # couple, email, booking id, date; newest first
 *   node scripts/list-briefs.mjs --json          # the same list as JSON
 *   node scripts/list-briefs.mjs --get <key>     # one brief as the plain text summary
 *   node scripts/list-briefs.mjs --get latest    # the newest brief
 *   node scripts/list-briefs.mjs --get <key> --json   # the raw stored record
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
const asJson = args.includes('--json');
const getIndex = args.indexOf('--get');
const getKey = getIndex === -1 ? null : args[getIndex + 1];

function wrangler(cmd) {
  try {
    return execFileSync('npx', ['wrangler', 'kv', 'key', ...cmd, '--binding', 'ONBOARDING_KV', '--remote'], {
      cwd: repo,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    console.error('wrangler failed. Is this machine logged in? Try: npx wrangler whoami');
    console.error(String(err.stderr || err.message).trim().split('\n').slice(-5).join('\n'));
    process.exit(1);
  }
}

function listKeys() {
  const out = wrangler(['list', '--prefix', 'onb:v1:']);
  const start = out.indexOf('[');
  const keys = start === -1 ? [] : JSON.parse(out.slice(start, out.lastIndexOf(']') + 1));
  return keys
    .map((k) => {
      const [, , booking, submission] = k.name.split(':');
      return {
        key: k.name,
        couple: k.metadata?.couple ?? '',
        email: k.metadata?.email ?? '',
        booking_id: booking === 'anon' ? '' : booking,
        submission_id: submission,
        submitted_at: k.metadata?.submitted_at ?? '',
        notified: k.metadata?.notified !== false,
      };
    })
    .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at));
}

// The summary comes from the same TypeScript module the worker uses, bundled
// on the fly so this script never drifts from what lands in the inbox.
async function loadLib() {
  let esbuild;
  try {
    esbuild = await import('esbuild');
  } catch {
    console.error('esbuild is not installed here. Run pnpm install, or use --json for the raw record.');
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), 'kk-briefs-'));
  const outfile = join(dir, 'lib.mjs');
  await esbuild.build({
    stdin: {
      contents: [
        "export * from './src/lib/onboarding.ts';",
        "export { default as schema } from './src/data/onboarding-fields.json';",
        "export { default as packages } from './src/data/packages.json';",
      ].join('\n'),
      resolveDir: repo,
      loader: 'ts',
    },
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    logLevel: 'error',
  });
  const lib = await import(pathToFileURL(outfile).href);
  rmSync(dir, { recursive: true, force: true });
  return lib;
}

const pad = (s, n) => String(s).slice(0, n).padEnd(n);

if (getKey) {
  let key = getKey;
  if (key === 'latest') {
    const newest = listKeys()[0];
    if (!newest) {
      console.log('No briefs stored yet.');
      process.exit(0);
    }
    key = newest.key;
  }
  const raw = wrangler(['get', key]);
  let record;
  try {
    record = JSON.parse(raw.slice(raw.indexOf('{')));
  } catch {
    console.error(`No brief found for ${key}`);
    process.exit(1);
  }
  if (asJson) {
    console.log(JSON.stringify(record, null, 2));
    process.exit(0);
  }
  const lib = await loadLib();
  const schema = lib.withPackageLabels(lib.schema, lib.packages);
  console.log(`${lib.coupleName(record.data)}  |  booking ${record.booking_id ?? 'none'}  |  ${record.submitted_at}`);
  console.log(`submission ${record.submission_id}${record.notified === false ? '  |  NOT emailed (Apps Script was down)' : ''}`);
  const wishes = lib.locationWishes(record.data, schema);
  if (wishes.line) console.log(`location wishes: ${wishes.line}`);
  console.log('');
  console.log(lib.renderSummary(record.data, schema));
  process.exit(0);
}

const briefs = listKeys();
if (asJson) {
  console.log(JSON.stringify(briefs, null, 2));
  process.exit(0);
}
if (briefs.length === 0) {
  console.log('No briefs stored yet.');
  process.exit(0);
}
console.log(`${pad('Submitted', 17)}  ${pad('Couple', 28)}  ${pad('Email', 30)}  ${pad('Booking', 16)}  Key`);
for (const b of briefs) {
  const when = b.submitted_at ? b.submitted_at.replace('T', ' ').slice(0, 16) : '';
  console.log(
    `${pad(when, 17)}  ${pad(b.couple, 28)}  ${pad(b.email, 30)}  ${pad(b.booking_id || '-', 16)}  ${b.key}${b.notified ? '' : '  (not emailed)'}`,
  );
}
console.log(`\n${briefs.length} brief(s). Read one: node scripts/list-briefs.mjs --get <key>`);
