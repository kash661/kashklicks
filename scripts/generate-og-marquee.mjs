/**
 * Social preview for /services/marquee-letters/ while there are no photos of
 * our letters yet. Draws LOVE the way a marquee letter is built (the same
 * geometry as the page's photo slots, src/lib/marquee-bulbs.mjs) on the dark
 * stone surface. It deliberately uses no photograph: the default og image is
 * a wedding couple, which would mislabel a rental page.
 *
 * Replace it with a real photo of the letters once Akash sends one
 * (src/assets/images/marquee/README.md).
 *
 * Usage:  node scripts/generate-og-marquee.mjs
 * Output: public/og-marquee-letters.jpg (1200x630)
 *
 * Colours are the design tokens --color-surface-dark and --color-on-dark,
 * written out because librsvg cannot read CSS custom properties.
 */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { bulbLayout } from '../src/lib/marquee-bulbs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputPath = join(root, 'public/og-marquee-letters.jpg');

const WIDTH = 1200;
const HEIGHT = 630;
const SURFACE_DARK = '#2c2824'; // --color-surface-dark
const ON_DARK = '#faf9f6'; // --color-on-dark
const BODY = '#3a3632'; // on-dark mixed 7% into surface-dark, as on the page

const art = bulbLayout('LOVE');
const [, , vbWidth, vbHeight] = art.viewBox.split(' ').map(Number);
const drawnWidth = WIDTH * 0.62;
const drawnHeight = vbHeight * (drawnWidth / vbWidth);
const floor = HEIGHT * 0.7; // the letters stand on a faint floor line
const x = (WIDTH - drawnWidth) / 2;
const y = floor - drawnHeight;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${SURFACE_DARK}"/>
  <rect x="0" y="${floor.toFixed(1)}" width="${WIDTH}" height="1.5" fill="${ON_DARK}" fill-opacity="0.1"/>
  <svg x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${drawnWidth.toFixed(1)}" height="${drawnHeight.toFixed(1)}" viewBox="${art.viewBox}">
    <path d="${art.bodyPath}" fill="none" stroke="${BODY}" stroke-width="22" stroke-linejoin="miter" stroke-miterlimit="2" stroke-linecap="square"/>
    <path d="${art.bulbPath}" fill="none" stroke="${ON_DARK}" stroke-opacity="0.12" stroke-width="15" stroke-linecap="round"/>
    <path d="${art.bulbPath}" fill="none" stroke="${ON_DARK}" stroke-width="8.4" stroke-linecap="round"/>
  </svg>
</svg>`;

await sharp(Buffer.from(svg)).jpeg({ quality: 85, mozjpeg: true }).toFile(outputPath);
console.log(`Generated marquee OG image: ${outputPath} (${WIDTH}x${HEIGHT})`);
