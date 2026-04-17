---
name: auto-tagger
description: "Generate portfolio tags from visual analysis of selected gallery images. Use when asked to 'tag this gallery', 'generate tags', or 'add tags'. Called by image-selector pipeline."
---

# Auto Tagger

Generates tags for a portfolio entry by analyzing the visual content of selected gallery images.

## Inputs
- Portfolio slug (to find images in `src/assets/images/portfolio/{slug}/`)
- Selected images from image-selector

## Tag Categories
1. **Location**: Recognizable landmarks/neighborhoods (`rc-harris`, `commerce-court`, `guild-park`)
2. **Time/light**: Lighting conditions (`golden-hour`, `blue-hour`, `night`, `autumn`)
3. **Mood/style**: Overall energy (`intimate`, `editorial`, `cinematic`, `playful`)
4. **Activity**: Distinctive elements (`boat`, `streetcar`, `proposal`, `dancing`)
5. **Cultural**: If visible and relevant (`south-asian`, `multicultural`)
6. **Venue type**: General category (`urban`, `waterfront`, `garden`, `architecture`)

## Rules
- Maximum 8 tags per entry
- Use kebab-case
- Prefer specific over generic (`rc-harris` over `building`)
- Only tag what's visible in the selected images

## Output
- Array of tag strings for portfolio.json `tags` field

## Pipeline Position
```
image-selector → auto-tagger (YOU) → cover-selector → image-compressor → gallery-deployer
```