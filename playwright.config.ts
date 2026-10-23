import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

// E2E runs never touch driveeasy_dev: the web server is started against the
// QA-owned driveeasy_e2e database (rebuilt + seeded by e2e/prepare-db.ts
// before the server starts),
// with its own fake-payments state file and uploads folder.
//
//   pnpm test:e2e                       -> next dev on :3000 (own distDir .next-qa, so it can run
//                                          next to other agents' dev servers)
//   QA_PROD=1 pnpm test:e2e             -> next build (against driveeasy_e2e) + next start on :3000
//   QA_PROD=1 QA_SKIP_BUILD=1 ...       -> next start on the existing production build
//   QA_SKIP_DB_RESET=1 pnpm test:e2e    -> keep the existing driveeasy_e2e data
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const PORT = 3000;
const baseURL = `http://localhost:${PORT}`;
const e2eDbUrl = (() => {
  const u = new URL(process.env.TEST_DATABASE_URL ?? "postgres://localhost/driveeasy_test");
  u.pathname = "/driveeasy_e2e";
  return u.toString();
})();
process.env.QA_E2E_DATABASE_URL = e2eDbUrl;

const prod = process.env.QA_PROD === "1";
const serve = prod
  ? `${process.env.QA_SKIP_BUILD === "1" ? "" : "pnpm build && "}pnpm start --port ${PORT}`
  : `pnpm dev --port ${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
    { name: "mobile-safari", use: { ...devices["iPhone 14"] } },
  ],
  webServer: {
    command: `pnpm exec tsx e2e/prepare-db.ts && ${serve}`,
    url: baseURL,
    // Reusing a server would risk running against a dev server wired to driveeasy_dev.
    reuseExistingServer: false,
    timeout: prod ? 900_000 : 180_000,
    env: {
      QA_E2E_DATABASE_URL: e2eDbUrl,
      DATABASE_URL: e2eDbUrl,
      DATABASE_URL_UNPOOLED: e2eDbUrl,
      APP_URL: baseURL,
      BETTER_AUTH_URL: baseURL,
      PAYMENTS_PROVIDER: "fake",
      PAYMENTS_WEBHOOK_URL: `${baseURL}/api/webhooks/payments`,
      FAKE_PAYMENTS_STATE_FILE: "./.local/fake-payments.e2e.json",
      STORAGE_PROVIDER: "local",
      UPLOADS_DIR: "./.local/uploads-e2e",
      ...(prod ? {} : { NEXT_DIST_DIR: ".next-qa" }),
    },
  },
});
