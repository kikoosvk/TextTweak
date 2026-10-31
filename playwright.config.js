const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests', testMatch: '*.spec.cjs', workers: 1, timeout: 30000,
  reporter: 'list', use: { trace: 'retain-on-failure' },
  webServer: { command: 'node tests/server.cjs', port: 8765, reuseExistingServer: false }
});
