"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { createBranch, updateBranch, type BranchInput } from "@/server/admin";
import { requireAdmin } from "@/server/session";
import { bool, optText, text, toState } from "../_lib/form";

function readBranch(fd: FormData): BranchInput {
  const lat = text(fd, "latitude");
  const lng = text(fd, "longitude");
  return {
    code: text(fd, "code"),
    name: text(fd, "name"),
    city: text(fd, "city"),
    emirate: text(fd, "emirate"),
    address: text(fd, "address"),
    phone: text(fd, "phone"),
    email: optText(fd, "email"),
    timeZone: text(fd, "timeZone") || "Asia/Dubai",
    openingHours: text(fd, "openingHours"),
    isAirport: bool(fd, "isAirport"),
    latitude: lat === "" ? null : Number(lat),
    longitude: lng === "" ? null : Number(lng),
    imageUrl: optText(fd, "imageUrl"),
    active: bool(fd, "active"),
  };
}

export async function createBranchAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireAdmin("/admin/branches");
  const result = await createBranch({ id: u.id, role: u.role }, readBranch(fd));
  if (!result.ok) return { ok: false, message: result.message };
  redirect(`/admin/branches/${result.id}?created=1`);
}

export async function updateBranchAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireAdmin("/admin/branches");
  const result = await updateBranch({ id: u.id, role: u.role }, id, readBranch(fd));
  refresh();
  return toState(result, "Branch saved.");
}
