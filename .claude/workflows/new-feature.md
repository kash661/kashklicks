# Workflow: New Feature

## Trigger
Adding a new page, component, or capability to the site.

## Sequence

### 0. Triage
**Agent**: PM
- Evaluate against Priority Stack (perf > SEO > visual > conversion > content)
- Create backlog item with priority, effort, dependencies
- Assign to sprint and notify relevant agents

### 1. Design Phase
**Agent**: Design
- Define layout using existing design tokens from `global.css`
- Specify responsive behavior across breakpoints
- Identify which existing components to reuse vs. new ones needed
- Output: design spec referencing actual token names and component inventory

### 2. SEO Review
**Agent**: SEO
- Define URL structure, meta requirements, structured data needed
- Identify target keywords (reference `docs/seo/keyword-map.md`)
- Specify internal linking opportunities
- Output: SEO requirements checklist

### 3. Content Creation
**Agent**: Content
- Write all copy for the new feature/page
- Follow SEO keyword targets
- Write alt text for images (format: "[Subject] — [location] [event type] photography by KashKlicks Studios")
- Output: content in appropriate format (markdown for blog, JSON additions for data-driven pages)

### 4. Frontend Build
**Agent**: Frontend
- Implement using existing components where possible
- Use Astro `<Image>` for all portfolio/hero images
- Use Tailwind classes referencing design tokens (e.g., `bg-bg-elevated`, `text-accent`)
- Implement SEO requirements (pass title/description to BaseLayout, add JsonLd if needed)
- Output: working feature in `pnpm run dev`

### 5. Backend (if needed)
**Agent**: Backend
- Update content schemas if new collection types needed
- Add/update JSON data files in `src/data/`
- Configure any new integrations
- Output: data layer ready

### 6. QA Validation
**Agent**: QA
- Accessibility audit (contrast, keyboard nav, alt text)
- Lighthouse performance check
- Cross-browser spot check
- Link and image validation
- Output: QA report — pass or fail with specific issues

### 7. Deploy
**Agent**: DevOps
- Only after QA pass
- `pnpm run build` → verify no warnings
- Deploy to Cloudflare Pages (via git push to main or wrangler)
- Verify live URL

### 8. Measure
**Agent**: Analytics
- Confirm event tracking on new page/feature
- Set baseline metrics
- Report to PM at next weekly status
