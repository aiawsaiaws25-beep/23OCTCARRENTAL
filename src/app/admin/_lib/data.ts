import "server-only";
import * as admin from "@/server/admin";
import { requireAdmin } from "@/server/session";

// Read helpers for admin pages: each resolves the admin actor on the server first
// (redirect/404 for non-admins), then calls db-engine's admin service.

export type { AdminReservationRow } from "@/server/admin";

export async function adminActor(path = "/admin") {
  const user = await requireAdmin(path);
  return { id: user.id, role: user.role };
}

export async function adminListReservations(filters: Parameters<typeof admin.adminListReservations>[1]) {
  return admin.adminListReservations(await adminActor("/admin/reservations"), filters);
}

export async function adminListDamageCount(status: string) {
  const rows = await admin.listDamageReports(await adminActor("/admin/damage"), { status });
  return rows.length;
}
