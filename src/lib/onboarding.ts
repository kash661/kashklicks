// Shared logic for the client onboarding brief (/welcome/brief-.../).
//
// One schema (src/data/onboarding-fields.json) drives the page markup, the
// in-browser validation, the worker's server-side validation, and the plain
// text summary that lands in Akash's inbox. This module must stay free of DOM
// and Node APIs: it is bundled into both the page script (Vite) and the
// Cloudflare Worker (wrangler/esbuild).

export type FieldKind =
  | 'text'
  | 'email'
  | 'tel'
  | 'date'
  | 'url'
  | 'textarea'
  | 'select'
  | 'radio'
  | 'checkboxes'
  | 'checkbox'
  | 'films'
  | 'repeat';

export interface FieldOption {
  value: string;
  label?: string;
  /** Option is only valid when another field holds one of these values. */
  onlyWith?: Record<string, string[]>;
  /** Hints for scripts/match-locations.mjs: settings, keywords, zones or
   *  walking levels in src/data/locations.json that this answer points to. */
  match?: Record<string, string[]>;
}

export interface ColumnDef {
  name: string;
  label: string;
  kind: 'text' | 'url';
  max?: number;
  placeholder?: string;
}

export interface FieldDef {
  name: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  max?: number;
  options?: FieldOption[];
  optionsSource?: 'packages';
  help?: string;
  placeholder?: string;
  maxItems?: number;
  rows?: number;
  columns?: ColumnDef[];
  extra?: boolean;
  width?: 'half';
  autocomplete?: string;
  privacyNote?: boolean;
  /** Fields sharing a group print together under one heading in the summary. */
  summaryGroup?: string;
  summaryLabel?: string;
}

export interface SectionDef {
  id: string;
  numeral: string;
  title: string;
  fields: FieldDef[];
  extraLabel?: string;
  extraHint?: string;
  /** One plain line under the section heading. */
  lede?: string;
}

export interface Schema {
  meta: {
    version: number;
    path: string;
    endpoint: string;
    storagePrefix: string;
    textareaMax: number;
    shortMax: number;
    requiredOneOf?: { fields: string[]; message: string }[];
  };
  sections: SectionDef[];
}

export type Payload = Record<string, unknown>;

export interface ValidationResult {
  ok: boolean;
  /** Keyed by top-level field name. One message per field. */
  errors: Record<string, string>;
  /** Non-blocking notes, e.g. a link from a site outside the usual list. */
  warnings: Record<string, string>;
  /** The payload reduced to known fields, trimmed and normalized. */
  data: Payload;
}

/** Link hosts a couple would normally paste. Anything else on https is still
 *  accepted, only flagged as a warning so Akash knows to double check it. */
export const ALLOWED_LINK_HOSTS = [
  'instagram.com',
  'youtube.com',
  'youtu.be',
  'tiktok.com',
  'pinterest.com',
  'pinterest.ca',
  'pin.it',
  'open.spotify.com',
  'spotify.link',
  'music.apple.com',
] as const;

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Control characters except tab (\x09), newline (\x0A) and carriage return (\x0D).
function isStrippedChar(c: number): boolean {
  return (
    c <= 0x08 || c === 0x0b || c === 0x0c || (c >= 0x0e && c <= 0x1f) || c === 0x7f ||
    (c >= 0x200b && c <= 0x200f) || c === 0x2028 || c === 0x2029 || c === 0xfeff
  );
}

function stripString(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) if (!isStrippedChar(s.charCodeAt(i))) out += s[i];
  return out;
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Strip control and zero width characters from every string, recursively. */
export function stripControl<T>(value: T): T {
  if (typeof value === 'string') return stripString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => stripControl(v)) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = stripControl(v);
    return out as T;
  }
  return value;
}

/** Booking ids become part of a storage key, so keep them to a safe alphabet. */
export function cleanBookingId(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
}

export function allFields(schema: Schema): FieldDef[] {
  return schema.sections.flatMap((s) => s.fields);
}

