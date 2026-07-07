/**
 * Prebuild step: capture the last git commit date for every blog post and for
 * every statically mappable page, and write them to src/data/git-dates.json.
 *
 * Consumers:
 *   - src/layouts/BlogLayout.astro -> BlogPosting.dateModified   (blog[slug])
 *   - astro.config.mjs             -> per-URL sitemap <lastmod>  (blog[slug] + pages[path])
 *
 * JSON shape (kept intentionally simple, "key -> ISO date"):
 *   {
 *     "blog":  { "<slug>":        "<ISO date>" },  // last-modified per post
 *     "pages": { "/<path>/":      "<ISO date>" }   // git last-commit per page
 *   }
 *
 * blog[slug]  = updatedDate (frontmatter) ?? git last-commit ?? committed
 *               snapshot ?? publishDate. This bakes the exact precedence both
 *               consumers want, so BlogLayout and the sitemap always agree.
 * pages[path] = git last-commit ?? committed snapshot.
 *
 * Robustness (Cloudflare Pages may build from a SHALLOW clone where
 * `git log` returns nothing):
 *   - Every git call is wrapped: a failure yields null, never a throw.
 *   - We MERGE over the already-committed git-dates.json. When git gives no
 *     date for a file we keep the previously committed value, so a shallow CI
 *     clone still ships accurate dates from the checked-in snapshot.
 *   - The script never throws and always exits 0. It must not fail the build.
 *
 * Usage: node scripts/generate-git-dates.mjs
 * Output: src/data/git-dates.json (committed to the repo as a fallback snapshot)
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, '..');
const blogDir = join(root, 'src', 'content', 'blog');
const pagesDir = join(root, 'src', 'pages');
const outFile = join(root, 'src', 'data', 'git-dates.json');

/** Strict ISO 8601 commit date (%cI) for a file, or null if unavailable. */
function gitDate(absPath) {
  try {
    const rel = relative(root, absPath);
    const out = execFileSync('git', ['log', '-1', '--format=%cI', '--', rel], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    // Shallow clone with no history for this file, not a git repo, or git
    // missing entirely. Never fatal: the committed snapshot is the fallback.
    return null;
  }
}

/**
 * Pull a single frontmatter scalar (publishDate / updatedDate) as an ISO
 * string. Avoids a YAML dependency; these fields are plain date scalars.
 */
function frontmatterDate(absPath, key) {
  try {
    const text = readFileSync(absPath, 'utf-8');
    const fm = text.split(/^---\s*$/m)[1] ?? '';
    const m = fm.match(new RegExp(`^${key}:\\s*"?([^"\\n]+)"?\\s*$`, 'm'));
    if (!m) return null;
    const d = new Date(m[1].trim());
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

// Load the committed snapshot so a shallow clone (no git history) keeps the
// accurate dates that were captured when the file was generated with full history.
let existing = { blog: {}, pages: {} };
try {
  if (existsSync(outFile)) {
    const parsed = JSON.parse(readFileSync(outFile, 'utf-8'));
    existing = { blog: parsed.blog ?? {}, pages: parsed.pages ?? {} };
  }
} catch {
  // Corrupt/absent snapshot: start clean.
}

const blog = {};
const pages = {};

// --- Blog posts ------------------------------------------------------------
try {
  for (const file of readdirSync(blogDir)) {
    if (!file.endsWith('.md')) continue;
    const slug = file.slice(0, -3);
    const abs = join(blogDir, file);
    const updated = frontmatterDate(abs, 'updatedDate');
    const git = gitDate(abs);
    const published = frontmatterDate(abs, 'publishDate');
    const value = updated ?? git ?? existing.blog[slug] ?? published;
    if (value) blog[slug] = value;
  }
} catch {
  // Blog dir unreadable: fall back to whatever was committed.
  Object.assign(blog, existing.blog);
}

// --- Pages -----------------------------------------------------------------
// Mapping is deliberately simple: index.astro -> its directory, every other
// .astro file -> /its/path/. We SKIP dynamic routes ([slug], [...slug])
// because one source file backs many URLs with different real dates, so a
// single file date would be misleading; those pages omit a git lastmod. Blog
// posts are covered separately (blog[] map, keyed by slug). dev/ and 404 are
// skipped since they are already filtered out of the sitemap.
function walkAstro(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'dev') continue;
      found.push(...walkAstro(abs));
    } else if (entry.name.endsWith('.astro')) {
      found.push(abs);
    }
  }
  return found;
}

function pagePath(absPath) {
  let rel = relative(pagesDir, absPath).replace(/\\/g, '/').replace(/\.astro$/, '');
  if (rel.includes('[')) return null; // dynamic route: cannot map cleanly
  if (rel === '404') return null;
  if (rel === 'index') return '/';
  if (rel.endsWith('/index')) rel = rel.slice(0, -'/index'.length);
  return `/${rel}/`; // trailingSlash: 'always'
}

try {
  for (const abs of walkAstro(pagesDir)) {
    const path = pagePath(abs);
    if (!path) continue;
    const value = gitDate(abs) ?? existing.pages[path];
    if (value) pages[path] = value;
  }
} catch {
  Object.assign(pages, existing.pages);
}

// Stable key order so the committed file only changes when a real date changes.
const sortObj = (obj) =>
  Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));

const payload = {
  _comment:
    'Generated by scripts/generate-git-dates.mjs. blog: post slug -> last-modified ISO date (updatedDate ?? git commit ?? publishDate). pages: URL path -> git last-commit ISO date. Committed as a fallback snapshot for shallow CI clones. Do not edit by hand.',
  blog: sortObj(blog),
  pages: sortObj(pages),
};

try {
  writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(
    `[git-dates] wrote ${Object.keys(payload.blog).length} blog + ` +
      `${Object.keys(payload.pages).length} page dates -> src/data/git-dates.json`
  );
} catch (err) {
  // Even a write failure must not fail the build; the committed snapshot stands.
  console.warn('[git-dates] could not write git-dates.json (non-fatal):', err?.message);
}
