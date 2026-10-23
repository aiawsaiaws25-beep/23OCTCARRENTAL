"use server";

import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { zonedToUtc } from "@/components/search-params";
import { createPricingRule, deletePricingRule, updateCategory, updateExtra, updatePricingRule } from "@/server/admin";
import { requireAdmin } from "@/server/session";
import { bool, filsField, int, optFilsField, optText, text, toState } from "../_lib/form";

async function actor() {
  const u = await requireAdmin("/admin/pricing");
  return { id: u.id, role: u.role };
}

const badMoney = { ok: false, message: "Enter amounts in AED, e.g. 149 or 149.50." } satisfies ActionState;

export async function updateCategoryAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const dailyRateFils = filsField(fd, "rateAed");
  const depositFils = filsField(fd, "depositAed");
  if (Number.isNaN(dailyRateFils) || Number.isNaN(depositFils)) return badMoney;
  const result = await updateCategory(a, id, { name: text(fd, "name"), description: optText(fd, "description"), dailyRateFils, depositFils });
  refresh();
  return toState(result, "Category saved.");
}

export async function updateExtraAction(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const priceFils = filsField(fd, "priceAed");
  const maxPriceFils = optFilsField(fd, "maxPriceAed");
  if (Number.isNaN(priceFils) || Number.isNaN(maxPriceFils)) return badMoney;
  const pricing = text(fd, "pricing") === "PER_RENTAL" ? "PER_RENTAL" : "PER_DAY";
  const result = await updateExtra(a, id, {
    name: text(fd, "name"),
    pricing,
    priceFils,
    maxPriceFils,
    maxQuantity: int(fd, "maxQuantity"),
    active: bool(fd, "active"),
  });
  refresh();
  return toState(result, "Extra saved.");
}

/** Percent input (e.g. "-10" or "12.5") to basis points. */
function percentToBp(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : Number.NaN;
}

export async function createRuleAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const a = await actor();
  const type = text(fd, "type");
  const name = text(fd, "name");
  const categoryId = optText(fd, "categoryId");
  if (type === "SEASONAL") {
    const adjustmentBp = percentToBp(text(fd, "adjustmentPct"));
    const from = text(fd, "validFrom");
    const to = text(fd, "validTo");
    if (adjustmentBp === null || Number.isNaN(adjustmentBp)) return { ok: false, message: "Enter the adjustment in percent, e.g. 20 or -10." };
    if (!from || !to) return { ok: false, message: "Enter the season's start and end dates." };
    const result = await createPricingRule(a, {
      type,
      name,
      categoryId,
      validFrom: zonedToUtc(from, "00:00"),
      validTo: zonedToUtc(to, "00:00"),
      adjustmentBp,
    });
    refresh();
    return toState(result, "Seasonal rule created.");
  }
  if (type === "DURATION_DISCOUNT") {
    const adjustmentBp = percentToBp(text(fd, "adjustmentPct"));
    if (adjustmentBp === null || Number.isNaN(adjustmentBp) || adjustmentBp >= 0)
      return { ok: false, message: "A duration discount needs a negative percent, e.g. -10." };
    const result = await createPricingRule(a, { type, name, categoryId, minDays: int(fd, "minDays"), adjustmentBp });
    refresh();
    return toState(result, "Discount rule created.");
  }
  if (type === "ONE_WAY_FEE") {
    const feeFils = filsField(fd, "feeAed");
    if (Number.isNaN(feeFils)) return badMoney;
    const result = await createPricingRule(a, {
      type,
      name,
      categoryId,
      pickupBranchId: optText(fd, "pickupBranchId"),
      returnBranchId: optText(fd, "returnBranchId"),
      feeFils,
    });
    refresh();
    return toState(result, "One-way fee created.");
  }
  return { ok: false, message: "Choose a rule type." };
}

export async function toggleRuleAction(id: string, active: boolean): Promise<void> {
  const a = await actor();
  await updatePricingRule(a, id, { active });
  refresh();
}

export async function deleteRuleAction(id: string): Promise<void> {
  const a = await actor();
  await deletePricingRule(a, id);
  refresh();
}
