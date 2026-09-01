import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';

const evidenceRoot = process.env.SW_EVIDENCE_DIR
  ? resolve(process.env.SW_EVIDENCE_DIR)
  : process.cwd();

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: resolve(evidenceRoot, 'playwright'),
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: resolve(evidenceRoot, 'playwright-report') }]
  ],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.SW_FOUNDRY_URL ?? 'http://127.0.0.1:33333',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  }
});