export function fieldMax(field: { kind: string; max?: number }, schema: Schema): number {
  if (typeof field.max === 'number') return field.max;
  return field.kind === 'textarea' ? schema.meta.textareaMax : schema.meta.shortMax;
}

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  return ALLOWED_LINK_HOSTS.some((allowed) => h === allowed || h.endsWith('.' + allowed));
}

/** Check one pasted link. Returns an error (blocking) or a warning (not). */
export function checkLink(value: string): { error?: string; warning?: string } {
  if (!value) return {};
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { error: 'Please paste the full link, starting with https://' };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { error: 'Please paste a web link, starting with https://' };
  }
  if (!hostAllowed(url.hostname)) {
    return {
      warning: 'I may not be able to open links from this site. It will still be sent.',
    };
  }
  if (url.protocol === 'http:') return { warning: 'This link is not secure. It will still be sent.' };
  return {};
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

function isEmpty(v: unknown): boolean {
  if (v === undefined || v === null || v === false) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

function tooLong(n: number): string {
  return `Please keep this under ${n} characters.`;
}

function requiredMessage(field: FieldDef): string {
  switch (field.kind) {
    case 'select':
    case 'radio':
      return 'Please choose one.';
    case 'checkbox':
      return 'Please tick this so I can use your answers.';
    default:
      return 'Please fill this in.';
  }
}

interface FieldOutcome {
  value?: unknown;
  error?: string;
  warning?: string;
}

/** Normalize and check a single field. `payload` lets option rules read
 *  sibling fields (e.g. a third location only with The Pre Wedding). */
export function validateField(field: FieldDef, raw: unknown, payload: Payload, schema: Schema): FieldOutcome {
  const max = fieldMax(field, schema);

  switch (field.kind) {
    case 'text':
    case 'email':
    case 'tel':
    case 'date':
    case 'url':
    case 'textarea': {
      const v = str(raw);
      if (!v) return { value: '' };
      if (v.length > max) return { value: v, error: tooLong(max) };
      if (field.kind === 'email' && !EMAIL_RE.test(v)) return { value: v, error: 'Please check the email address.' };
      if (field.kind === 'tel') {
        const digits = v.replace(/\D/g, '');
        if (digits.length < 7 || digits.length > 15) return { value: v, error: 'Please check the phone number.' };
      }
      if (field.kind === 'date' && !DATE_RE.test(v)) return { value: v, error: 'Please pick a date.' };
      if (field.kind === 'url') {
        const link = checkLink(v);
        if (link.error) return { value: v, error: link.error };
        return { value: v, warning: link.warning };
      }
      return { value: v };
    }

    case 'select':
    case 'radio': {
      const v = str(raw);
      if (!v) return { value: '' };
      const opt = (field.options ?? []).find((o) => o.value === v);
      if (!opt) return { value: '', error: 'Please choose one of the options.' };
      if (opt.onlyWith) {
        for (const [other, allowed] of Object.entries(opt.onlyWith)) {
          if (!allowed.includes(str(payload[other]))) {
            return { value: v, error: 'This option is not included in your package.' };
          }
        }
      }
      return { value: v };
    }

    case 'checkboxes': {
      const list = Array.isArray(raw) ? raw.map(str).filter(Boolean) : [];
      const valid = new Set((field.options ?? []).map((o) => o.value));
      const picked = [...new Set(list)];
      if (picked.some((v) => !valid.has(v))) return { value: picked.filter((v) => valid.has(v)), error: 'Please choose from the options.' };
      return { value: picked };
    }

    case 'checkbox': {
      const v = raw === true || raw === 'true' || raw === 'on' || raw === 'yes';
      return { value: v };
    }

    case 'films': {
      if (raw !== undefined && raw !== null && !Array.isArray(raw)) return { value: [], error: 'Something went wrong with this list.' };
      const items = (Array.isArray(raw) ? raw : []) as unknown[];
      const out: Record<string, string>[] = [];
      const seen = new Set<string>();
      for (const item of items) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const id = str(rec.id);
        if (!SLUG_RE.test(id) || seen.has(id)) continue;
        seen.add(id);
        const title = str(rec.title).slice(0, schema.meta.shortMax);
        const note = str(rec.note);
        if (note.length > schema.meta.shortMax) return { value: out, error: `Film notes: ${tooLong(schema.meta.shortMax)}` };
        out.push({ id, title, note });
      }
      const cap = field.maxItems ?? 20;
      if (out.length > cap) return { value: out.slice(0, cap), error: `Please pick up to ${cap}.` };
      return { value: out };
    }

    case 'repeat': {
      if (raw !== undefined && raw !== null && !Array.isArray(raw)) return { value: [], error: 'Something went wrong with these rows.' };
      const rows = (Array.isArray(raw) ? raw : []) as unknown[];
      const cols = field.columns ?? [];
      const out: Record<string, string>[] = [];
      let warning: string | undefined;
      for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const rec = row as Record<string, unknown>;
        const clean: Record<string, string> = {};
        let any = false;
        for (const col of cols) {
          const v = str(rec[col.name]);
          const colMax = fieldMax(col, schema);
          const rowNo = out.length + 1;
          if (v.length > colMax) return { value: out, error: `Row ${rowNo}, ${col.label.toLowerCase()}: ${tooLong(colMax)}` };
          if (v && col.kind === 'url') {
            const link = checkLink(v);
            if (link.error) return { value: out, error: `Row ${rowNo}: ${link.error}` };
            if (link.warning && !warning) warning = `Row ${rowNo}: ${link.warning}`;
          }
          clean[col.name] = v;
          if (v) any = true;
        }
        if (any) out.push(clean);
      }
      const cap = field.rows ?? 5;
      if (out.length > cap) return { value: out.slice(0, cap), error: `Please add up to ${cap}.` };
      return { value: out, warning };
    }
  }
  return { value: undefined };
}

