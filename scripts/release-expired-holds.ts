// `pnpm jobs:release-holds` — the local equivalent of the Vercel Cron call to
// /api/cron/release-holds. Runs with --conditions=react-server so server-only modules load.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const { releaseExpiredHolds } = await import("@/server/holds");
  const { db } = await import("@/db");
  try {
    const result = await releaseExpiredHolds();
    console.log(
      `Expired ${result.expired.length} hold(s); settled ${result.settled.length} reservation(s); ${result.errors.length} error(s).`,
    );
    for (const e of result.errors) console.error(`Failed ${e.reservationId}: ${e.error}`);
    process.exitCode = result.errors.length ? 1 : 0;
  } finally {
    await db.$client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
