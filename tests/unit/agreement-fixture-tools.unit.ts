import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { finishFixture, fixtureArgs } from '../fixtures/fixture-check.mjs';

// The two fixture generators (tests/unit/fixtures/make-old-bookings.mjs, tests/fixtures/make-agreement-page-old.mjs)
// record how bookings made before the payment change of 2026-11-23 behave. Those fixtures are the only proof of it,
// so a run that only checks them must never rewrite them (review finding, spec 5.6): a generator makes its fixture
// in its work folder and compares it with the tracked file byte for byte; only --write replaces the tracked file.

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8');

test('finishFixture: the same bytes pass, a difference fails, and only --write replaces the tracked file', async ({}, testInfo) => {
  const made = testInfo.outputPath('made.json');
  const tracked = testInfo.outputPath('tracked.json');
  const lines: string[] = [];
  const log = (s: string) => void lines.push(s);

  writeFileSync(made, '{"a":1}\n');
  writeFileSync(tracked, '{"a":1}\n');
  expect(finishFixture({ made, tracked, write: false, log, err: log })).toBe(0);
  expect(readFileSync(tracked, 'utf8')).toBe('{"a":1}\n');

  // One byte differs: the check fails and the tracked file keeps its bytes and its time.
  writeFileSync(made, '{"a":2}\n');
  const before = statSync(tracked).mtimeMs;
  expect(finishFixture({ made, tracked, write: false, log, err: log })).toBe(1);
  expect(readFileSync(tracked, 'utf8')).toBe('{"a":1}\n');
  expect(statSync(tracked).mtimeMs).toBe(before);
  expect(lines.at(-1)).toContain('Nothing was written');

  // A missing tracked file is a difference too, and is not created.
  const missing = testInfo.outputPath('missing.json');
  expect(finishFixture({ made, tracked: missing, write: false, log, err: log })).toBe(1);
  expect(existsSync(missing)).toBe(false);

  // --write replaces it with the fixture made now.
  expect(finishFixture({ made, tracked, write: true, log, err: log })).toBe(0);
  expect(readFileSync(tracked, 'utf8')).toBe('{"a":2}\n');
});

test('fixtureArgs: <empty work folder> [--write], in any order', () => {
  expect(fixtureArgs(['/w'])).toEqual({ work: '/w', write: false });
  expect(fixtureArgs(['/w', '--write'])).toEqual({ work: '/w', write: true });
  expect(fixtureArgs(['--write', '/w'])).toEqual({ work: '/w', write: true });
  expect(fixtureArgs([])).toEqual({ work: null, write: false });
});

for (const [script, fixture] of [
  ['tests/unit/fixtures/make-old-bookings.mjs', 'old-bookings.json'],
  ['tests/fixtures/make-agreement-page-old.mjs', 'agreement-page-old.json'],
] as const) {
  test(`${script} makes its fixture in the work folder and leaves the tracked file to finishFixture`, () => {
    const src = read(script);
    // The bundle writes into the work folder, never next to the generator.
    expect(src).toContain(`writeFileSync(\${JSON.stringify(join(work, '${fixture}'))}`);
    expect(src).not.toContain(`JSON.stringify(join(here, '${fixture}'))`);
    // The tracked file is only ever passed to finishFixture, with the --write flag of the command line.
    expect(src).toContain(`finishFixture({ made: join(work, '${fixture}'), tracked: join(here, '${fixture}'), write })`);
    expect(src.match(/join\(here, '[^']+\.json'\)/g)).toEqual([`join(here, '${fixture}')`]);
    expect(src).not.toContain('Nothing else is touched');
  });
}
