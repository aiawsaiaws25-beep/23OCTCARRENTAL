// Database CLI.
//   pnpm db:migrate [--url <url>]   apply pending migrations
//   pnpm db:deploy                  same, for Vercel builds (requires DATABASE_URL_UNPOOLED on Vercel)
//   pnpm db:reset   [--url <url>]   DROP everything, re-migrate (refuses in production)
//   pnpm db:seed    [--url <url>] [--reset]   seed sample data (+ test accounts)
// URL precedence: --url > DATABASE_URL_UNPOOLED > DATABASE_URL (.env.local is
// loaded but never overrides variables already set in the shell).
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { createDb } from "@/db/client";
import { migrateDatabase, migrationUrl, resetDatabase } from "@/db/migrate";
import { seed } from "@/db/seed";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string" }, reset: { type: "boolean", default: false } },
});

const redact = (url: string) => url.replace(/\/\/([^:@/]+)(:[^@/]*)?@/, "//$1:***@");

async function main() {
  const command = positionals[0];
  const url = migrationUrl(values.url);
  switch (command) {
    case "deploy":
      // Build-time migration on Vercel: must use the direct (unpooled) connection.
      if (process.env.VERCEL && !process.env.DATABASE_URL_UNPOOLED && !values.url) {
        throw new Error("DATABASE_URL_UNPOOLED is not set: refusing to migrate through the pooled connection");
      }
      await migrateDatabase(url);
      console.log(`Migrated ${redact(url)}`);
      break;
    case "migrate":
      await migrateDatabase(url);
      console.log(`Migrated ${redact(url)}`);
      break;
    case "reset":
      await resetDatabase(url);
      console.log(`Reset and migrated ${redact(url)}`);
      break;
    case "seed": {
      if (values.reset) await resetDatabase(url);
      else await migrateDatabase(url);
      const db = createDb(url, { max: 2 });
      try {
        const result = await seed(db);
        if (result.skipped) {
          console.log(`Already seeded (${result.branches} branches); use --reset to start over.`);
          break;
        }
        console.log(
          `Seeded ${redact(url)}: ${result.branches} branches, ${result.vehicles} vehicles, ${result.reservations} reservations.`,
        );
        if (result.accountsFile) console.log(`Test account credentials written to ${result.accountsFile}`);
      } finally {
        await db.$client.end();
      }
      break;
    }
    default:
      console.error("Usage: tsx scripts/db.ts <migrate|deploy|reset|seed> [--url <url>] [--reset]");
      process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
