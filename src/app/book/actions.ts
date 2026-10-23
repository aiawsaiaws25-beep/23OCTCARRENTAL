"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import type { QuoteView } from "@/components/price-breakdown";
import type { TripParams } from "@/components/search-params";
import { getQuote, isUuid } from "@/server/catalog";
import { createReservationHold } from "@/server/reservations";
import { getCurrentUser } from "@/server/session";
import { resolveTrip } from "./trip";

const extrasSchema = z
  .array(z.object({ extraId: z.string().refine(isUuid), quantity: z.number().int().min(0).max(10) }))
  .max(20);

export type PreviewResult = { ok: true; quote: QuoteView } | { ok: false; message: string };

/** Re-prices the trip with the selected extras. Prices are always computed on the server. */
export async function previewQuoteAction(input: {
  vehicleId: string;
  trip: TripParams;
  extras: { extraId: string; quantity: number }[];
}): Promise<PreviewResult> {
  if (typeof input?.vehicleId !== "string" || !isUuid(input.vehicleId)) return { ok: false, message: "Unknown vehicle." };
  const extras = extrasSchema.safeParse(input.extras);
  if (!extras.success) return { ok: false, message: "Invalid extras selection." };
  const resolved = await resolveTrip(input.trip);
  if (!resolved) return { ok: false, message: "Please choose valid branches, dates and times." };
  const result = await getQuote({ vehicleId: input.vehicleId, ...resolved, extras: extras.data });
  if (!result.ok) return { ok: false, message: result.message };
  return { ok: true, quote: result.quote };
}

export type StartBookingState = { message?: string; code?: string };

/** Creates the temporary hold (PENDING reservation) and moves on to checkout. */
export async function startBookingAction(_prev: StartBookingState, formData: FormData): Promise<StartBookingState> {
  const vehicleId = String(formData.get("vehicleId") ?? "");
  const trip = {
    pickupBranch: String(formData.get("pickupBranch") ?? ""),
    returnBranch: String(formData.get("returnBranch") ?? ""),
    pickupDate: String(formData.get("pickupDate") ?? ""),
    pickupTime: String(formData.get("pickupTime") ?? ""),
    returnDate: String(formData.get("returnDate") ?? ""),
    returnTime: String(formData.get("returnTime") ?? ""),
  };
  const extraValues = formData.getAll("extra").map(String);
  const extraQuery = extraValues.map((e) => `&extra=${encodeURIComponent(e)}`).join("");
  const backTo = `/book/${vehicleId}/extras?${new URLSearchParams(trip)}${extraQuery}`;

  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(backTo)}`);

  if (!isUuid(vehicleId)) return { message: "Unknown vehicle." };
  const extras = extrasSchema.safeParse(
    extraValues.map((v) => {
      const [extraId, q] = v.split(":");
      return { extraId, quantity: Number(q) };
    }),
  );
  if (!extras.success) return { message: "Invalid extras selection." };
  const resolved = await resolveTrip(trip);
  if (!resolved) return { message: "Please choose valid branches, dates and times." };

  const result = await createReservationHold({
    userId: user.id,
    vehicleId,
    ...resolved,
    extras: extras.data,
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
  });
  if (!result.ok) return { message: result.message, code: result.code };
  redirect(`/checkout/${result.reservationId}`);
}
