// Runs before the Playwright web server starts (see playwright.config.ts):
// rebuild driveeasy_e2e → migrate → seed, and clear the e2e fake-payments state.
import { rmSync } from "node:fs";
import { dbName, hasMigrations, hasSeed, migrate, recreateDb, seed } from "../tests/helpers/db";

async function main() {
  if (process.env.QA_SKIP_DB_RESET === "1") return;
  const url = process.env.QA_E2E_DATABASE_URL;
  if (!url || dbName(url) !== "driveeasy_e2e") throw new Error("QA_E2E_DATABASE_URL must point at driveeasy_e2e");
  await recreateDb("driveeasy_e2e");
  if (hasMigrations()) {
    migrate(url);
    if (hasSeed()) seed(url);
  }
  rmSync(".local/fake-payments.e2e.json", { force: true });
  rmSync(".local/uploads-e2e", { recursive: true, force: true });
  console.log("[qa] driveeasy_e2e ready");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
