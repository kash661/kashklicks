import { test, expect } from '@playwright/test';
import schema from '../src/data/onboarding-fields.json' with { type: 'json' };

// The hidden page path is stored once, in the schema.
const PATH = schema.meta.path;

test.describe('Client shoot brief (onboarding)', () => {
  test('robots meta is noindex', async ({ page }) => {
    await page.goto(PATH);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('personal link pre-fills the basics and is stripped from the URL', async ({ page }) => {
    await page.goto(`${PATH}?b=TEST-1&p=love-story-film&n1=Priya&n2=Arjun&d=2027-05-16`);
    await expect(page.locator('#onb-p1_name')).toHaveValue('Priya');
    await expect(page.locator('#onb-p2_name')).toHaveValue('Arjun');
    await expect(page.locator('#onb-package_id')).toHaveValue('love-story-film');
    await expect(page.locator('#onb-shoot_date')).toHaveValue('2027-05-16');
    await expect(page.locator('#onb-booking-id')).toHaveValue('TEST-1');
    await expect(page.locator('[data-onb-greeting]')).toHaveText('For Priya and Arjun');
    expect(new URL(page.url()).search).toBe('');
  });

  test('an unknown package id is ignored', async ({ page }) => {
    await page.goto(`${PATH}?p=not-a-package&n1=Priya`);
    await expect(page.locator('#onb-p1_name')).toHaveValue('Priya');
    await expect(page.locator('#onb-package_id')).toHaveValue('');
  });

  test('empty submit shows field errors and does not post', async ({ page }) => {
    let posted = false;
    await page.route('**/r/onboarding', (route) => {
      posted = true;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(PATH);
    await page.locator('[data-onb-submit]').click();

    await expect(page.locator('[data-onb-problem]')).toBeVisible();
    for (const name of ['p1_name', 'email', 'package_id', 'story_how_met', 'vibe_select', 'location_features', 'consent']) {
      await expect(page.locator(`#onb-${name}-error`), name).toBeVisible();
    }
    await expect(page.locator('#onb-p1_name')).toBeFocused();
    expect(posted).toBe(false);
  });

  test('a complete brief posts and shows the done state', async ({ page }) => {
    let body = '';
    await page.route('**/r/onboarding', (route) => {
      body = route.request().postData() ?? '';
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    });
    await page.goto(`${PATH}?b=TEST-2&n1=Priya&n2=Arjun`);

    await page.fill('#onb-email', 'priya@example.com');
    await page.fill('#onb-phone', '416 555 0199');
    await page.selectOption('#onb-package_id', 'pre-wedding-full');
    await page.fill('#onb-shoot_date', '2027-05-16');
    await page.fill('#onb-story_how_met', 'We met at a friend\'s Diwali party and argued about chai.');
    await page.check('input[name="vibe_select"][value="romantic"]');

    // Location wishes: chips toggle on tap, no list of places is shown.
    await page.locator('label.onb-chip', { hasText: 'Beach and water' }).click();
    await page.locator('label.onb-chip', { hasText: 'Fall colours' }).click();
    await page.locator('label.onb-chip', { hasText: 'Downtown Toronto' }).click();
    await page.check('input[name="walking_level"][value="easy"]');

    await page.check('#onb-consent');
    await page.locator('[data-onb-submit]').click();

    await expect(page.locator('[data-onb-done]')).toBeVisible();
    expect(body).not.toContain('delivery_format');
    await expect(page.locator('[data-onb-done-names]')).toHaveText('Priya and Arjun.');
    await expect(page.locator('#onb-form')).toBeHidden();
    expect(body).toContain('TEST-2');
    expect(body).toContain('"location_features":["water","fall"]');
    expect(body).toContain('"walking_level":"easy"');
    expect(body).toContain('Priya');
  });

  test('location wishes replace the place list', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator('.onb-loc-card, [data-onb-locs]')).toHaveCount(0);
    const chip = page.locator('input[name="location_features"][value="forest"]');
    await expect(page.locator('input[name="location_features"]')).toHaveCount(12);
    await page.locator('label.onb-chip', { hasText: 'Forest and trees' }).click();
    await expect(chip).toBeChecked();
    await page.locator('label.onb-chip', { hasText: 'Forest and trees' }).click();
    await expect(chip).not.toBeChecked();
    await expect(page.getByText('Outside the GTA adds $0.75 per km round trip plus parking.')).toBeVisible();
  });

  test('the film format question is gone and delivery explains the formats', async ({ page }) => {
    await page.goto(PATH);
    await expect(page.locator('input[name="delivery_format"]')).toHaveCount(0);
    await expect(page.getByText('Films are delivered in landscape 4K. Save the date reels are vertical for Instagram.')).toBeVisible();
    await expect(page.locator('input[name="delivery_where_shown"]')).toHaveCount(4);
    await expect(page.locator('#onb-delivery_deadline')).toBeVisible();
  });

  test('own places alone satisfy the location rule', async ({ page }) => {
    await page.goto(PATH);
    await page.fill('#onb-locations_own', 'Trinity Bellwoods');
    await page.locator('[data-onb-submit]').click();
    await expect(page.locator('#onb-location_features-error')).toBeHidden();
    await expect(page.locator('#onb-p1_name-error')).toBeVisible();
  });

  test('a failed post keeps the form and shows the error', async ({ page }) => {
    await page.route('**/r/onboarding', (route) => route.fulfill({ status: 502, contentType: 'application/json', body: '{"ok":false}' }));
    await page.goto(`${PATH}?n1=Priya&n2=Arjun`);
    await page.fill('#onb-email', 'priya@example.com');
    await page.fill('#onb-phone', '416 555 0199');
    await page.selectOption('#onb-package_id', 'love-story-film');
    await page.fill('#onb-shoot_date', '2027-05-16');
    await page.fill('#onb-story_how_met', 'At work.');
    await page.check('input[name="vibe_select"][value="fun"]');
    await page.fill('#onb-locations_own', 'Our backyard');
    await page.check('#onb-consent');
    await page.locator('[data-onb-submit]').click();

    await expect(page.locator('[data-onb-error]')).toBeVisible();
    await expect(page.locator('#onb-form')).toBeVisible();
    await expect(page.locator('[data-onb-submit]')).toBeEnabled();
  });
});