/** Validate a whole submission. Unknown keys are dropped from `data`. */
export function validate(payload: Payload, schema: Schema): ValidationResult {
  const errors: Record<string, string> = {};
  const warnings: Record<string, string> = {};
  const data: Payload = {};
  const input = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};

  for (const field of allFields(schema)) {
    const outcome = validateField(field, input[field.name], input, schema);
    data[field.name] = outcome.value;
    if (outcome.error) errors[field.name] = outcome.error;
    else if (outcome.warning) warnings[field.name] = outcome.warning;
    if (!outcome.error && field.required && isEmpty(outcome.value)) {
      errors[field.name] = requiredMessage(field);
    }
  }

  for (const rule of schema.meta.requiredOneOf ?? []) {
    if (rule.fields.every((f) => isEmpty(data[f]))) {
      const target = rule.fields[0];
      if (!errors[target]) errors[target] = rule.message;
    }
  }

  return { ok: Object.keys(errors).length === 0, errors, warnings, data };
}

/** "Priya and Arjun", from whichever names are present. */
export function coupleName(payload: Payload): string {
  const a = str(payload.p1_name);
  const b = str(payload.p2_name);
  return [a, b].filter(Boolean).join(' and ') || 'Unnamed couple';
}

function optionLabel(field: FieldDef, value: string): string {
  return field.options?.find((o) => o.value === value)?.label ?? value;
}

function formatValue(field: FieldDef, value: unknown): string[] {
  if (isEmpty(value)) return [];
  switch (field.kind) {
    case 'select':
    case 'radio':
      return [optionLabel(field, String(value))];
    case 'checkboxes':
      return [(value as string[]).map((v) => optionLabel(field, v)).join(', ')];
    case 'checkbox':
      return ['Yes'];
    case 'films':
      return (value as Record<string, string>[]).map(
        (f, i) => `  ${i + 1}. ${f.title || f.id}${f.note ? `, ${f.note}` : ''}`,
      );
    case 'repeat': {
      const cols = field.columns ?? [];
      return (value as Record<string, string>[]).map((row, i) => {
        const parts = cols.map((c) => row[c.name]).filter(Boolean);
        if (field.name === 'ref_videos') {
          const [url, ts, note] = [row.url, row.timestamp, row.note];
          return `  ${i + 1}. ${[url, ts ? `at ${ts}` : '', note].filter(Boolean).join(', ')}`;
        }
        return `  ${i + 1}. ${parts.join(', ')}`;
      });
    }
    default:
      return [String(value)];
  }
}

