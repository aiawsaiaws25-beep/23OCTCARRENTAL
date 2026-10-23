"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { formatAED } from "@/components/format";
import { zonedToUtc } from "@/components/search-params";
import { adminCancelReservation, checkIn, checkOut } from "@/server/admin";
import { getBranch } from "@/server/catalog";
import { requireAdmin } from "@/server/session";
import { int, optFilsField, optText, text } from "../../_lib/form";

async function actor(id: string) {
  const u = await requireAdmin(`/admin/reservations/${id}`);
  return { id: u.id, role: u.role };
}

export async function checkOutAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor(id);
  const result = await checkOut(a, id, {
    mileageKm: int(fd, "mileageKm"),
    fuelEighths: int(fd, "fuelEighths"),
    notes: optText(fd, "notes") ?? undefined,
  });
  refresh();
  return result.ok
    ? { ok: true, message: `Car handed over. Rental agreement ${result.agreementNumber} created.` }
    : { ok: false, message: result.message };
}

export async function checkInAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor(id);
  const returnBranchId = text(fd, "returnBranchId");
  const branch = returnBranchId ? await getBranch(returnBranchId) : null;
  const date = text(fd, "returnedDate");
  const time = text(fd, "returnedTime");
  const returnedAt =
    /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? zonedToUtc(date, time, branch?.timeZone) : undefined;
  if (!returnedAt) return { ok: false, message: "Enter the return date and time." };
  const result = await checkIn(a, id, {
    mileageKm: int(fd, "mileageKm"),
    fuelEighths: int(fd, "fuelEighths"),
    returnedAt,
    returnBranchId: returnBranchId || undefined,
    notes: optText(fd, "notes") ?? undefined,
  });
  refresh();
  if (!result.ok) return { ok: false, message: result.message };
  const parts = [
    result.lateFeeFils ? `late return ${result.lateMinutes} min: ${formatAED(result.lateFeeFils)}` : null,
    result.fuelChargeFils ? `refuelling ${formatAED(result.fuelChargeFils)}` : null,
    result.damageChargeFils ? `damage ${formatAED(result.damageChargeFils)}` : null,
    result.vatFils ? `VAT ${formatAED(result.vatFils)}` : null,
  ].filter(Boolean);
  const charges = parts.length
    ? `Charges: ${parts.join(", ")}. Total ${formatAED(result.totalChargesFils)}; ${formatAED(result.depositCapturedFils)} taken from the deposit${result.outstandingFils ? `, ${formatAED(result.outstandingFils)} outstanding` : ""}.`
    : "No extra charges. The deposit hold has been released.";
  return {
    ok: !result.settlementError,
    message: `Car checked in. ${charges}${result.settlementError ? ` Deposit settlement failed: ${result.settlementError}` : ""}`,
  };
}

export async function adminCancelAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor(id);
  const fee = optFilsField(fd, "feeAed");
  if (fee !== null && Number.isNaN(fee)) return { ok: false, message: "Enter the fee in AED, e.g. 100 or 99.50." };
  const result = await adminCancelReservation(a, id, {
    feeFils: fee ?? undefined,
    reason: optText(fd, "reason") ?? undefined,
  });
  refresh();
  return result.ok
    ? { ok: true, message: `Reservation cancelled. Refunded ${formatAED(result.refundFils)} (fee ${formatAED(result.feeFils)}).` }
    : { ok: false, message: result.message };
}
