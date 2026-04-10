import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  return new Response(
    `User-agent: *
Allow: /

Sitemap: https://kashklicks.ca/sitemap-index.xml`,
    {
      headers: {
        'Content-Type': 'text/plain',
      },
    }
  );
};
