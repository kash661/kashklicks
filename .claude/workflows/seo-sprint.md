# Workflow: SEO Sprint

## Trigger
Periodic SEO audit and optimization cycle. Run monthly or when organic traffic plateaus.

## Sequence

### 0. Research
**Agent**: Researcher
- Gather competitor content velocity, new keyword opportunities
- Pull "People also ask" and autocomplete data for target clusters
- Deliver keyword gap analysis to SEO agent

### 1. Audit
**Agent**: SEO
- Crawl site for technical issues (broken links, missing meta, orphan pages)
- Review Core Web Vitals via Lighthouse and Cloudflare Analytics
- Analyze keyword rankings and traffic trends
- Identify content gaps vs. Toronto/GTA competitors
- Review `docs/seo/keyword-map.md` for coverage gaps
- Output: prioritized issue list + content opportunity list

### 2. Technical Fixes
**Agents**: Frontend + DevOps
- Fix broken markup, missing schema, slow pages
- Implement redirects in `public/_redirects` if needed
- Optimize flagged images (re-export, rename for SEO, update alt text)
- Update `_headers` if caching improvements identified

### 3. Content Sprint
**Agent**: Content
- Write content for identified keyword gaps
- Update underperforming existing posts (refresh, expand, re-optimize)
- Add internal links between new and existing content
- Update `docs/content/content-calendar.md`

### 4. Validation
**Agent**: QA
- Re-run Lighthouse on fixed pages
- Confirm all technical issues resolved
- Validate new content meets accessibility and performance standards
- Verify structured data via Rich Results Test

### 5. Deploy + Monitor
**Agent**: DevOps
- Deploy all changes to Cloudflare Pages

### 6. Measure
**Agent**: Analytics
- Baseline all changed pages (traffic, rankings, conversions)
- 2-week check: indexing status, initial ranking movement
- 4-week check: full impact report to PM and SEO agents
