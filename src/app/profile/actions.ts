"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { updateProfile } from "@/server/account";
import { requireUser } from "@/server/session";

export async function updateProfileAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser("/profile");
  const name = String(formData.get("name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const result = await updateProfile(user.id, { name, phone: phone || null });
  if (!result.ok) return { ok: false, message: result.message };
  refresh();
  return { ok: true, message: "Profile updated." };
}
