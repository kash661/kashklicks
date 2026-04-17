/**
 * Generate the default OG image from the hero image.
 * Uses Sharp (already an Astro dependency) to resize to 1200x630
 * with a dark gradient overlay for text readability.
 *
 * Usage: node scripts/generate-og.mjs
 * Output: public/og-default.jpg
 */

import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const WIDTH = 1200;
const HEIGHT = 630;

// Create a dark gradient overlay (bottom-heavy for potential text placement)
const gradientSvg = `<svg width="${WIDTH}" height="${HEIGHT}">
  <defs>
    <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="rgba(0,0,0,0.15)" />
      <stop offset="60%" stop-color="rgba(0,0,0,0.05)" />
      <stop offset="100%" stop-color="rgba(0,0,0,0.4)" />
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#grad)" />
</svg>`;

const heroPath = join(root, 'src/assets/images/hero/hero-main.jpg');
const outputPath = join(root, 'public/og-default.jpg');

const resized = await sharp(heroPath)
  .resize(WIDTH, HEIGHT, { fit: 'cover', position: 'center' })
  .toBuffer();

await sharp(resized)
  .composite([{ input: Buffer.from(gradientSvg), blend: 'over' }])
  .jpeg({ quality: 85 })
  .toFile(outputPath);

console.log(`Generated OG image: ${outputPath} (${WIDTH}x${HEIGHT})`);
