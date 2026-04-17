---
name: cover-ab-tracker
description: "Track portfolio cover image performance using Cloudflare analytics and rotate covers based on click-through data. Use when the user says 'check cover performance', 'which cover is winning', 'rotate covers', or 'A/B test covers'."
---

# Cover A/B Tracker

**Status: STUB - Not yet implemented**

## Purpose
Run A/B tests on portfolio cover images by rotating between 2-3 candidates and measuring which one drives more clicks from the portfolio index page to the individual gallery page.

## Dependencies
- Cloudflare Analytics (or Cloudflare Web Analytics) configured on kashklicks.ca
- Multiple cover candidates stored per gallery (from image-selector Step 6)

## Workflow
1. Store 2-3 cover candidates per gallery (naming: `{slug}-cover-a.jpg`, `{slug}-cover-b.jpg`, `{slug}-cover-c.jpg`)
2. Set the active cover in portfolio.json
3. After a defined period (e.g., 2 weeks), check Cloudflare analytics for click-through rates on each gallery page
4. Swap to the next candidate
5. After all candidates have run, pick the winner and set it permanently

## Data Tracking
- Page views on `/portfolio/{slug}` (the destination)
- Referrer: `/portfolio` or `/portfolio/{category}` (the index pages where the cover appears)
- Time period per variant: minimum 2 weeks for statistical significance

## Downstream From
- `image-selector` (provides 2-3 cover candidates)
- Cloudflare Analytics (provides click data)
