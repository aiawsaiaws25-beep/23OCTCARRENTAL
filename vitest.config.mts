import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Later files win, matching Next.js precedence for the test environment.
const envFiles = [".env", ".env.local", ".env.test", ".env.test.local"];
const env = Object.assign({}, ...envFiles.filter(existsSync).map((f) => parseEnv(readFileSync(f, "utf8"))));

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
    // Server modules import "server-only"; under Vitest that guard must be a no-op.
    alias: { "server-only": fileURLToPath(new URL("./tests/helpers/server-only-stub.ts", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts"],
    // Rebuilds driveeasy_test from migrations once per run (QA_SKIP_DB_RESET=1 to skip).
    globalSetup: ["./tests/global-setup.ts"],
    // Integration tests hit real Postgres; give concurrency tests room.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    env: {
      ...env,
      NODE_ENV: "test",
      QA_DEV_DATABASE_URL: env.DATABASE_URL,
      // Server code under test must use driveeasy_test, never driveeasy_dev.
      ...(env.TEST_DATABASE_URL ? { DATABASE_URL: env.TEST_DATABASE_URL, DATABASE_URL_UNPOOLED: env.TEST_DATABASE_URL } : {}),
      // Isolated fake-provider state for unit/integration runs.
      FAKE_PAYMENTS_STATE_FILE: "./.local/fake-payments.vitest.json",
      // Nothing listens here: provider webhooks from tests never reach a running dev server.
      PAYMENTS_WEBHOOK_URL: "http://127.0.0.1:9/api/webhooks/payments",
      PAYMENTS_PROVIDER: "fake",
      STORAGE_PROVIDER: "local",
      UPLOADS_DIR: "./.local/uploads-vitest",
      LOG_LEVEL: "error",
    },
  },
});
