"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { zonedToUtc } from "@/components/search-params";
import { cancelMaintenanceBlock, createMaintenanceBlock, createVehicle, updateVehicle, type VehicleInput } from "@/server/admin";
import { getVehicle } from "@/server/catalog";
import { requireAdmin } from "@/server/session";
import { int, optFilsField, optText, text, toState } from "../_lib/form";

async function actor() {
  const u = await requireAdmin("/admin/fleet");
  return { id: u.id, role: u.role };
}

function readVehicle(fd: FormData): VehicleInput | string {
  const rate = optFilsField(fd, "rateAed");
  if (Number.isNaN(rate)) return "Enter the daily rate in AED, e.g. 149 or 149.50, or leave it empty to use the category rate.";
  const transmission = text(fd, "transmission");
  const fuelType = text(fd, "fuelType");
  const status = text(fd, "status");
  const images = text(fd, "images")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    branchId: text(fd, "branchId"),
    categoryId: text(fd, "categoryId"),
    slug: text(fd, "slug"),
    make: text(fd, "make"),
    model: text(fd, "model"),
    year: int(fd, "year"),
    plateNumber: text(fd, "plateNumber"),
    vin: text(fd, "vin"),
    color: optText(fd, "color"),
    transmission: transmission as VehicleInput["transmission"],
    fuelType: fuelType as VehicleInput["fuelType"],
    seats: int(fd, "seats"),
    doors: int(fd, "doors"),
    luggage: int(fd, "luggage"),
    dailyRateFils: rate,
    mileageKm: int(fd, "mileageKm"),
    status: status as VehicleInput["status"],
    images,
    featureIds: fd.getAll("featureIds").map(String),
  };
}

export async function createVehicleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const input = readVehicle(fd);
  if (typeof input === "string") return { ok: false, message: input };
  const result = await createVehicle(a, input);
  if (!result.ok) return { ok: false, message: result.message };
  redirect(`/admin/fleet/${result.id}?created=1`);
}

export async function updateVehicleAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const input = readVehicle(fd);
  if (typeof input === "string") return { ok: false, message: input };
  const result = await updateVehicle(a, id, input);
  refresh();
  return toState(result, "Vehicle saved.");
}

export async function createMaintenanceAction(vehicleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const v = await getVehicle(vehicleId);
  if (!v) return { ok: false, message: "Vehicle not found." };
  const tz = v.branch.timeZone;
  const sd = text(fd, "startDate");
  const st = text(fd, "startTime");
  const ed = text(fd, "endDate");
  const et = text(fd, "endTime");
  if (!sd || !st || !ed || !et) return { ok: false, message: "Enter the start and end date and time." };
  const result = await createMaintenanceBlock(a, {
    vehicleId,
    startAt: zonedToUtc(sd, st, tz),
    endAt: zonedToUtc(ed, et, tz),
    reason: text(fd, "reason"),
  });
  refresh();
  return toState(result, "Maintenance scheduled. The car is unavailable for that period.");
}

export async function cancelMaintenanceAction(blockId: string): Promise<void> {
  const a = await actor();
  await cancelMaintenanceBlock(a, blockId);
  refresh();
}
