#!/usr/bin/env node
// Makes tests/unit/fixtures/old-bookings.json: booking records made by older code, and what the code of
// 881fd2b (the last commit before the payment change of 2026-11-23) answered for them. The unit test
// agreement-old-bookings.unit.ts runs today's code on the same records and expects the same answers.
//
//   node tests/unit/fixtures/make-old-bookings.mjs <empty work folder> [--write]
//
// It copies the two commits into the work folder (git archive), bundles make-old-bookings.ts with
// them (esbuild from node_modules), runs the bundle, and makes the fixture inside the work folder.
// Then it compares that with the tracked tests/unit/fixtures/old-bookings.json byte for byte
// (../../fixtures/fixture-check.mjs): the same bytes exit 0, a difference exits 1, and in both cases
// the tracked file is not touched. Only --write replaces it: use that only to record a NEW old shape,
// never to make a test pass (the point of the fixture is that it does not change).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { finishFixture, fixtureArgs } from '../../fixtures/fixture-check.mjs';

const PRE = '20408b9'; // the last commit before sets: it made every booking without a set
const HEAD = '881fd2b'; // the last commit before the payment change

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const args = fixtureArgs(process.argv.slice(2));
const write = args.write;
const work = args.work ? resolve(args.work) : null;
if (!work) {
  console.error('Usage: node tests/unit/fixtures/make-old-bookings.mjs <empty work folder> [--write]');
  process.exit(1);
}
mkdirSync(work, { recursive: true });
if (readdirSync(work).length > 0) {
  console.error(`${work} is not empty`);
  process.exit(1);
}

for (const [name, commit] of [['pre', PRE], ['head', HEAD]]) {
  const dir = join(work, name);
  mkdirSync(dir);
  const tar = execFileSync('git', ['-C', repo, 'archive', commit, 'src/worker', 'src/lib', 'src/data'], { maxBuffer: 1 << 26 });
  execFileSync('tar', ['-x', '-C', dir], { input: tar });
  symlinkSync(join(repo, 'node_modules'), join(dir, 'node_modules'));
}

const entry = join(work, 'entry.ts');
writeFileSync(
  entry,
  [
    `import { handleAgreement as preHandle } from ${JSON.stringify(join(work, 'pre/src/worker/agreement.ts'))};`,
    `import { copyFields as preCopy } from ${JSON.stringify(join(work, 'pre/src/worker/agreement-copy.ts'))};`,
    `import { handleAgreement as headHandle } from ${JSON.stringify(join(work, 'head/src/worker/agreement.ts'))};`,
    `import { copyFields as headCopy } from ${JSON.stringify(join(work, 'head/src/worker/agreement-copy.ts'))};`,
    `import { makeFixture } from ${JSON.stringify(join(here, 'make-old-bookings.ts'))};`,
    `import { writeFileSync } from 'node:fs';`,
    `const fixture = await makeFixture({`,
    `  pre: { handleAgreement: preHandle as any, copyFields: preCopy as any },`,
    `  head: { handleAgreement: headHandle as any, copyFields: headCopy as any },`,
    `  preCommit: ${JSON.stringify(PRE)},`,
    `  headCommit: ${JSON.stringify(HEAD)},`,
    `});`,
    `writeFileSync(${JSON.stringify(join(work, 'old-bookings.json'))}, JSON.stringify(fixture) + '\\n');`,
    `console.log('made old-bookings.json in the work folder:', Object.keys(fixture.records).length, 'records,', fixture.scenarios.length, 'scenarios,', fixture.strings.length, 'strings,', fixture.forms.length, 'forms');`,
  ].join('\n'),
);

// The esbuild that astro brings (no npm package is added for this).
const pnpmDir = join(repo, 'node_modules/.pnpm');
const esbuildDir = readdirSync(pnpmDir).filter((d) => /^esbuild@\d/.test(d)).sort().pop();
const esbuild = esbuildDir && join(pnpmDir, esbuildDir, 'node_modules/esbuild/bin/esbuild');
if (!esbuild || !existsSync(esbuild)) {
  console.error('esbuild not found under node_modules/.pnpm');
  process.exit(1);
}
const bundle = join(work, 'make.mjs');
execFileSync(esbuild, [entry, '--bundle', '--format=esm', '--platform=node', `--outfile=${bundle}`, '--log-level=warning'], { stdio: 'inherit' });
execFileSync(process.execPath, [bundle], { stdio: 'inherit' });
process.exit(finishFixture({ made: join(work, 'old-bookings.json'), tracked: join(here, 'old-bookings.json'), write }));
