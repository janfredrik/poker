import { defineConfig, devices } from '@playwright/test';

// Smoke test against the built server (run `npm run build` first; `npm run test:e2e` does).
// POKER_FAST=1 makes demo bots act almost at once. PW_CHANNEL=chrome uses the installed Chrome
// instead of Playwright's own Chromium (`npx playwright install chromium`).
const PORT = 3199;

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'nb-NO',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
    launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
  },
  webServer: {
    command: 'node dist/server.js',
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    env: { PORT: String(PORT), POKER_FAST: '1', DATA_DIR: '/tmp/poker-e2e' },
  },
});
