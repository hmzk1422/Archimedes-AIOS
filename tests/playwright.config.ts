import { defineConfig, devices } from '@playwright/test'

const HAMAZAKI_EMAIL = process.env.HAMAZAKI_EMAIL || 'hamazaki.ethanlin@gmail.com'
const HAMAZAKI_PASSWORD = process.env.HAMAZAKI_PASSWORD || 'et123456789'
const HIMASKA_EMAIL = process.env.HIMASKA_EMAIL || 'himaska.ethanlin@gmail.com'
const HIMASKA_PASSWORD = process.env.HIMASKA_PASSWORD || 'et123456789'

export default defineConfig({
  testDir: './',
  testMatch: '**/*.test.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['html', { outputFolder: 'test-results/html-report' }],
    ['junit', { outputFile: 'test-results/junit.xml' }],
    ['json', { outputFile: 'test-results/results.json' }],
    ['list']
  ],
  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'drag-drop',
      testMatch: '**/drag-drop/*.test.ts',
      testIgnore: ['**/node-communication/**', '**/task-detection/**', '**/tenant-isolation/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'task-detection',
      testMatch: '**/task-detection/*.test.ts',
      testIgnore: ['**/drag-drop/**', '**/node-communication/**', '**/tenant-isolation/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'tenant-isolation',
      testMatch: '**/tenant-isolation/*.test.ts',
      testIgnore: ['**/drag-drop/**', '**/task-detection/**', '**/node-communication/**'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'node-communication',
      testMatch: '**/node-communication/*.test.ts',
      testIgnore: ['**/drag-drop/**', '**/task-detection/**', '**/tenant-isolation/**'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: 'cd ../frontend && npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },

  /* Global test timeout */
  timeout: 60 * 1000,
})