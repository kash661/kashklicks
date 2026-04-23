import { test, expect } from '@playwright/test';

const URL = '/free-engagement-session-toronto/';

test.describe('Free Engagement Session LP', () => {
  test('renders hero, how-it-works, FAQ, form', async ({ page }) => {
    await page.goto(URL);

    await expect(page.getByRole('heading', { name: /your love story/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /how the gift works/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /frequently asked/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /tell me about your wedding/i })).toBeVisible();
  });

  test('hero CTA links to how-the-gift-works', async ({ page }) => {
    await page.goto(URL);
    const cta = page.getByRole('link', { name: /see how it works/i });
    await expect(cta).toHaveAttribute('href', '#how-the-gift-works');
  });

  test('stage 1 email-only form shows expected fields; stage 2 hidden', async ({ page }) => {
    await page.goto(URL);
    await expect(page.locator('#eof-email')).toBeVisible();
    await expect(page.locator('#eof-wedding-month')).toBeVisible();
    await expect(page.locator('#eof-name')).not.toBeVisible();
    await expect(page.locator('#eof-city')).not.toBeVisible();
  });

  test('robots meta is noindex', async ({ page }) => {
    await page.goto(URL);
    const robots = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robots).toContain('noindex');
  });

  test('FAQ first item is open by default', async ({ page }) => {
    await page.goto(URL);
    const firstFaq = page.locator('.faq-item-first button').first();
    await expect(firstFaq).toHaveAttribute('aria-expanded', 'true');
  });
});
