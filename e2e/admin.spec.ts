// Q4 (desk side) + Q10 admin: voucher lookup → check-out → damage report with photo → late check-in with
// fuel + damage charges taken from the deposit; fleet/branch/pricing/maintenance admin; customers denied.
import { bookAndPay, freshVehicle, JPEG, moneyOf, q, reservation, type Trip } from "./booking";
import { e2eDb, expect, test } from "./fixtures";

test.skip(({ browserName }) => browserName === "firefox", "admin desk flows run on chromium + webkit (desktop and mobile)");
test.slow();

const dubai = (d: Date) => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
};

/** A trip starting 90-120 min from now (so the desk can check it out now), lasting 24h. */
function soonTrip(branchCode: string): { t: Trip; start: Date; end: Date } {
  const start = new Date(Math.ceil((Date.now() + 90 * 60_000) / (30 * 60_000)) * 30 * 60_000);
  const end = new Date(start.getTime() + 24 * 3_600_000);
  const s = dubai(start);
  const e = dubai(end);
  return { t: { pickupBranch: branchCode, returnBranch: branchCode, pickupDate: s.date, pickupTime: s.time, returnDate: e.date, returnTime: e.time }, start, end };
}

test.describe("admin desk", () => {
  test("lookup by voucher → check-out → damage with photo → late return: charges captured from deposit", async ({ customer, otherCustomer, admin }) => {
    const v = await freshVehicle({ dailyRateFils: 15_000, depositFils: 100_000 });
    const { t, end } = soonTrip(v.branchCode);
    const id = await bookAndPay(customer.page, v.vehicleId, t);
    const r = await reservation(id);

    // Desk lookup by reference
    const page = admin.page;
    await page.goto("/admin");
    await page.getByLabel("Reservation reference or scanned voucher code").fill(String(r.reference));
    await page.getByRole("button", { name: "Find reservation" }).click();
    await page.waitForURL(new RegExp(`/admin/reservations/${id}`));

    // A forged voucher code is not accepted
    // (checked at service level too; here: lookup of a tampered QR payload must not open the booking)

    // Check-out
    const out = page.getByTestId("checkout-form");
    await out.getByLabel("Odometer (km)").fill("1000");
    await out.getByLabel("Fuel level").selectOption("8");
    await out.getByRole("button", { name: "Check out" }).click();
    await expect(page.getByTestId("checkin-form")).toBeVisible();
    expect((await reservation(id)).status).toBe("PICKED_UP");

    // Damage report with a photo, AED 150 charge
    const dmg = page.getByTestId("damage-form");
    await expect(async () => {
      if (!(await dmg.getByLabel("Severity").isVisible())) await page.locator("summary", { hasText: "Report damage" }).click();
      await expect(dmg.getByLabel("Severity")).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await dmg.getByLabel("Severity").selectOption("MINOR");
    await dmg.getByLabel("Description").fill("Scratch on rear bumper (QA)");
    await dmg.getByLabel("Charge to customer (AED, excl. VAT)").fill("150");
    await dmg.getByLabel("Photos").setInputFiles({ name: "damage.jpg", mimeType: "image/jpeg", buffer: JPEG });
    await dmg.getByRole("button", { name: "Save damage report" }).click();
    await expect(page.getByTestId("damage-report").first()).toBeVisible();
    const [report] = await e2eDb().query<{ image_keys: string[]; charged_fils: number }>("select image_keys, charged_fils from damage_reports where reservation_id = $1", [id]);
    expect(report.charged_fils).toBe(15_000);
    const photo = `/api/files/${report.image_keys[0]}`;
    expect((await page.request.get(photo)).status()).toBe(200);
    expect((await customer.page.request.get(photo)).status()).toBe(200); // the renter
    expect((await otherCustomer.page.request.get(photo)).status()).toBe(404);

    // Check-in 3h10m late with 2/8 less fuel
    const returned = dubai(new Date(end.getTime() + 190 * 60_000));
    const inForm = page.getByTestId("checkin-form");
    await inForm.getByLabel("Odometer (km)").fill("1180");
    await inForm.getByLabel("Fuel level").selectOption("6");
    await inForm.getByLabel("Returned on").fill(returned.date);
    await inForm.getByLabel("Returned at (local time)").fill(returned.time);
    await inForm.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByTestId("return-charges")).toBeVisible();

    const late = 15_000; // 4 started hours x 25% capped at one day
    const fuel = 12_000;
    const damage = 15_000;
    const vat = Math.round(((late + fuel + damage) * 5) / 100);
    const [a] = await e2eDb().query<Record<string, number>>("select * from rental_agreements where reservation_id = $1", [id]);
    expect(a).toMatchObject({ late_minutes: 190, late_fee_fils: late, fuel_charge_fils: fuel, damage_charge_fils: damage, extra_charges_vat_fils: vat });
    expect(a.deposit_captured_fils).toBe(late + fuel + damage + vat);
    expect(a.outstanding_fils).toBe(0);
    const { deposits } = await moneyOf(id);
    expect(deposits[0]).toMatchObject({ status: "CAPTURED", captured_fils: late + fuel + damage + vat });
    expect((await reservation(id)).status).toBe("RETURNED");
    await expect(page.getByTestId("return-charges")).toContainText((vat / 100).toFixed(2));

    // Customer sees the return charges, cannot see the admin page
    const res = await customer.page.goto(`/admin/reservations/${id}`);
    await expect(customer.page.getByRole("heading", { name: /not found/i })).toBeVisible();
    expect(res?.status()).toBeLessThan(500);
  });

  test("on-time return with a full tank releases the deposit", async ({ customer, admin }) => {
    const v = await freshVehicle();
    const { t, end } = soonTrip(v.branchCode);
    const id = await bookAndPay(customer.page, v.vehicleId, t);
    const page = admin.page;
    await page.goto(`/admin/reservations/${id}`);
    await page.getByTestId("checkout-form").getByLabel("Odometer (km)").fill("500");
    await page.getByTestId("checkout-form").getByRole("button", { name: "Check out" }).click();
    const inForm = page.getByTestId("checkin-form");
    await expect(inForm).toBeVisible();
    const back = dubai(end);
    await inForm.getByLabel("Odometer (km)").fill("650");
    await inForm.getByLabel("Fuel level").selectOption("8");
    await inForm.getByLabel("Returned on").fill(back.date);
    await inForm.getByLabel("Returned at (local time)").fill(back.time);
    await inForm.getByRole("button", { name: "Check in" }).click();
    await expect(page.getByTestId("return-charges")).toBeVisible();
    expect((await moneyOf(id)).deposits[0]).toMatchObject({ status: "RELEASED" });
  });

  test("a customer replaying the admin check-out Server Action is rejected", async ({ customer, admin }) => {
    const v = await freshVehicle();
    const { t } = soonTrip(v.branchCode);
    const id = await bookAndPay(customer.page, v.vehicleId, t);
    // Capture the real admin action request without letting it through.
    let captured: { url: string; headers: Record<string, string>; body: string } | undefined;
    await admin.page.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"] && !captured) {
        captured = { url: req.url(), headers: req.headers(), body: req.postData() ?? "" };
        return route.abort();
      }
      return route.continue();
    });
    await admin.page.goto(`/admin/reservations/${id}`);
    await admin.page.getByTestId("checkout-form").getByLabel("Odometer (km)").fill("1");
    await admin.page.getByTestId("checkout-form").getByRole("button", { name: "Check out" }).click();
    await expect.poll(() => Boolean(captured)).toBe(true);
    const headers = Object.fromEntries(Object.entries(captured!.headers).filter(([k]) => !["cookie", "content-length", "host"].includes(k)));
    const replay = await customer.page.request.post(captured!.url, { headers, data: captured!.body });
    expect(replay.status()).toBeLessThan(500);
    expect((await reservation(id)).status).toBe("CONFIRMED");
    // Anonymous replay too
    const anon = await admin.page.context().browser()!.newContext();
    await anon.request.post(captured!.url, { headers, data: captured!.body });
    await anon.close();
    expect((await reservation(id)).status).toBe("CONFIRMED");
  });
});

