export default {
  async fetch(request: Request, env: { ASSETS: Fetcher }): Promise<Response> {
    const url = new URL(request.url);

    // Canonicalize www → apex. Preserves path + query string so UTM and
    // fbclid parameters survive the redirect. Uses 301 so search engines
    // consolidate link equity onto kashklicks.ca.
    if (url.hostname === 'www.kashklicks.ca') {
      url.hostname = 'kashklicks.ca';
      return Response.redirect(url.toString(), 301);
    }

    // Canonicalize trailing slash. Astro builds directory-style pages
    // (`/page/index.html`) but the absent-slash variants were being served
    // as a second canonical, fragmenting analytics and SEO. Skip paths with
    // a file extension (e.g. /robots.txt, /favicon.svg) and the root.
    const p = url.pathname;
    if (p.length > 1 && !p.endsWith('/') && !/\.[^/]+$/.test(p)) {
      url.pathname = p + '/';
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
