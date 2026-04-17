---
name: instagram-curator
description: "Select the 6 best images for the homepage Instagram grid from portfolio galleries. Use when the user says 'pick instagram images', 'update the instagram grid', 'choose images for the homepage grid', or 'instagram section'."
---

# Instagram Curator

**Status: STUB - Not yet implemented**

## Purpose
Select 6 images from across all portfolio galleries for the homepage Instagram grid section. These should represent the photographer's range and be optimized for square/near-square cropping.

## Inputs
- All portfolio galleries (scan `src/assets/images/portfolio/*/`)
- Current Instagram grid images (check `src/assets/images/placeholder/instagram-*.jpg`)

## Selection Criteria
- Each image should come from a different gallery/couple if possible
- Must work well as a square crop (subjects centered, no critical content at edges)
- Mix of: one portrait close-up, one wide landscape/venue, one candid moment, one detail shot, one dramatic/cinematic, one fun/emotional
- Represent the range of locations, seasons, and session types
- High visual impact at small thumbnail size

## Output
- 6 images copied to `src/assets/images/placeholder/instagram-1.jpg` through `instagram-6.jpg`
- Square cropped to ~1200x1200px using image-optimizer MCP

## Downstream From
- `image-selector` (provides the pool of curated images to choose from)