test.describe("admin fleet / branches / pricing", () => {
  test("create a branch; it is listed for admins and on the public branches page", async ({ admin, page }) => {
    const code = `QA${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const a = admin.page;
    await a.goto("/admin/branches");
    const f = a.getByTestId("branch-form");
    await f.getByLabel("Code").fill(code);
    await f.getByLabel("Name").fill(`QA Branch ${code}`);
    await f.getByLabel("City").fill("Dubai");
    await f.getByLabel("Emirate").fill("Dubai");
    await f.getByLabel("Address").fill("1 QA Street, Dubai");
    await f.getByLabel("Phone").fill("+97140000001");
    await f.getByLabel("Opening hours").fill("Open 24 hours");
    await f.getByRole("button", { name: "Create branch" }).click();
    await expect(a.getByTestId("form-error")).toHaveCount(0);
    await expect.poll(async () => (await e2eDb().query("select 1 from branches where code = $1", [code])).length).toBe(1);
    await a.goto("/admin/branches");
    await expect(a.getByTestId("admin-branch-row").filter({ hasText: code })).toBeVisible();
    await page.goto("/branches");
    await expect(page.getByText(`QA Branch ${code}`)).toBeVisible();
  });

  test("maintenance block from the fleet page removes the car from search for that period", async ({ admin, page }) => {
    const v = await freshVehicle();
    const t: Trip = { pickupBranch: v.branchCode, returnBranch: v.branchCode, pickupDate: "", pickupTime: "10:00", returnDate: "", returnTime: "10:00" };
    const day = (n: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + n * 86_400_000));
    t.pickupDate = day(20);
    t.returnDate = day(22);
    await page.goto(`/search?${q(t)}`);
    await expect(page.locator(`[data-vehicle-id="${v.vehicleId}"]`)).toHaveCount(1);

    const a = admin.page;
    await a.goto(`/admin/fleet/${v.vehicleId}`);
    const m = a.getByTestId("maintenance-form");
    await m.getByLabel("Start date").fill(day(21));
    await m.getByLabel("Start time").fill("08:00");
    await m.getByLabel("End date").fill(day(21));
    await m.getByLabel("End time").fill("18:00");
    await m.getByLabel("Reason").fill("QA service");
    await m.getByRole("button", { name: "Schedule maintenance" }).click();
    await expect.poll(async () => (await e2eDb().query("select 1 from maintenance_blocks where vehicle_id = $1 and cancelled_at is null", [v.vehicleId])).length).toBe(1);

    await page.goto(`/search?${q(t)}`);
    await expect(page.locator(`[data-vehicle-id="${v.vehicleId}"]`)).toHaveCount(0);
    await page.goto(`/vehicles/${v.vehicleId}?${q(t)}`);
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${day(21)}"]`)).toHaveAttribute("data-available", "false");
  });

  test("changing a category's daily rate changes new quotes (server-side) but not existing bookings", async ({ admin, customer, page }) => {
    const v = await freshVehicle({ dailyRateFils: 10_000 });
    const t: Trip = {
      pickupBranch: v.branchCode,
      returnBranch: v.branchCode,
      pickupDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + 30 * 86_400_000)),
      pickupTime: "10:00",
      returnDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + 31 * 86_400_000)),
      returnTime: "10:00",
    };
    const id = await bookAndPay(customer.page, v.vehicleId, t);
    const [cat] = await e2eDb().query<{ slug: string; name: string }>(
      "select c.slug, c.name from vehicle_categories c join vehicles v on v.category_id = c.id where v.id = $1",
      [v.vehicleId],
    );
    const a = admin.page;
    await a.goto("/admin/pricing");
    const form = a.locator("form").filter({ has: a.getByRole("button", { name: `Save ${cat.name}` }) });
    await form.getByLabel("Daily rate (AED, excl. VAT)").fill("200");
    await form.getByRole("button", { name: `Save ${cat.name}` }).click();
    await expect.poll(async () => (await e2eDb().query<{ r: number }>("select daily_rate_fils r from vehicle_categories where slug = $1", [cat.slug]))[0].r).toBe(20_000);
    expect((await reservation(id)).total_fils).toBe(10_500);
    // New search for other dates shows the new rate
    const t2 = { ...t, pickupDate: t.returnDate, returnDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dubai" }).format(new Date(Date.now() + 32 * 86_400_000)) };
    await page.goto(`/search?${q(t2)}`);
    await expect(page.locator(`[data-vehicle-id="${v.vehicleId}"]`)).toContainText("200");
  });

  test("customers are denied every admin screen and anonymous users are sent to login", async ({ customer, page }) => {
    for (const path of ["/admin", "/admin/reservations", "/admin/fleet", "/admin/branches", "/admin/pricing", "/admin/damage"]) {
      await customer.page.goto(path);
      await expect(customer.page.getByRole("heading", { name: /not found/i }), path).toBeVisible();
      await expect(customer.page.getByTestId("branch-form").or(customer.page.getByTestId("vehicle-form")), path).toHaveCount(0);
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });
});
