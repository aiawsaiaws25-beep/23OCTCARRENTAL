import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import type { PaymentProvider } from "@/lib/services/payments";
import { logger } from "./logger";
import { settleReservationMoney } from "./payments";

const log = logger.child({ module: "holds" });

export type ReleaseHoldsResult = {
  /** Reservations moved PENDING -> EXPIRED by this run. */
  expired: string[];
  /** Reservations whose deposits/refunds were settled by this run. */
  settled: string[];
  errors: { reservationId: string; error: string }[];
};

/**
 * Releases expired holds. Idempotent and safe to run concurrently (SKIP LOCKED):
 *  1. PENDING reservations whose hold_expires_at <= now become EXPIRED. The occupancy
 *     trigger deletes their vehicle_occupancy row, freeing the period.
 *  2. Settlement sweep: for EXPIRED / CANCELLED / REFUNDED reservations that still have a
 *     live deposit authorisation or money left to refund, release / refund via the provider.
 * Called by POST|GET /api/cron/release-holds (Vercel Cron) and `pnpm jobs:release-holds`.
 */
export async function releaseExpiredHolds(
  opts: { now?: Date; limit?: number; provider?: PaymentProvider } = {},
): Promise<ReleaseHoldsResult> {
  const now = opts.now ?? new Date();
  const limit = opts.limit ?? 500;

  const expiredRows = await db.execute(sql`
    update reservations set status = 'EXPIRED', expired_at = ${now.toISOString()}::timestamptz, updated_at = now()
    where id in (
      select id from reservations
      where status = 'PENDING' and hold_expires_at <= ${now.toISOString()}::timestamptz
      order by hold_expires_at
      limit ${limit}
      for update skip locked
    )
    returning id`);
  const expired = (expiredRows.rows as { id: string }[]).map((r) => r.id);

  const candidates = await db.execute(sql`
    select r.id from reservations r
    where r.status in ('EXPIRED', 'CANCELLED', 'REFUNDED')
      and (
        exists (select 1 from deposits d where d.reservation_id = r.id and d.status in ('PENDING', 'AUTHORIZED'))
        or (
          select coalesce(sum(p.amount_fils - p.refunded_fils), 0) from payments p
          where p.reservation_id = r.id and p.status in ('SUCCEEDED', 'PARTIALLY_REFUNDED')
        ) > case when r.status = 'EXPIRED' then 0 else coalesce(r.cancellation_fee_fils, 0) end
      )
    order by r.updated_at
    limit ${limit}`);

  const result: ReleaseHoldsResult = { expired, settled: [], errors: [] };
  for (const { id } of candidates.rows as { id: string }[]) {
    try {
      const s = await settleReservationMoney(id, { provider: opts.provider });
      if (s.errors.length) result.errors.push({ reservationId: id, error: s.errors.join("; ") });
      else result.settled.push(id);
    } catch (err) {
      result.errors.push({ reservationId: id, error: (err as Error).message });
    }
  }
  log.info("release-holds run", { expired: expired.length, settled: result.settled.length, errors: result.errors.length });
  return result;
}
