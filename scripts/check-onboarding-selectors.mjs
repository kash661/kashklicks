#!/usr/bin/env node
/**
 * The onboarding brief's script finds its DOM by string selector, so renaming
 * a class or data attribute in src/components/onboarding/*.astro without
 * updating src/scripts/onboarding.ts is invisible to the build and only fails
 * at runtime, in the browser, silently. Same idea as
 * check-configurator-selectors.mjs.
 *
 * Run after `pnpm build`:  node scripts/check-onboarding-selectors.mjs
 */
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync('src/data/onboarding-fields.json', 'utf8'));
const pagePath = schema.meta.path.replace(/^\/|\/$/g, '');
const js = readFileSync('src/scripts/onboarding.ts', 'utf8');
const html = readFileSync(`dist/${pagePath}/index.html`, 'utf8');

// Selectors that only ever exist once the script has set them at runtime.
const RUNTIME_ONLY = new Set(['[aria-invalid]']);

const sels = new Set();
const add = (re, g = 1) => { for (const m of js.matchAll(re)) sels.add(m[g]); };
add(/querySelector(?:All)?(?:<[^>]*>)?\(\s*[`'"]([^`'"]+)[`'"]/g);
add(/closest(?:<[^>]*>)?\(\s*['"]([^'"]+)['"]/g);
add(/\.matches\(\s*['"]([^'"]+)['"]/g);

// Template selectors (built from schema field names) cannot be checked
// literally; the field names themselves are checked below instead.
for (const s of [...sels]) if (s.includes('${')) sels.delete(s);

const present = (sel) => {
  // Check each comma part, and only the first compound of each part.
  return sel.split(',').every((part) => {
    const s = part.trim().split(/[\s>:]/)[0].replace(/\[.*$/, (m) => m);
    if (!s) return true;
    if (s.startsWith('#')) return html.includes(`id="${s.slice(1)}"`) || html.includes(`id=${s.slice(1)}`);
    if (s.startsWith('.')) {
      const cls = s.slice(1).split(/[.[]/)[0];
      return new RegExp(`class="[^"]*\\b${cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(html);
    }
    if (s.startsWith('[')) return html.includes(s.slice(1).split(/[=\]]/)[0]);
    const tag = s.split(/[.[#]/)[0];
    return html.includes(`<${tag}`);
  });
};

const missing = [...sels].filter((s) => !RUNTIME_ONLY.has(s) && !present(s)).sort();

// Every schema field must render a wrapper the script can find by name.
const fieldNames = schema.sections.flatMap((s) => s.fields.map((f) => f.name));
const missingFields = fieldNames.filter((n) => !html.includes(`data-onb-field="${n}"`));

if (missing.length || missingFields.length) {
  if (missing.length) {
    console.error(`\n  ${missing.length} onboarding selector(s) match nothing in the rendered page:`);
    for (const s of missing) console.error(`     ${s}`);
  }
  if (missingFields.length) {
    console.error(`\n  ${missingFields.length} schema field(s) have no data-onb-field wrapper:`);
    for (const n of missingFields) console.error(`     ${n}`);
  }
  console.error('\n  The script will fail at runtime. Fix the name in one place or the other.\n');
  process.exit(1);
}
console.log(`  onboarding selectors: ${sels.size} checked, ${fieldNames.length} field wrappers, all resolve`);
