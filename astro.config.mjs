import { defineConfig } from 'astro/config';
import { readFileSync } from 'node:fs';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

// Per-page <lastmod> for the sitemap comes from the prebuilt git-dates
// snapshot (scripts/generate-git-dates.mjs, run before `astro build`). Read
// defensively: if the file is missing or unreadable we fall back to empty maps
// and the sitemap keeps its build-time default lastmod. Never fails the build.
let gitDates = { blog: {}, pages: {} };
try {
  const raw = readFileSync(new URL('./src/data/git-dates.json', import.meta.url), 'utf-8');
  const parsed = JSON.parse(raw);
  gitDates = { blog: parsed.blog ?? {}, pages: parsed.pages ?? {} };
} catch {
  // No snapshot yet or unreadable: keep empty defaults.
}

export default defineConfig({
  site: 'https://kashklicks.ca',
  trailingSlash: 'always',
  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: ['.trycloudflare.com'],
    },
  },
  integrations: [
    sitemap({
      lastmod: new Date(),
      changefreq: 'weekly',
      priority: 0.7,
      filter: (page) =>
        !page.includes('/dev/') &&
        !page.includes('/font-lab') &&
        !page.includes('/free-engagement-session-toronto') &&
        !page.endsWith('/404/'),
      serialize(item) {
        const url = item.url.replace('https://kashklicks.ca', '').replace(/\/$/, '');
        // Trailing-slash path key ('' -> '/', '/about' -> '/about/') to match
        // the git-dates snapshot keys and the site's trailingSlash: 'always'.
        const path = url === '' ? '/' : `${url}/`;

        // Per-URL lastmod: blog posts resolve by slug (their entry already
        // folds in updatedDate/publishDate), static pages by trailing-slash
        // path. Dynamic detail routes (portfolio/location) are absent from the
        // snapshot, so they keep the build-time default lastmod. Guarded so a
        // bad date can never throw and fail the build.
        const blogMatch = path.match(/^\/blog\/(.+?)\/?$/);
        const rawLastmod = blogMatch ? gitDates.blog[blogMatch[1]] : gitDates.pages[path];
        let lastmod = item.lastmod;
        if (rawLastmod) {
          const parsed = new Date(rawLastmod);
          if (!Number.isNaN(parsed.getTime())) lastmod = parsed;
        }
        const base = { ...item, lastmod };

        // Tier 1 (0.9): homepage, core service pages, portfolio root
        if (
          url === '' ||
          url === '/portfolio' ||
          url === '/services/wedding' ||
          url === '/services/pre-wedding' ||
          url === '/services/civil-ceremony' ||
          url === '/services/celebrations' ||
          url === '/intimate-wedding-toronto'
        ) {
          return { ...base, priority: 0.9, changefreq: 'weekly' };
        }
        // Tier 2 (0.8): secondary hubs + portfolio detail
        if (
          url === '/services' ||
          url === '/about' ||
          url === '/contact' ||
          url === '/location-guide' ||
          url.startsWith('/portfolio/')
        ) {
          return { ...base, priority: 0.8, changefreq: 'monthly' };
        }
        // Tier 3 (0.6): blog
        if (url === '/blog' || url.startsWith('/blog/')) {
          return { ...base, priority: 0.6, changefreq: 'monthly' };
        }
        // Tier 4 (0.3): legal pages
        if (url === '/privacy' || url === '/terms') {
          return { ...base, priority: 0.3, changefreq: 'yearly' };
        }
        // City landing pages (e.g. /wedding-photographer-hamilton/)
        if (url.startsWith('/wedding-photographer-')) {
          return { ...base, priority: 0.85, changefreq: 'monthly' };
        }
        // Default: location guides and anything else
        return { ...base, priority: 0.7, changefreq: 'monthly' };
      },
    }),
  ],
  image: {
    experimentalLayout: 'constrained',
  },
  devToolbar: {
    enabled: false,
  },
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'hover',
  },
});
