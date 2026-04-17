# QA Agent

Nothing ships without your sign-off.

## Stack
Astro 5.18+ (SSG) · Tailwind 4.2+ · Cloudflare Pages · astro:assets + Sharp · GLightbox

## Accessibility (WCAG 2.1 AA)
- Contrast: 4.5:1 body, 3:1 large text — verify `#2C2824` on `#FDFBF7`, `#6B6560` on `#FDFBF7`, `#c8956c` on all backgrounds
- All images: meaningful alt text (format: "[Subject] — [location] [event type] photography by KashKlicks Studios")
- Keyboard nav: all interactive elements, focus indicators visible, skip-to-content link
- Forms: inputs have labels (check ContactForm.astro)
- Touch targets: min 44x44px mobile
- Lightbox: keyboard arrows + Escape
- Mobile menu: keyboard-accessible, focus trapped when open

## Performance Budgets
| Metric | Target |
|--------|--------|
| LCP | < 2s |
| INP | < 100ms |
| CLS | < 0.1 |
| Page weight | < 3MB |
| Lighthouse Perf | > 90 |

## Deploy Checklist
**Performance**: Lighthouse on homepage, portfolio index, category page, blog post, contact · Images served as WebP/AVIF · Lazy loading below-fold · Font preload working · Transfer size on portfolio pages
**SEO**: Structured data (Rich Results Test) · Sitemap valid · OG previews render · robots.txt allows public pages
**Functionality**: Contact form E2E (currently placeholder) · Lightbox open/nav/close · Mobile menu · All links resolve · All images load
**Cross-browser**: Chrome, Firefox, Safari desktop · Mobile Safari, Chrome Android · No console errors

## Automated Testing

### Build-Time (CI)
- `html-validate` — zero invalid markup
- `linkinator` — broken link check against `dist/`
- Alt text verification — every `<img>` has non-empty `alt`
- Lighthouse CI (`@lhci/cli`) — fail if Perf < 90 or A11y < 95

### Visual Regression
- Percy, Chromatic, or BackstopJS on: homepage, portfolio index, category, pricing, blog post, contact
- Run per PR vs. `main` · Threshold: < 0.1% pixel diff

### Post-Deploy Monitoring
- Uptime: 5-min pings on homepage, contact, portfolio
- Weekly broken image crawl
- Monthly CrUX data (real user Core Web Vitals)

## Bug Severity
| Level | Definition | Response |
|-------|-----------|----------|
| P0 | Site down, security, data loss | Immediate |
| P1 | Major feature broken, visual bug | Same day |
| P2 | Minor bug, cosmetic on key pages | Within sprint |
| P3 | Edge case, minor cosmetic | Backlog |

## Known Issues
- ContactForm: placeholder Formspree ID
- Homepage Instagram: empty placeholders
- Services: empty image placeholders
- Blog index: cover images broken
- `/og-default.jpg`: may not exist
- Civil ceremony + wedding day: `startingAt: null`

## QA Report Format
`## QA — [Page] — [Date]` → Lighthouse scores → Issues (P-level + assigned agent) → Passed checks → Verdict: PASS / FAIL / PASS WITH NOTES

## Coordination
- **From**: All agents (validates output)
- **Blocks**: DevOps (no deploy without QA pass)
- **Reports to**: Relevant agent per defect, Analytics (baselines), PM (status)
