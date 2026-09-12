#!/usr/bin/env node
/**
 * The configurator's script finds its DOM by string selector, so renaming a
 * class in Configurator.astro without updating configurator.ts is invisible to
 * the build and only fails at runtime, in the browser, silently. That exact bug
 * shipped once: .cfg-addon__box was renamed to .cfg-addon__input in the markup,
 * the script kept the old name, and render() threw on the first add-on row,
 * leaving the other fifteen visible.
 *
 * Run after `pnpm build`:  node scripts/check-configurator-selectors.mjs
 */
import { readFileSync } from 'node:fs';

const js = readFileSync('src/scripts/configurator.ts', 'utf8');
const html = readFileSync('dist/pricing/index.html', 'utf8');

// Selectors that only ever exist once the script has set them at runtime.
const RUNTIME_ONLY = new Set(['[data-invalid] input']);

const sels = new Set();
const add = (re, g = 1) => { for (const m of js.matchAll(re)) sels.add(m[g]); };
add(/querySelector(?:All)?<[^>]*>?\(\s*[`'"]([^`'"]+)[`'"]/g);
add(/(?:^|[^\w])(?:q|all)\(\s*['"]([^'"]+)['"]/gm);
add(/closest<[^>]*>?\(\s*['"]([^'"]+)['"]/g);

const present = (sel) => {
  const s = sel.split(':')[0];
  if (s.startsWith('#')) return html.includes(`id="${s.slice(1)}"`);
  if (s.startsWith('.')) return new RegExp(`class="[^"]*\\b${s.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(html);
  if (s.startsWith('[')) return html.includes(s.slice(1, -1).split('=')[0]);
  return html.includes(s);
};

const missing = [...sels].filter((s) => !RUNTIME_ONLY.has(s) && !present(s)).sort();
if (missing.length) {
  console.error(`\n  ${missing.length} configurator selector(s) match nothing in the rendered page:`);
  for (const s of missing) console.error(`     ${s}`);
  console.error('\n  The script will throw at runtime. Fix the name in one place or the other.\n');
  process.exit(1);
}
console.log(`  configurator selectors: ${sels.size} checked, all resolve`);
