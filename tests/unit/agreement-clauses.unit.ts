import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import clausesJson from '../../src/data/agreement/clauses.json' with { type: 'json' };
import { parseAgreementSource } from '../../src/lib/agreement/parse-source.mjs';
import type { ClauseFile, SourceClause, SourceBlock } from '../../src/lib/agreement/types';

const mdPath = fileURLToPath(new URL('../../src/data/agreement/agreement-source.md', import.meta.url));
const mdBytes = readFileSync(mdPath);
const md = mdBytes.toString('utf8');
const file = clausesJson as unknown as ClauseFile;

const allClauses = (): SourceClause[] =>
  file.sections.flatMap((s) => s.items).filter((i): i is SourceClause => i.type === 'clause');
const clause = (id: string): SourceClause => {
  const c = allClauses().find((x) => x.id === id);
  if (!c) throw new Error(`clause ${id} missing`);
  return c;
};

test('source parses into 23 sections, 0 to 22', () => {
  const parsed = parseAgreementSource(md);
  expect(parsed.sections.map((s) => s.num)).toEqual(Array.from({ length: 23 }, (_, i) => i));
  expect(parsed.title).toBe('Photography and Film Agreement');
  expect(parsed.intro.length).toBeGreaterThan(0);
});

test('clause ids are unique', () => {
  const ids = allClauses().map((c) => c.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('flags never reach the client text', () => {
  expect(JSON.stringify(file)).not.toContain('⚑');
});

test('removed text stays removed', () => {
  expect(allClauses().find((c) => c.id === '3.2')).toBeUndefined();
  const json = JSON.stringify(file);
  expect(json).not.toContain('BUSINESS_ADDRESS');
  expect(json).not.toContain('small supplier');
});

test('clause 0.3 is word for word', () => {
  expect(clause('0.3').text).toBe(
    '**I** am {{BUSINESS_LEGAL_NAME}}, operating as AD Photography and KashKlicks. Phone 647 613 7430. Email info@kashklicks.ca. Website kashklicks.ca.',
  );
});

test('tag groups', () => {
  expect(clause('14.3').tags).toEqual([['COUPLE'], ['EVENT'], ['PROPOSAL']]);
  expect(clause('8.3').tags).toEqual([['WEDDING', 'FILM']]);
  expect(clause('5.2').tags).toEqual([['EVENT']]);
});

test('bullets attach to their clause', () => {
  expect(clause('16.6').bullets).toHaveLength(5);
  expect(clause('14.5').bullets).toHaveLength(5);
  expect(clause('3.6').bullets).toHaveLength(3);
});

test('blocks sit in sections 1, 2 and 4', () => {
  const where = new Map<string, number>();
  for (const s of file.sections)
    for (const i of s.items)
      if (i.type === 'block') where.set((i as SourceBlock).name, s.num);
  expect(Object.fromEntries(where)).toEqual({
    'TABLE:BOOKING': 1,
    'LIST:DELIVERABLES': 2,
    'TABLE:ADDONS': 4,
  });
});

test('clauses.json is up to date', () => {
  const { version, ...rest } = file;
  expect(rest).toEqual(parseAgreementSource(md));
  expect(version).toBe(createHash('sha256').update(mdBytes).digest('hex'));
});

test('a stray line inside a section throws', () => {
  const bad = '# Photography and Film Agreement\n\nIntro.\n\n## Who we are\n\nthis is not a clause\n';
  expect(() => parseAgreementSource(bad)).toThrow(/line 7/);
});
