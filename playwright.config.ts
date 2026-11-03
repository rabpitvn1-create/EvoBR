import { defineConfig, devices } from '@playwright/test'

const configuredPort = Number(process.env.PLAYWRIGHT_PORT ?? 4178)
const port = Number.isInteger(configuredPort) && configuredPort > 0 ? configuredPort : 4178
const useSystemChrome = process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  // Shared CI runners need time to load lazy pages and restore saved IndexedDB
  // state after navigation or refresh; retain all visibility and state assertions.
  expect: { timeout: 20_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${port}/storyforge/`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(useSystemChrome ? { channel: 'chrome' as const } : {}),
        launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH, args: process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON ? JSON.parse(process.env.PLAYWRIGHT_CHROMIUM_ARGS_JSON) : ['--no-sandbox', '--disable-dev-shm-usage'] } : {},
      },
    },
  ],
  webServer: {
    command: `node scripts/serve-e2e-snapshot.mjs --port ${port}`,
    url: `http://127.0.0.1:${port}/storyforge/`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
