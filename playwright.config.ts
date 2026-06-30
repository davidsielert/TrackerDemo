import { defineConfig, devices } from "@playwright/test";

const basePort = process.env.DEMO_PORT ?? "";
const portSuffix = basePort ? `:${basePort}` : "";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://dashboard.localhost${portSuffix}`,
    trace: "retain-on-failure"
  }
});
