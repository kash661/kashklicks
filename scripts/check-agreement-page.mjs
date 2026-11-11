// Checks the built agreement page: it must be noindex, carry the page state hook,
// and contain no tracker code. Run after `pnpm build`: node scripts/check-agreement-page.mjs
import { readFileSync } from 'node:fs';

const FILE = new URL('../dist/welcome/agreement/index.html', import.meta.url);
const MUST = ['noindex', 'data-agr-state'];
const MUST_NOT = ['fbevents', 'googletagmanager', 'clarity.ms', 'facebook.com/tr'];

let html;
try {
  html = readFileSync(FILE, 'utf8');
} catch (err) {
  console.error(`agreement page missing: ${FILE.pathname} (${err.code ?? err.message}). Run pnpm build first.`);
  process.exit(1);
}

const problems = [
  ...MUST.filter((s) => !html.includes(s)).map((s) => `missing "${s}"`),
  ...MUST_NOT.filter((s) => html.includes(s)).map((s) => `contains "${s}"`),
];
if (problems.length) {
  console.error(`agreement page FAILED: ${problems.join(', ')}`);
  process.exit(1);
}
console.log('agreement page OK');
