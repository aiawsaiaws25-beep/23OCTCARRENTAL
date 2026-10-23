import type { PaymentProvider } from "@/lib/services/payments";

export type ReleaseResult = { released: string[]; failed: { id: string; error: string }[] };

// Releases every deposit hold whose expiry has passed. Safe to run repeatedly.
// Locally: `pnpm jobs:release-holds`. In the cloud, a scheduler calls the same
// function (e.g. a cron hitting an API route protected by CRON_SECRET).
export async function releaseExpiredHolds(payments: PaymentProvider, now = new Date()): Promise<ReleaseResult> {
  const expired = await payments.listHolds({ status: "held", expiresBefore: now });
  const result: ReleaseResult = { released: [], failed: [] };
  for (const hold of expired) {
    try {
      await payments.releaseDeposit(hold.id);
      result.released.push(hold.id);
    } catch (err) {
      result.failed.push({ id: hold.id, error: (err as Error).message });
    }
  }
  return result;
}
