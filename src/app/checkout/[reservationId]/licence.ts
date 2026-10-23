import "server-only";
import { uploadLicence as storeLicence } from "@/server/uploads";

/** Stores the licence on the user's driver profile (private storage, never /public). */
export async function uploadLicence(
  userId: string,
  _reservationId: string,
  file: File,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const data = Buffer.from(await file.arrayBuffer());
  const result = await storeLicence(userId, { data, contentType: file.type, filename: file.name });
  return result.ok ? { ok: true } : { ok: false, message: result.message };
}
