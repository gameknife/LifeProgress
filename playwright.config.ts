import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://localhost:1420", channel: "msedge", viewport: { width: 520, height: 920 }, trace: "retain-on-failure" },
  webServer: { command: "npm run dev", url: "http://localhost:1420", reuseExistingServer: true, timeout: 30_000 },
});
