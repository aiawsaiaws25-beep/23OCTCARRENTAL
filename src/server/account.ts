import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { driverProfiles, reservations, users } from "@/db/schema";
import { getEnv } from "@/lib/env";
import { DomainError, toResult, type Result } from "./errors";
import { getReservationForUser, type ReservationDetail } from "./reservations";

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export type Profile = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: "CUSTOMER" | "ADMIN";
  driver: {
    fullName: string;
    email: string | null;
    phone: string;
    dateOfBirth: string;
    nationality: string | null;
    licenceNumber: string;
    licenceCountry: string;
    licenceExpiry: string;
    hasLicence: boolean;
  } | null;
};

export async function getProfile(userId: string): Promise<Profile | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) return null;
  const [p] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    driver: p
      ? {
          fullName: p.fullName,
          email: p.email,
          phone: p.phone,
          dateOfBirth: p.dateOfBirth,
          nationality: p.nationality,
          licenceNumber: p.licenceNumber,
          licenceCountry: p.licenceCountry,
          licenceExpiry: p.licenceExpiresOn,
          hasLicence: Boolean(p.licenceFileKey),
        }
      : null,
  };
}

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  phone: z.string().trim().min(6).max(30).nullable().optional(),
});

/** Updates name/phone. Email and role are not editable here. */
export async function updateProfile(userId: string, input: z.input<typeof profileSchema>): Promise<Result<{ profile: Profile }>> {
  return toResult(async () => {
    const parsed = profileSchema.safeParse(input);
    if (!parsed.success) throw new DomainError("validation", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    const set: Partial<typeof users.$inferInsert> = {};
    if (parsed.data.name !== undefined) set.name = parsed.data.name;
    if (parsed.data.phone !== undefined) set.phone = parsed.data.phone;
    if (Object.keys(set).length) await db.update(users).set(set).where(eq(users.id, userId));
    const profile = await getProfile(userId);
    if (!profile) throw new DomainError("not_found", "User not found.");
    return { profile };
  }, "updateProfile");
}

// ---------------------------------------------------------------------------
// Voucher
// ---------------------------------------------------------------------------

const voucherSecret = () => getEnv().VOUCHER_SECRET ?? getEnv().BETTER_AUTH_SECRET;
const sign = (reference: string) => createHmac("sha256", voucherSecret()).update(`voucher:${reference}`).digest("hex").slice(0, 20);

/** QR payload for a voucher: "DRIVEEASY:<reference>:<hmac>". Staff scan it at the desk. */
export function voucherCode(reference: string): string {
  return `DRIVEEASY:${reference}:${sign(reference)}`;
}

/** Returns the reference if the scanned code is genuine, else null. */
export function verifyVoucherCode(code: string): string | null {
  const m = /^DRIVEEASY:(DE-[A-Z0-9]{6}):([0-9a-f]{20})$/.exec(code.trim());
  if (!m) return null;
  const expected = Buffer.from(sign(m[1]));
  const given = Buffer.from(m[2]);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m[1] : null;
}

export type Voucher = ReservationDetail & { qrPayload: string };

/** Voucher data for a CONFIRMED / PICKED_UP reservation owned by the user, else null. */
export async function getVoucher(userId: string, reservationId: string): Promise<Voucher | null> {
  const r = await getReservationForUser(userId, reservationId);
  if (!r || !["CONFIRMED", "PICKED_UP"].includes(r.status)) return null;
  return { ...r, qrPayload: voucherCode(r.reference) };
}

/** Admin desk: resolve a scanned voucher code (or a typed reference) to a reservation id. */
export async function findReservationIdByCode(codeOrReference: string): Promise<string | null> {
  const ref = codeOrReference.startsWith("DRIVEEASY:") ? verifyVoucherCode(codeOrReference) : codeOrReference.trim().toUpperCase();
  if (!ref) return null;
  const [r] = await db.select({ id: reservations.id }).from(reservations).where(eq(reservations.reference, ref));
  return r?.id ?? null;
}
