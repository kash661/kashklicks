#!/usr/bin/env node
/**
 * Turn a couple's location wishes into ranked places from the location guide.
 *
 * The shoot brief no longer shows a list of places. Couples tick what they
 * want around them (location_features), how far they will go
 * (location_areas) and how much walking is okay (walking_level). This script
 * filters src/data/locations.json with those answers so Akash (or Claude) can
 * propose three options.
 *
 * The keyword, setting, zone and walking maps live on each option's `match`
 * in src/data/onboarding-fields.json, so the form and this script never drift.
 *
 * Usage:
 *   node scripts/match-locations.mjs brief.json            # payload, {data}, or a KV record
 *   node scripts/match-locations.mjs --features water,fall --areas downtown,east --walking easy
 *   options: --limit N (default 8), --json (machine readable)
 */
import { readFileSync } from 'node:fs';

const schema = JSON.parse(readFileSync(new URL('../src/data/onboarding-fields.json', import.meta.url), 'utf8'));
const locations = JSON.parse(readFileSync(new URL('../src/data/locations.json', import.meta.url), 'utf8'));

const fields = Object.fromEntries(schema.sections.flatMap((s) => s.fields).map((f) => [f.name, f]));
const optionsOf = (name) => new Map((fields[name]?.options ?? []).map((o) => [o.value, o]));
const FEATURES = optionsOf('location_features');
const AREAS = optionsOf('location_areas');
const WALKING = optionsOf('walking_level');

// ── Read the answers ───────────────────────────────────────────────────
const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const list = (v) => (v ? String(v).split(',').map((x) => x.trim()).filter(Boolean) : []);

let answers = {};
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--json'));
if (file) {
  const raw = JSON.parse(readFileSync(file, 'utf8'));
  answers = raw.data && typeof raw.data === 'object' ? raw.data : raw;
}
const features = flag('features') !== undefined ? list(flag('features')) : answers.location_features ?? [];
const areas = flag('areas') !== undefined ? list(flag('areas')) : answers.location_areas ?? [];
const walking = flag('walking') ?? answers.walking_level ?? '';
const own = answers.locations_own ?? '';
const limit = Number(flag('limit') ?? 8) || 8;
const asJson = args.includes('--json');

for (const f of features) if (!FEATURES.has(f)) console.error(`  ignoring unknown feature "${f}" (known: ${[...FEATURES.keys()].join(', ')})`);
for (const a of areas) if (!AREAS.has(a)) console.error(`  ignoring unknown area "${a}" (known: ${[...AREAS.keys()].join(', ')})`);
if (walking && !WALKING.has(walking)) console.error(`  ignoring unknown walking level "${walking}" (known: ${[...WALKING.keys()].join(', ')})`);

// ── Filters ────────────────────────────────────────────────────────────
const zoneSet = new Set();
let anywhere = areas.length === 0;
for (const a of areas) {
  const zones = AREAS.get(a)?.match?.zones;
  if (!zones) continue;
  if (zones.length === 0) anywhere = true;
  zones.forEach((z) => zoneSet.add(z));
}
const walkSet = new Set(WALKING.get(walking)?.match?.walkingLevels ?? []);

const text = (l) => [l.vibe, l.vibeLine, l.idealIf].filter(Boolean).join(' ').toLowerCase();
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function featureHit(loc, option) {
  const m = option.match ?? {};
  const settingHit = (m.setting ?? []).some((s) => (loc.setting ?? []).includes(s));
  const seasonHit = (m.season ?? []).some((s) => (loc.season ?? []).includes(s));
  const hay = text(loc);
  const keywordHit = (m.keywords ?? []).some((k) => new RegExp(`\\b${escape(k.toLowerCase())}`).test(hay));
  // Both a setting and a keyword is a stronger match than either alone.
  return (settingHit || seasonHit ? 1 : 0) + (keywordHit ? 1 : 0);
}

const wanted = features.map((f) => FEATURES.get(f)).filter((o) => o && o.match);

const ranked = locations
  .filter((l) => anywhere || zoneSet.has(l.zone))
  .filter((l) => walkSet.size === 0 || walkSet.has(l.walkingLevel))
  .map((l) => {
    const hits = wanted.map((o) => ({ label: o.label, score: featureHit(l, o) })).filter((h) => h.score > 0);
    return {
      loc: l,
      matched: hits.map((h) => h.label),
      // Covering more of their wishes beats a strong hit on one.
      score: hits.length * 10 + hits.reduce((n, h) => n + h.score, 0),
    };
  })
  .filter((r) => wanted.length === 0 || r.score > 0)
  .sort((a, b) => b.score - a.score || a.loc.name.localeCompare(b.loc.name))
  .slice(0, limit);

// ── Print ──────────────────────────────────────────────────────────────
const labels = (map, values) => values.map((v) => map.get(v)?.label ?? v).join(', ') || 'none';

if (asJson) {
  console.log(JSON.stringify(ranked.map((r) => ({
    id: r.loc.id, name: r.loc.name, area: r.loc.area, zone: r.loc.zone, matched: r.matched, score: r.score,
    vibeLine: r.loc.vibeLine, walkingLevel: r.loc.walkingLevel, permitNeeded: r.loc.permitNeeded,
    parking: r.loc.parking, travelTime: r.loc.travelTime,
  })), null, 2));
  process.exit(0);
}

console.log(`\nWishes:   ${labels(FEATURES, features)}`);
console.log(`Areas:    ${anywhere && areas.length ? 'anywhere' : labels(AREAS, areas)}`);
console.log(`Walking:  ${walking ? labels(WALKING, [walking]) : 'not given'}`);
if (own) console.log(`Their own ideas: ${own}`);
if (features.includes('unusual')) console.log('Note: they ticked "Something unusual", read their own ideas and notes.');
if (wanted.length === 0) console.log('No feature wishes given, so this is every place that fits the area and walking filters.');
console.log('');

if (ranked.length === 0) {
  console.log('No places match all of that. Try widening the areas or the walking level.\n');
  process.exit(0);
}

ranked.forEach((r, i) => {
  const l = r.loc;
  console.log(`${i + 1}. ${l.name}  (${l.area})`);
  if (l.vibeLine) console.log(`   ${l.vibeLine}`);
  if (r.matched.length) console.log(`   Matches: ${r.matched.join(', ')}`);
  console.log(`   Walking: ${l.walkingLevel ?? 'unknown'} | Permit: ${l.permitNeeded ?? 'unknown'} | Travel: ${l.travelTime ?? 'unknown'}`);
  if (l.parking) console.log(`   Parking: ${l.parking}`);
  console.log('');
});
