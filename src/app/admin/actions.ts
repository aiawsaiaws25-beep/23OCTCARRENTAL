"use server";

import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { findReservationIdByCode } from "@/server/account";
import { requireAdmin } from "@/server/session";

/** Desk lookup: a scanned voucher QR payload or a typed reference. */
export async function lookupReservationAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  await requireAdmin("/admin");
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return { ok: false, message: "Enter a reference or scan a voucher." };
  const id = await findReservationIdByCode(code);
  if (!id) return { ok: false, message: "No reservation matches that code. Check the reference and try again." };
  redirect(`/admin/reservations/${id}`);
}
