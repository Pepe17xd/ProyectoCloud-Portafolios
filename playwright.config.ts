import { defineConfig, devices } from '@playwright/test';

// Start the safe local stack explicitly with `npm run dev:local` before these tests.
// The suite creates a few uniquely named rows and never clears persistent volumes.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: { baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  timeout: 90_000,
});
