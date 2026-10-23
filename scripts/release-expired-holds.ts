import { releaseExpiredHolds } from "@/lib/jobs/release-expired-holds";
import { getPaymentProvider } from "@/lib/services/payments";

async function main() {
  const result = await releaseExpiredHolds(getPaymentProvider());
  console.log(`Released ${result.released.length} expired hold(s).`);
  for (const f of result.failed) console.error(`Failed to release ${f.id}: ${f.error}`);
  process.exitCode = result.failed.length ? 1 : 0;
}

main();
