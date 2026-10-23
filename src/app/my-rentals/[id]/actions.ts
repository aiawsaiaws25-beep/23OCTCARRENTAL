"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { QuoteView } from "@/components/price-breakdown";
import { zonedToUtc } from "@/components/search-params";
import { cancelReservation, getReservationForUser, modifyReservationDates, quoteDateChange } from "@/server/reservations";
import { requireUser } from "@/server/session";

const changeSchema = z.object({
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  pickupTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  returnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  returnTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
});

export type ChangeDatesInput = z.infer<typeof changeSchema>;

export type ChangeQuoteResult =
  | { ok: true; available: boolean; quote: QuoteView; differenceFils: number; message?: string }
  | { ok: false; message: string };

async function resolve(userId: string, id: string, input: ChangeDatesInput) {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) return null;
  const r = await getReservationForUser(userId, id);
  if (!r) return null;
  return {
    pickupAt: zonedToUtc(parsed.data.pickupDate, parsed.data.pickupTime, r.pickupBranch.timeZone),
    returnAt: zonedToUtc(parsed.data.returnDate, parsed.data.returnTime, r.returnBranch.timeZone),
  };
}

export async function quoteChangeAction(id: string, input: ChangeDatesInput): Promise<ChangeQuoteResult> {
  const user = await requireUser(`/my-rentals/${id}`);
  const dates = await resolve(user.id, id, input);
  if (!dates) return { ok: false, message: "Please enter valid dates and times." };
  const result = await quoteDateChange(user.id, id, dates);
  if (!result.ok) return { ok: false, message: result.message };
  return {
    ok: true,
    available: result.available,
    quote: result.newQuote,
    differenceFils: result.differenceFils,
    message: result.message,
  };
}

export type ChangeResult = { ok: boolean; message: string };

export async function confirmChangeAction(
  id: string,
  input: ChangeDatesInput & { paymentMethod?: string; idempotencyKey: string },
): Promise<ChangeResult> {
  const user = await requireUser(`/my-rentals/${id}`);
  const dates = await resolve(user.id, id, input);
  if (!dates) return { ok: false, message: "Please enter valid dates and times." };
  const result = await modifyReservationDates(user.id, id, {
    ...dates,
    paymentMethod: input.paymentMethod,
    idempotencyKey: input.idempotencyKey,
  });
  refresh();
  if (!result.ok) return { ok: false, message: result.message };
  const { differenceFils, chargedFils, refundedFils } = result;
  const fmt = (f: number) => new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(f / 100);
  const money =
    chargedFils > 0
      ? ` We charged the difference of ${fmt(chargedFils)}.`
      : refundedFils > 0
        ? ` We refunded ${fmt(refundedFils)}.`
        : differenceFils < 0
          ? " The new price is lower; no refund applies under the change policy."
          : "";
  return { ok: true, message: `Your dates have been changed.${money}` };
}

export type CancelState = { ok?: boolean; message?: string };

export async function cancelAction(id: string, _prev?: CancelState, _formData?: FormData): Promise<CancelState> {
  void _prev;
  void _formData;
  const user = await requireUser(`/my-rentals/${id}`);
  const result = await cancelReservation(user.id, id);
  refresh();
  if (!result.ok) return { ok: false, message: result.message };
  const fmt = new Intl.NumberFormat("en-AE", { style: "currency", currency: "AED" }).format(result.refundFils / 100);
  return { ok: true, message: `Booking cancelled. ${result.refundFils > 0 ? `${fmt} will be refunded to your card.` : "No payment was refunded."} Your deposit hold has been released.` };
}
