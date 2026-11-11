// node scripts/agreement/build-clauses.mjs [--from-vault <path>] [--check]
// Compiles src/data/agreement/agreement-source.md into clauses.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { extractPartA, parseAgreementSource } from '../../src/lib/agreement/parse-source.mjs';

const root = new URL('../../', import.meta.url);
const mdPath = fileURLToPath(new URL('src/data/agreement/agreement-source.md', root));
const jsonPath = fileURLToPath(new URL('src/data/agreement/clauses.json', root));

const args = process.argv.slice(2);
const check = args.includes('--check');
const vi = args.indexOf('--from-vault');
if (vi !== -1) {
  const note = args[vi + 1];
  if (!note) {
    console.error('--from-vault needs a path');
    process.exit(2);
  }
  if (check) {
    console.error('--check writes nothing; do not combine it with --from-vault');
    process.exit(2);
  }
  writeFileSync(mdPath, extractPartA(readFileSync(note, 'utf8')));
}

const bytes = readFileSync(mdPath);
const version = createHash('sha256').update(bytes).digest('hex');
const out = JSON.stringify({ version, ...parseAgreementSource(bytes.toString('utf8')) }, null, 2) + '\n';

if (check) {
  let current = '';
  try {
    current = readFileSync(jsonPath, 'utf8');
  } catch {}
  if (current !== out) {
    console.error('clauses.json is out of date. Run: pnpm agreement:clauses');
    process.exit(1);
  }
  console.log('clauses.json is up to date');
} else {
  writeFileSync(jsonPath, out);
  console.log(`wrote clauses.json (version ${version.slice(0, 12)})`);
}
