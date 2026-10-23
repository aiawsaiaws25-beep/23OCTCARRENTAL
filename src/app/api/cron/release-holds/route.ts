import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { releaseExpiredHolds } from "@/server/holds";
import { logger } from "@/server/logger";

const log = logger.child({ route: "cron/release-holds" });

// Vercel Cron sends GET with `Authorization: Bearer ${CRON_SECRET}`; POST is accepted for
// other schedulers and manual runs. The job is idempotent, so repeated calls are harmless.
function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${getEnv().CRON_SECRET}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function run(request: Request) {
  if (!authorized(request)) {
    log.warn("unauthorized cron call");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await releaseExpiredHolds();
    return Response.json({
      ok: result.errors.length === 0,
      expired: result.expired.length,
      settled: result.settled.length,
      errors: result.errors,
      expiredIds: result.expired,
    });
  } catch (err) {
    log.error("release-holds failed", { err });
    return Response.json({ ok: false, error: "failed" }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
