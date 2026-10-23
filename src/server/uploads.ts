import "server-only";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { damageReports, driverProfiles, reservations } from "@/db/schema";
import { getStorage } from "@/lib/services/storage";
import { DomainError, toResult, type Result } from "./errors";
import { logger } from "./logger";
import { ALLOWED_DAMAGE_IMAGE_TYPES, ALLOWED_LICENCE_TYPES, MAX_UPLOAD_BYTES } from "./policy";

const log = logger.child({ module: "uploads" });

export type UploadFile = { data: Buffer | Uint8Array; contentType: string; filename?: string };

const EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Checks declared type, size and the file's magic bytes (a renamed .exe is rejected). */
export function validateUpload(file: UploadFile, allowed: readonly string[]): void {
  if (!allowed.includes(file.contentType)) {
    throw new DomainError("validation", `Unsupported file type. Allowed: ${allowed.map((t) => EXT[t]).join(", ")}.`);
  }
  if (file.data.byteLength === 0) throw new DomainError("validation", "The file is empty.");
  if (file.data.byteLength > MAX_UPLOAD_BYTES) {
    throw new DomainError("validation", `The file is too large (max ${MAX_UPLOAD_BYTES / 1024 / 1024} MB).`);
  }
  const b = Buffer.from(file.data.buffer, file.data.byteOffset, Math.min(file.data.byteLength, 16));
  const ok =
    (file.contentType === "image/jpeg" && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    (file.contentType === "image/png" && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) ||
    (file.contentType === "image/webp" && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") ||
    (file.contentType === "application/pdf" && b.subarray(0, 5).toString("latin1") === "%PDF-");
  if (!ok) throw new DomainError("validation", "The file content does not match its type.");
}

/**
 * Stores the user's driving licence privately and links it to their driver profile
 * (call saveDriverDetails first). Replaces any previous licence file.
 * Limits: 5 MB; JPEG, PNG, WebP or PDF.
 */
export async function uploadLicence(userId: string, file: UploadFile): Promise<Result<{ key: string }>> {
  return toResult(async () => {
    validateUpload(file, ALLOWED_LICENCE_TYPES);
    const [profile] = await db.select().from(driverProfiles).where(eq(driverProfiles.userId, userId));
    if (!profile) throw new DomainError("validation", "Please save the driver's details before uploading the licence.");
    const key = `licences/${userId}/${randomUUID()}.${EXT[file.contentType]}`;
    const storage = getStorage();
    await storage.put(key, file.data, file.contentType);
    await db
      .update(driverProfiles)
      .set({ licenceFileKey: key, licenceFileContentType: file.contentType, licenceUploadedAt: new Date(), verifiedAt: null })
      .where(eq(driverProfiles.userId, userId));
    if (profile.licenceFileKey && profile.licenceFileKey !== key) {
      await storage.delete(profile.licenceFileKey).catch((err) => log.warn("old licence delete failed", { err }));
    }
    log.info("licence uploaded", { userId, key });
    return { key };
  }, "uploadLicence");
}

/** Stores a damage photo; returns its private key (attach it to a damage report). Admin services call this. */
export async function storeDamageImage(reportId: string, file: UploadFile): Promise<string> {
  validateUpload(file, ALLOWED_DAMAGE_IMAGE_TYPES);
  const key = `damage/${reportId}/${randomUUID()}.${EXT[file.contentType]}`;
  await getStorage().put(key, file.data, file.contentType);
  return key;
}

/**
 * Returns a private file if `user` may see it, else null (the route answers 404 either way):
 *  - licences/<userId>/...: the owner or an admin, and only the profile's current licence file
 *  - damage/<reportId>/...: admins, or the customer whose reservation the report belongs to
 */
export async function getAuthorizedFile(
  user: { id: string; role: "CUSTOMER" | "ADMIN" } | null,
  key: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  if (!user || key.includes("..") || key.includes("\\")) return null;
  const [kind, ownerId] = key.split("/");
  const isAdmin = user.role === "ADMIN";
  if (kind === "licences") {
    if (!isAdmin && ownerId !== user.id) return null;
    const [p] = await db.select({ key: driverProfiles.licenceFileKey }).from(driverProfiles).where(eq(driverProfiles.licenceFileKey, key));
    if (!p) return null;
  } else if (kind === "damage") {
    const [report] = await db
      .select({ userId: reservations.userId })
      .from(damageReports)
      .leftJoin(reservations, eq(reservations.id, damageReports.reservationId))
      .where(sql`${damageReports.imageKeys} ? ${key}`);
    if (!report) return null;
    if (!isAdmin && report.userId !== user.id) return null;
  } else {
    return null;
  }
  return getStorage().get(key);
}