/** Plain text brief in section order. Lists are numbered in rank order. Each
 *  section ends with a "Skipped:" line naming the questions left blank. */
export function renderSummary(payload: Payload, schema: Schema): string {
  const lines: string[] = [];
  for (const section of schema.sections) {
    lines.push(`${section.numeral}. ${section.title.toUpperCase()}`);
    const skipped: string[] = [];
    const groupsDone = new Set<string>();
    for (const field of section.fields) {
      const label = field.label.replace(/[?.]$/, '');
      if (field.summaryGroup) {
        // Print the whole group once, at its first field, as indented lines.
        if (groupsDone.has(field.summaryGroup)) continue;
        groupsDone.add(field.summaryGroup);
        const members = section.fields.filter((f) => f.summaryGroup === field.summaryGroup);
        const rows: string[] = [];
        for (const m of members) {
          const out = formatValue(m, payload[m.name]);
          if (out.length === 0) skipped.push(m.label.replace(/[?.]$/, ''));
          else rows.push(`  ${m.summaryLabel ?? m.label}: ${out.join(', ')}`);
        }
        if (rows.length) lines.push(`${field.summaryGroup}:`, ...rows);
        continue;
      }
      const out = formatValue(field, payload[field.name]);
      if (out.length === 0) {
        skipped.push(label);
        continue;
      }
      if (out.length === 1 && !out[0].startsWith('  ')) lines.push(`${label}: ${out[0]}`);
      else lines.push(`${label}:`, ...out);
    }
    if (skipped.length) lines.push(`Skipped: ${skipped.join('; ')}`);
    lines.push('');
  }
  return lines.join('\n').trim() + '\n';
}

/** Location wishes as readable labels, for the sheet, the email and the doc. */
export function locationWishes(
  payload: Payload,
  schema: Schema,
): { features: string; areas: string; walking: string; own: string; line: string } {
  const byName = new Map(allFields(schema).map((f) => [f.name, f]));
  const labels = (name: string): string => {
    const f = byName.get(name);
    const v = payload[name];
    if (!f || isEmpty(v)) return '';
    const list = Array.isArray(v) ? (v as string[]) : [String(v)];
    return list.map((x) => optionLabel(f, x)).join(', ');
  };
  const features = labels('location_features');
  const areas = labels('location_areas');
  const walking = labels('walking_level');
  const own = str(payload.locations_own);
  const line = [
    features && `Wishes: ${features}`,
    areas && `areas: ${areas}`,
    walking && `walking: ${walking}`,
    own && `their own ideas: ${own}`,
  ]
    .filter(Boolean)
    .join('; ');
  return { features, areas, walking, own, line };
}

interface PackageLike {
  id: string;
  name: string;
  price: number | null;
  salePrice?: number | null;
}

/** Fill package option labels from packages.json so prices and names live in
 *  one place. Returns a new schema; the input is not changed. */
export function withPackageLabels(schema: Schema, packages: PackageLike[]): Schema {
  const byId = new Map(packages.map((p) => [p.id, p]));
  return {
    ...schema,
    sections: schema.sections.map((s) => ({
      ...s,
      fields: s.fields.map((f) => {
        if (f.optionsSource !== 'packages') return f;
        return {
          ...f,
          options: (f.options ?? []).map((o) => {
            const p = byId.get(o.value);
            return { ...o, label: p ? p.name : o.label ?? o.value };
          }),
        };
      }),
    })),
  };
}

export function formatPrice(p: PackageLike): string {
  const amount = p.salePrice ?? p.price;
  if (amount == null) return '';
  return `$${amount.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
