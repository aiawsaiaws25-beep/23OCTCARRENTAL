"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import type { PayState } from "@/components/pay-form";
import { payReservation } from "@/server/payments";
import { abandonCheckout, saveDriverDetails } from "@/server/reservations";
import { requireUser } from "@/server/session";
import { uploadLicence } from "./licence";

const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};

export async function saveDriverAction(reservationId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser(`/checkout/${reservationId}`);
  const result = await saveDriverDetails(user.id, reservationId, {
    fullName: str(formData, "fullName"),
    email: str(formData, "email"),
    phone: str(formData, "phone"),
    dateOfBirth: str(formData, "dateOfBirth"),
    nationality: str(formData, "nationality") || undefined,
    licenceNumber: str(formData, "licenceNumber"),
    licenceCountry: str(formData, "licenceCountry"),
    licenceExpiry: str(formData, "licenceExpiry"),
  });
  if (!result.ok) return { ok: false, message: result.message };

  const file = formData.get("licence");
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadLicence(user.id, reservationId, file);
    if (!uploaded.ok) {
      refresh();
      return { ok: false, message: `Your details were saved, but the licence upload failed: ${uploaded.message}` };
    }
  }
  refresh();
  return { ok: true, message: "Driver details saved." };
}

export async function payAction(reservationId: string, _prev: PayState, formData: FormData): Promise<PayState> {
  const user = await requireUser(`/checkout/${reservationId}`);
  const paymentMethod = str(formData, "paymentMethod") || undefined;
  const idempotencyKey = str(formData, "idempotencyKey");
  const result = await payReservation(user.id, reservationId, { paymentMethod, idempotencyKey });
  if (!result.ok) {
    refresh();
    return { status: "error", message: result.message };
  }
  if (result.status === "confirmed") redirect(`/my-rentals/${reservationId}/voucher?paid=1`);
  refresh();
  if (result.status === "expired") return { status: "expired", message: "Your hold expired before payment completed. Nothing was charged." };
  return {
    status: "failed",
    message:
      result.stage === "deposit"
        ? `The security deposit hold was declined: ${result.reason}`
        : `The payment was declined: ${result.reason}`,
  };
}

export async function abandonCheckoutAction(reservationId: string): Promise<void> {
  const user = await requireUser(`/checkout/${reservationId}`);
  await abandonCheckout(user.id, reservationId);
  redirect(`/checkout/${reservationId}?cancelled=1`);
}
