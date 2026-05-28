import { test, expect } from '@playwright/test';

const URL = '/free-engagement-session-toronto/';

test.describe('Free Engagement Session LP', () => {
  test('renders hero, how-it-works, FAQ, and inquiry form', async ({ page }) => {
    await page.goto(URL);

    await expect(page.getByRole('heading', { name: /engagement session, on me/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /think of it like a cake tasting/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /questions before the tasting/i })).toBeVisible();
    await expect(page.locator('#eof-form-1')).toBeVisible();
  });

  test('secondary CTA links to the how-it-works section', async ({ page }) => {
    await page.goto(URL);
    const cta = page.getByRole('link', { name: /how the tasting works/i });
    await expect(cta).toHaveAttribute('href', '#how-the-gift-works');
  });

  test('inquiry form shows its core fields', async ({ page }) => {
    await page.goto(URL);
    // Single-stage form. (The wedding-date input is intentionally excluded —
    // flatpickr swaps it for a visible altInput and hides the original.)
    await expect(page.locator('#eof-name')).toBeVisible();
    await expect(page.locator('#eof-email')).toBeVisible();
    await expect(page.locator('#eof-venue')).toBeVisible();
  });

  test('robots meta is noindex', async ({ page }) => {
    await page.goto(URL);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('FAQ first item is open by default', async ({ page }) => {
    await page.goto(URL);
    // Native <details> accordion — first item carries the `open` attribute.
    await expect(page.locator('details.faq-item-first[open]')).toHaveCount(1);
  });
});
