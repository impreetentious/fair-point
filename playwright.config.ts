import { defineConfig } from '@playwright/test'

const PORT = 4173
const BASE_URL = `http://127.0.0.1:${PORT}`

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  webServer: {
    command: 'npm run preview',
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
