import { defineConfig } from '@playwright/test';

// Node-only unit tests (no browser, no dev server). Run with: pnpm test:unit
export default defineConfig({
  testDir: './tests/unit',
  testMatch: '**/*.unit.ts',
  timeout: 15000,
  reporter: 'list',
});
