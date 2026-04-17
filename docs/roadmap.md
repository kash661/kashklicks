# KashKlicks Skills Roadmap

## The Vision

Akash finishes a shoot, edits in Lightroom, drops photos in a folder, and says:
> "New pre-wedding, Priya + Raj, shot at Scarborough Bluffs"

Claude runs the entire pipeline automatically:

```
image-selector → auto-tagger → cover-selector → image-compressor → gallery-deployer
                                                                        ↓
                                                                  story-generator → blog-writer
                                                                        ↓
                                                                  instagram-curator
                                                                        ↓
                                                                  cover-ab-tracker (scheduled)
```

New gallery page goes live, blog post published, Instagram images ready, cover A/B test begins. Zero manual work beyond the initial Lightroom export.

---

## Skill Status

### Implemented (Production)

| Skill | File | What it does |
|-------|------|-------------|
| **image-selector** | `.claude/skills/image-selector/` | Scans all images, selects the best, culls duplicates, sequences for masonry grid. Self-improving via learnings log. |

### Implemented (Skeleton)

| Skill | File | What it does |
|-------|------|-------------|
| **auto-tagger** | `.claude/skills/auto-tagger/` | Generates tags from visual analysis (location, mood, activity, culture) |
| **cover-selector** | `.claude/skills/cover-selector/` | Picks 2-3 cover candidates with reasoning, stores runners-up for A/B testing |
| **image-compressor** | `.claude/skills/image-compressor/` | Resizes + compresses via image-optimizer MCP (Sharp). 2400px, 80% quality. |
| **gallery-deployer** | `.claude/skills/gallery-deployer/` | Copies files, creates/updates portfolio.json entry, verifies build. Handles brand new galleries. |

### Stubbed (Skill files exist, logic not written)

| Skill | File | What it does | Priority |
|-------|------|-------------|----------|
| **story-generator** | `.claude/skills/story-generator/` | Writes headline, body, pullQuote from visual analysis of images | High |
| **blog-writer** | `.claude/skills/blog-writer/` | Writes SEO blog post from story + images, picks hero image, targets local keywords | Medium |
| **instagram-curator** | `.claude/skills/instagram-curator/` | Picks 6 best square-croppable images across galleries for homepage grid | Medium |
| **cover-ab-tracker** | `.claude/skills/cover-ab-tracker/` | Rotates covers on schedule, measures CTR via Cloudflare analytics, picks winner | Low |

---

## Dependencies and Blockers

| Skill | Depends On |
|-------|-----------|
| story-generator | image-selector output |
| blog-writer | story-generator output |
| instagram-curator | image-selector output (pool of curated images) |
| cover-ab-tracker | Cloudflare Analytics configured, cover-selector runners-up stored, live site with traffic |
| image-compressor | image-optimizer MCP server installed (done) |
| gallery-deployer | All upstream skills in the pipeline |

## Infrastructure Needed

- **Cloudflare Pages CLI** (`wrangler`): For automated deploy from the pipeline. Currently manual git push.
- **Cloudflare Analytics**: For cover-ab-tracker. Not yet configured.
- **Scheduled agent / cron**: For cover-ab-tracker to run on a schedule (every 2 weeks) and swap covers based on data.

## MCP Servers

| MCP | Purpose | Status |
|-----|---------|--------|
| image-optimizer | Sharp-powered image compression and resize | Installed |
| (future) Cloudflare analytics | Pull pageview/CTR data for A/B testing | Not yet |
