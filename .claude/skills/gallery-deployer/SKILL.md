---
name: gallery-deployer
description: "Deploy a curated gallery to the website. Creates portfolio folder, updates portfolio.json, verifies build. Use when asked to 'deploy the gallery', 'put it on the site', 'wire it up', 'add to portfolio'. Called by image-selector pipeline."
---

# Gallery Deployer

Takes curated, compressed images and deploys them to the KashKlicks website.

## Process

### 1. Create Portfolio Subfolder
`src/assets/images/portfolio/{slug}/`

### 2. Copy Images
Rename sequentially: `01.jpg`, `02.jpg`, etc. (preserving gallery order from selection)

### 3. Set Cover Image
Copy the chosen cover to `src/assets/images/portfolio/{slug}-cover.jpg`

### 4. Update portfolio.json

**If entry already exists**: update `images`, `tags`, `location`, `story` fields as needed.

**If entry is brand new**: create the full entry:
```json
{
  "id": "{slug}",
  "slug": "{slug}",
  "couple": "{Display Name}",
  "category": "{category}",
  "location": "{location}",
  "locationDescription": "{generated or provided}",
  "coverImage": "{slug}-cover.jpg",
  "images": ["01.jpg", "02.jpg", ...],
  "featured": false,   ← ALWAYS false for new entries. See Homepage Rule below.
  "testimonialId": null,
  "story": null,
  "youtubeUrl": null,
  "hasFilm": false,
  "date": "{YYYY-MM-DD}",
  "tags": ["{from auto-tagger}"]
}
```

**Never use em dashes or en dashes** in any text fields.

### 5. Verify Build
Run `pnpm build` to confirm all images resolve and no pages break.

### 6. Restart Dev Server
Kill existing astro process, clear cache, restart: `pkill -f "astro"; rm -rf node_modules/.astro && pnpm dev &`

## Homepage Rule

**Only the original 5 galleries appear on the homepage.** Every new entry MUST have `"featured": false`. The featured 5 are:
1. Shuba + Rob
2. Alex + Aziz
3. Ayushi + Parth
4. Priyanka + Saurav
5. Meghna + Puneeth

Do NOT set `featured: true` on any new gallery unless Akash explicitly asks to swap one onto the homepage. New work is accessible through the portfolio/work section pages but does not appear on the homepage featured grid.

## Pipeline Position
```
image-selector → auto-tagger → cover-selector → image-compressor → gallery-deployer (YOU)
```

## Downstream (optional, user-triggered)
- story-generator: "Want me to write the story copy?"
- instagram-curator: "Want me to pick 6 for the homepage grid?"
- blog-writer: "Want me to write a blog post for this session?"