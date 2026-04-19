import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://kashklicks.ca',
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
        !page.endsWith('/404/'),
      serialize(item) {
        const url = item.url.replace('https://kashklicks.ca', '').replace(/\/$/, '');
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
          return { ...item, priority: 0.9, changefreq: 'weekly' };
        }
        // Tier 2 (0.8): secondary hubs + portfolio detail
        if (
          url === '/services' ||
          url === '/about' ||
          url === '/contact' ||
          url === '/location-guide' ||
          url.startsWith('/portfolio/')
        ) {
          return { ...item, priority: 0.8, changefreq: 'monthly' };
        }
        // Tier 3 (0.6): blog
        if (url === '/blog' || url.startsWith('/blog/')) {
          return { ...item, priority: 0.6, changefreq: 'monthly' };
        }
        // Tier 4 (0.3): legal pages
        if (url === '/privacy' || url === '/terms') {
          return { ...item, priority: 0.3, changefreq: 'yearly' };
        }
        // Default: location guides and anything else
        return { ...item, priority: 0.7, changefreq: 'monthly' };
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
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  experimental: {
    clientPrerender: true,
  },
});
