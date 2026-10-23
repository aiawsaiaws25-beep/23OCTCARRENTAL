// Vitest global setup: rebuild driveeasy_test from migrations once per run so
// integration tests start from a known schema. Tests create their own unique
// rows (no reliance on seed ordering). Set QA_SKIP_DB_RESET=1 to skip.
import { dbName, hasMigrations, hasSeed, recreateDb, migrate, seed, testDbUrl } from "./helpers/db";

export default async function setup() {
  if (process.env.QA_SKIP_DB_RESET === "1") return;
  const name = dbName(testDbUrl());
  if (name !== "driveeasy_test") throw new Error(`TEST_DATABASE_URL must point at driveeasy_test, got ${name}`);
  const url = await recreateDb(name);
  if (hasMigrations()) {
    migrate(url);
    if (hasSeed()) seed(url);
  }
}
