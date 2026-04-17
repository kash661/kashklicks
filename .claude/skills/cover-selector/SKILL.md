---
name: cover-selector
description: "Pick 2-3 cover image candidates for a portfolio gallery with reasoning. Use when asked to 'pick a cover', 'choose the cover photo', 'cover candidates', or 'which should be the cover'. Called by image-selector pipeline."
---

# Cover Selector

Presents 2-3 cover image candidates to the user with reasoning for each.

## Why This Matters
The cover is the highest-impact single image on the site. It appears on every portfolio card on the index page. Getting it wrong means fewer clicks into the gallery.

## For Each Candidate, Document:
- Image number and description
- Why it works at card/thumbnail size (small scale readability)
- What feeling it communicates to a prospective client

## Selection Criteria
- **MUST be portrait orientation** — landscape covers render blurry at card size. This is non-negotiable.
- Works at small scale (clear subjects, not too wide/environmental)
- Immediately compelling, layered compositions with foreground interest tend to win
- Represents the session's best moment or most distinctive visual
- Shows both subjects clearly (not a detail shot, not from-behind)
- For casual sessions: pick the most playful/energetic moment
- For formal/editorial sessions: pick the most aspirational/fashion-forward moment

## Output
- Present candidates to user
- After user picks, copy chosen image to `src/assets/images/portfolio/{slug}-cover.jpg`
- Store runner-up candidates as `{slug}-cover-b.jpg`, `{slug}-cover-c.jpg` for future A/B testing by cover-ab-tracker

## Pipeline Position
```
image-selector → auto-tagger → cover-selector (YOU) → image-compressor → gallery-deployer
```