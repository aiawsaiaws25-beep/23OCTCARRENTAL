import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";

// Liveness + DB check for deploy smoke tests. Exposes no configuration.
export async function GET() {
  await connection(); // always run at request time, never prerendered
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, db: "up" }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
