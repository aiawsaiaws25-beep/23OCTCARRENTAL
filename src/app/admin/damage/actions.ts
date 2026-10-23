"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { createDamageReport, updateDamageReport } from "@/server/admin";
import { requireAdmin } from "@/server/session";
import { files, optFilsField, optText, text, toState } from "../_lib/form";

const STAGES = ["PICKUP", "RETURN", "OTHER"] as const;
const SEVERITIES = ["MINOR", "MODERATE", "MAJOR"] as const;
const STATUSES = ["OPEN", "CHARGED", "RESOLVED"] as const;

export async function createDamageAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireAdmin("/admin/damage");
  const stage = STAGES.find((s) => s === text(fd, "stage")) ?? "OTHER";
  const severity = SEVERITIES.find((s) => s === text(fd, "severity"));
  if (!severity) return { ok: false, message: "Choose a severity." };
  const charged = optFilsField(fd, "chargedAed");
  const estimate = optFilsField(fd, "estimatedAed");
  if (Number.isNaN(charged) || Number.isNaN(estimate)) return { ok: false, message: "Enter amounts in AED, e.g. 250 or 99.50." };
  const result = await createDamageReport(
    { id: u.id, role: u.role },
    {
      vehicleId: text(fd, "vehicleId"),
      reservationId: optText(fd, "reservationId"),
      stage,
      severity,
      description: text(fd, "description"),
      estimatedCostFils: estimate,
      chargedFils: charged ?? 0,
      photos: await files(fd, "photos"),
    },
  );
  refresh();
  return toState(result, "Damage report saved.");
}

export async function updateDamageAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireAdmin("/admin/damage");
  const status = STATUSES.find((s) => s === text(fd, "status"));
  const charged = optFilsField(fd, "chargedAed");
  if (Number.isNaN(charged)) return { ok: false, message: "Enter the charge in AED, e.g. 250 or 99.50." };
  const result = await updateDamageReport(
    { id: u.id, role: u.role },
    id,
    { status, chargedFils: charged ?? undefined, photos: await files(fd, "photos") },
  );
  refresh();
  return toState(result, "Damage report updated.");
}
