// Shared by the two fixture generators (tests/unit/fixtures/make-old-bookings.mjs and
// tests/fixtures/make-agreement-page-old.mjs). Their fixtures are the only proof of how bookings made before
// the payment change of 2026-11-23 behave, so a run that only checks a fixture never rewrites it: a generator
// makes the fixture inside its work folder, then finishFixture compares it with the tracked file byte for byte.
// Only --write replaces the tracked file (to record a NEW old shape on purpose). No npm package.
import { copyFileSync, existsSync, readFileSync } from 'node:fs';

/** The command line of a generator: <empty work folder> [--write], in any order. */
export function fixtureArgs(argv) {
  const write = argv.includes('--write');
  const rest = argv.filter((a) => a !== '--write');
  return { work: rest[0] ?? null, write };
}

/**
 * Compares the fixture made now (`made`, in the work folder) with the tracked one. Returns the exit code:
 * 0 when they are the same bytes (nothing written) or when --write replaced the tracked file; 1 when they
 * differ or the tracked file is missing, and then nothing is written.
 */
export function finishFixture({ made, tracked, write, log = console.log, err = console.error }) {
  const fresh = readFileSync(made);
  const exists = existsSync(tracked);
  if (exists && readFileSync(tracked).equals(fresh)) {
    log(`${tracked}: the same bytes as the fixture made now. Nothing was written.`);
    return 0;
  }
  if (write) {
    copyFileSync(made, tracked);
    log(`${tracked}: replaced with the fixture made now (--write).`);
    return 0;
  }
  err(
    `${tracked}: ${exists ? 'differs from' : 'is missing, unlike'} the fixture made now (${made}). Nothing was written. ` +
      'A difference is an old booking that changed: never use --write to make a test pass, only to record a new old shape on purpose.',
  );
  return 1;
}
