// Booking-flow helpers for e2e specs: per-test vehicles in driveeasy_e2e and UI steps.
import type { Page } from "@playwright/test";
import * as factory from "../tests/helpers/factory";
import { expect, e2eDb } from "./fixtures";

// The factory creates its pool lazily, so this must be set before the first factory call.
process.env.QA_FACTORY_DATABASE_URL ??= process.env.QA_E2E_DATABASE_URL;

export const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

/** A fresh branch + category + vehicle that no other test touches. */
export async function freshVehicle(opts: { dailyRateFils?: number; depositFils?: number } = {}) {
  const branch = await factory.createBranch();
  const cat = await factory.createCategory({ dailyRateFils: opts.dailyRateFils ?? 15_000, depositFils: opts.depositFils ?? 100_000 });
  const v = await factory.createVehicle({ branchId: branch.id, categoryId: cat.id });
  return { vehicleId: v.id, branchId: branch.id, branchCode: branch.code };
}

/** YYYY-MM-DD in Asia/Dubai, `daysAhead` from today. Keep < 45 to stay clear of the seeded festive season. */
export function dubaiDate(daysAhead: number) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + daysAhead * 86_400_000));
}

export type Trip = { pickupBranch: string; returnBranch: string; pickupDate: string; pickupTime: string; returnDate: string; returnTime: string };

export function trip(branchCode: string, fromDays: number, toDays: number, pickupTime = "10:00", returnTime = "10:00", returnBranch = branchCode): Trip {
  return { pickupBranch: branchCode, returnBranch, pickupDate: dubaiDate(fromDays), pickupTime, returnDate: dubaiDate(toDays), returnTime };
}

export const q = (t: Trip) => new URLSearchParams(t).toString();

/** Extras page → "Continue to driver details". Returns the reservation id from /checkout/<id>. */
export async function startBooking(page: Page, vehicleId: string, t: Trip, extras: string[] = []) {
  await page.goto(`/book/${vehicleId}/extras?${q(t)}`);
  for (const name of extras) await page.getByLabel(name, { exact: true }).check();
  if (extras.length) await expect(page.getByTestId("price-extras")).toBeVisible();
  await page.getByRole("button", { name: /continue to driver details/i }).click();
  await page.waitForURL(/\/checkout\/[0-9a-f-]{36}/);
  return page.url().match(/checkout\/([0-9a-f-]{36})/)![1];
}

export async function fillDriver(page: Page, opts: { licence?: boolean } = {}) {
  await page.getByLabel("Full name (as on licence)").fill("QA E2E Driver");
  await page.getByLabel("Driver email").fill("driver@example.test");
  await page.getByLabel("Mobile number").fill("+971500000002");
  await page.getByLabel("Date of birth").fill("1990-05-05");
  await page.getByLabel("Nationality").fill("Emirati");
  await page.getByLabel("Driving licence number").fill("DXB-998877");
  await page.getByLabel("Licence issued in (country)").fill("United Arab Emirates");
  await page.getByLabel("Licence expiry date").fill("2040-01-01");
  if (opts.licence !== false) {
    await page.getByLabel("Driving licence photo or scan").setInputFiles({ name: "licence.jpg", mimeType: "image/jpeg", buffer: JPEG });
  }
  await page.getByRole("button", { name: /save driver details|update driver details/i }).click();
  await expect(page.getByTestId("form-success")).toBeVisible();
}

export async function pay(page: Page, card: "pm_fake_success" | "pm_fake_declined" = "pm_fake_success") {
  await page.getByLabel("Card").selectOption(card);
  await page.getByRole("button", { name: /pay aed/i }).click();
}

export async function bookAndPay(page: Page, vehicleId: string, t: Trip) {
  const id = await startBooking(page, vehicleId, t);
  await fillDriver(page);
  await pay(page);
  await page.waitForURL(/\/my-rentals\/[0-9a-f-]{36}\/voucher/);
  return id;
}

export async function reservation(id: string) {
  const [r] = await e2eDb().query<Record<string, unknown>>("select * from reservations where id = $1", [id]);
  return r;
}

export async function moneyOf(id: string) {
  const payments = await e2eDb().query<Record<string, unknown>>("select * from payments where reservation_id = $1 order by created_at", [id]);
  const deposits = await e2eDb().query<Record<string, unknown>>("select * from deposits where reservation_id = $1 order by created_at", [id]);
  return { payments, deposits };
}

export const aedText = (fils: number) => (fils / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
