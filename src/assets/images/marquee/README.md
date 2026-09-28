# Marquee letter photos

Photos for the marquee letter rental page (`/services/marquee-letters/`) and its blog posts.

Right now there are none. Every slot on the page shows a drawn plate instead: the word built like a marquee letter, bulbs on dark stone. The frame keeps the same shape either way, so a photo drops in without moving anything on the page.

## Rules for these photos

- Real photos of our own letters only. No wedding or other shoot photos standing in for the letters.
- Lit, at an evening event or in a dim room, so the bulbs read.
- Whole letters in frame. Nothing cropped off the top or sides.
- If there are guests in a photo, make sure they are happy to be on the website.
- Send the largest JPG you have. The site makes the small versions (AVIF and WebP) on its own.

## The slots

| Slot | Where it shows | Shape | What to send | Smallest size |
|---|---|---|---|---|
| `heroPhoto` | Top of the page, beside the heading | 4:5 portrait | LOVE lit at an evening party. All four letters in full. A person or two beside them helps show the 4 ft height. | 1600 x 2000 |
| `ohBabyPhoto` | "What we rent right now", the wide frame | 3:2 landscape | OH BABY lit at a baby shower or gender reveal. All six letters, shot straight on. | 2400 x 1600 |
| `numbersPhoto` | "What we rent right now", the tall frame | 4:5 portrait | One or two numbers lit at a birthday, full height in frame. A 1 for a first birthday is ideal. | 1600 x 2000 |

## How to add a photo

1. Put the file in this folder, for example `hero-love.jpg`.
2. Open `src/pages/services/marquee-letters.astro` and find the `TODO(marquee-photos)` lines near the top.
3. Replace the `null` with an import of the file:

   ```ts
   import heroPhoto from '../../assets/images/marquee/hero-love.jpg';
   ```

   and delete the matching `const heroPhoto ... = null;` line.
4. Check the alt text on that slot (the `alt` prop, also marked `TODO(marquee-photos)` in the page) still describes the photo you added. Update it if the photo shows something different.
5. Once the hero photo is in, add an `image` to the Service schema in the same file. It is left out on purpose until a real photo exists.

## Other placeholders that use this folder

| File | Used by | Shape | Replace with |
|---|---|---|---|
| `placeholder-cover.jpg` | The three marquee blog drafts (`src/content/blog/`) | 16:10, 1600 x 1000 | A real cover photo for each post before it publishes. |
| `public/og-marquee-letters.jpg` | The page's social preview (WhatsApp, Facebook, iMessage link cards) | 1200 x 630 | A 1200 x 630 crop of the hero photo. Until then it is a drawing, made by `node scripts/generate-og-marquee.mjs`. |
