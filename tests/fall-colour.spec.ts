import { test, expect, type Page } from '@playwright/test';

// The panel is mounted on a dev-only scratch page so these specs never depend
// on the pre-wedding page's layout. The Worker 404s /dev/* in production.
const URL = '/dev/fall-colour/';
const API = '**/api/fall-colour.json';

type Row = {
  park: string;
  region: string;
  colourChange: number;
  leafFall: number;
  dominantColour: string;
  lat: number;
  lng: number;
};

// Real coordinates, so the haversine filter is exercised for real. Distances
// from Toronto (43.6532, -79.3832) are noted in km.
const NEARBY: Row[] = [
  { park: 'Algonquin',  region: 'Algonquin',    colourChange: 70, leafFall: 20, dominantColour: 'Red',    lat: 45.58,   lng: -78.35 },   // 229
  { park: 'Arrowhead',  region: 'Algonquin',    colourChange: 62, leafFall: 15, dominantColour: 'Orange', lat: 45.39,   lng: -79.21 },   // 194
  { park: 'Bon Echo',   region: 'Southeastern', colourChange: 55, leafFall: 12, dominantColour: 'Mixed',  lat: 44.9,    lng: -77.2 },    // 222
  { park: 'Killbear',   region: 'Algonquin',    colourChange: 55, leafFall: 10, dominantColour: 'Yellow', lat: 45.35,   lng: -80.2 },    // 199
  { park: 'Awenda',     region: 'Southwestern', colourChange: 40, leafFall: 8,  dominantColour: 'Green',  lat: 44.8437, lng: -80.0027 }, // 141
  { park: 'Presquile',  region: 'Southeastern', colourChange: 30, leafFall: 5,  dominantColour: 'Brown',  lat: 44.0,    lng: -77.7 },    // 140
  { park: 'Pinery',     region: 'Southwestern', colourChange: 12, leafFall: 2,  dominantColour: 'Green',  lat: 43.25,   lng: -81.83 },   // 203
  { park: 'Rondeau',    region: 'Southwestern', colourChange: 5,  leafFall: 0,  dominantColour: 'Green',  lat: 42.28,   lng: -81.85 },   // 252
];

// Must never render: one is too far, one is in an excluded region.
const EXCLUDED: Row[] = [
  { park: 'Voyageur', region: 'Southeastern', colourChange: 95, leafFall: 40, dominantColour: 'Red', lat: 45.58, lng: -74.45 }, // 445
  { park: 'Quetico',  region: 'Northwestern', colourChange: 99, leafFall: 60, dominantColour: 'Red', lat: 48.6,  lng: -91.5 },  // 1082
];

function payload(rows: Row[], reportDate: string) {
  return {
    source: 'Ontario Parks Fall Colour Report',
    sourceUrl: 'https://www.ontarioparks.ca/fallcolour',
    fetchedAt: reportDate,
    parks: rows.map((r) => ({ ...r, slug: r.park.toLowerCase(), reportDate })),
  };
}

async function mock(page: Page, body: unknown, status = 200) {
  await page.route(API, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }),
  );
}

const panelOf = (page: Page) => page.locator('[data-fall-colour]');

test.describe('Ontario Parks fall colour panel', () => {
  // Pin the zone so the formatted report date is the same on every machine.
  test.use({ timezoneId: 'America/Toronto' });

  test('stays hidden when the route returns 503', async ({ page }) => {
    await mock(page, { source: '', sourceUrl: '', fetchedAt: '', parks: [] }, 503);
    await page.goto(URL);

    const panel = panelOf(page);
    await expect(panel).toHaveAttribute('data-fall-colour-state', 'hidden');
    await expect(panel).toBeHidden();
  });

  test('stays hidden in July when nothing has turned yet', async ({ page }) => {
    // Out of season AND every reading is zero: the panel has nothing to say.
    await page.clock.setFixedTime(new Date('2026-07-15T12:00:00Z'));
    await mock(
      page,
      payload(
        NEARBY.map((r) => ({ ...r, colourChange: 0, leafFall: 0, dominantColour: 'Green' })),
        '2026-07-14T12:00:00Z',
      ),
    );
    await page.goto(URL);

    const panel = panelOf(page);
    await expect(panel).toHaveAttribute('data-fall-colour-state', 'hidden');
    await expect(panel).toBeHidden();
  });

  test('shows six rows, most colour first, nearest breaking a tie', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
    await mock(page, payload([...NEARBY, ...EXCLUDED], '2026-10-04T13:00:00Z'));
    await page.goto(URL);

    const panel = panelOf(page);
    await expect(panel).toBeVisible();

    const rows = panel.locator('.fall-colour__row');
    await expect(rows).toHaveCount(6);

    // 70, 62, then the 55 tie resolved by distance (Killbear 199 km before
    // Bon Echo 222 km), then 40 and 30. Pinery and Rondeau fall past the limit.
    await expect(panel.locator('.fall-colour__park')).toHaveText([
      'Algonquin',
      'Arrowhead',
      'Killbear',
      'Bon Echo',
      'Awenda',
      'Presquile',
    ]);

    await expect(rows.first().locator('.fall-colour__numbers')).toHaveText(
      '70% colour change, 20% leaf fall',
    );

    // Filtered out by distance and by region respectively.
    await expect(panel.getByText('Voyageur')).toHaveCount(0);
    await expect(panel.getByText('Quetico')).toHaveCount(0);
  });

  test('credits and links the Ontario Parks source', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-05T12:00:00Z'));
    await mock(page, payload(NEARBY, '2026-10-04T13:00:00Z'));
    await page.goto(URL);

    const credit = panelOf(page).locator('.fall-colour__credit');
    await expect(credit).toBeVisible();

    const link = credit.getByRole('link', { name: 'Ontario Parks Fall Colour Report' });
    await expect(link).toHaveAttribute('href', 'https://www.ontarioparks.ca/fallcolour');
    await expect(link).toHaveAttribute('rel', 'noopener nofollow');
    await expect(link).toHaveAttribute('target', '_blank');

    await expect(credit).toContainText('updated October 4, 2026');
    await expect(credit).toContainText('Not affiliated with Ontario Parks.');
  });
});
