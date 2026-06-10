import type { APIRoute } from 'astro';
import { getImage } from 'astro:assets';
import type { ImageMetadata } from 'astro';
import portfolio from '../data/portfolio.json';
import locations from '../data/locations.json';
import site from '../data/site.json';

/**
 * Image sitemap for Google Images. The regular sitemap (@astrojs/sitemap)
 * carries no <image:image> entries, and for a photography business the
 * galleries ARE the product. One entry per page, listing that page's images
 * at their built (hashed) URLs.
 */

const portfolioImages = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/images/portfolio/**/*.{jpg,jpeg,JPG,JPEG}',
  { eager: true }
);
const locationImages = import.meta.glob<{ default: ImageMetadata }>(
  '/src/assets/images/locations/*.jpg',
  { eager: true }
);

const xmlEscape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const GET: APIRoute = async () => {
  const pages: { loc: string; images: { url: string; title: string }[] }[] = [];

  for (const entry of portfolio as any[]) {
    const imgs: { url: string; title: string }[] = [];
    for (let i = 0; i < (entry.images || []).length; i++) {
      const name = entry.images[i];
      const mod =
        portfolioImages[`/src/assets/images/portfolio/${entry.id}/${name}`] ||
        portfolioImages[`/src/assets/images/portfolio/${name}`];
      if (!mod) continue;
      const built = await getImage({ src: mod.default, width: 1600, format: 'jpg', quality: 80 });
      imgs.push({
        url: new URL(built.src, site.url).href,
        title: `${entry.couple} at ${entry.location}, photo ${i + 1}, by AD Photography`,
      });
    }
    if (imgs.length) {
      pages.push({ loc: `${site.url}/portfolio/${entry.slug || entry.id}/`, images: imgs });
    }
  }

  for (const loc of locations as any[]) {
    const mod = locationImages[`/src/assets/images/locations/${loc.image}`];
    if (!mod) continue;
    const built = await getImage({ src: mod.default, width: 1600, format: 'jpg', quality: 80 });
    pages.push({
      loc: `${site.url}/location-guide/${loc.id}/`,
      images: [{ url: new URL(built.src, site.url).href, title: `${loc.name}, ${loc.area}, photography location` }],
    });
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${pages
  .map(
    (p) => `  <url>
    <loc>${xmlEscape(p.loc)}</loc>
${p.images.map((im) => `    <image:image><image:loc>${xmlEscape(im.url)}</image:loc><image:title>${xmlEscape(im.title)}</image:title></image:image>`).join('\n')}
  </url>`
  )
  .join('\n')}
</urlset>`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
