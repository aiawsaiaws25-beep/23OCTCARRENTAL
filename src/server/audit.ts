import type { DbOrTx } from "@/db/client";
import { auditLogs } from "@/db/schema";

export type AuditEntry = {
  actorUserId: string | null;
  action: string; // e.g. "reservation.cancel"
  entityType: string;
  entityId?: string | null;
  data?: Record<string, unknown>;
};

/** Appends an audit row. Call inside the same transaction as the change it records. */
export async function audit(db: DbOrTx, entry: AuditEntry): Promise<void> {
  await db.insert(auditLogs).values({
    actorUserId: entry.actorUserId,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    data: entry.data ?? null,
  });
}
