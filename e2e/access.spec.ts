// Q10 end to end: users cannot reach another user's reservations, vouchers, checkout or licence files
// by guessing URLs/ids, and server actions re-check ownership even when the id is forged.
import { bookAndPay, freshVehicle, reservation, startBooking, fillDriver, trip } from "./booking";
import { e2eDb, expect, test } from "./fixtures";

test.skip(({ isMobile }) => isMobile, "access checks are viewport independent");

async function expectNotFound(page: import("@playwright/test").Page, path: string) {
  const res = await page.goto(path);
  const hard = res && [401, 403, 404].includes(res.status());
  const soft = await page
    .getByRole("heading", { name: /not found/i })
    .waitFor({ timeout: 10_000 })
    .then(() => true, () => false);
  expect(hard || soft || /\/login/.test(page.url()), `${path} -> ${res?.status()}`).toBe(true);
  const html = await page.content();
  return html;
}

test.describe("access control", () => {
  test("another customer cannot open my reservation, voucher or checkout", async ({ customer, otherCustomer }) => {
    const v = await freshVehicle();
    const id = await bookAndPay(customer.page, v.vehicleId, trip(v.branchCode, 8, 9));
    const r = await reservation(id);
    for (const path of [`/my-rentals/${id}`, `/my-rentals/${id}/voucher`, `/checkout/${id}`]) {
      const html = await expectNotFound(otherCustomer.page, path);
      expect(html, path).not.toContain(String(r.reference));
      expect(html, path).not.toContain("QA E2E Driver");
      expect(html, path).not.toContain("DXB-998877");
    }
    await otherCustomer.page.goto("/my-rentals");
    await expect(otherCustomer.page.locator(`[data-reference="${r.reference}"]`)).toHaveCount(0);
    // Owner still can
    await customer.page.goto(`/my-rentals/${id}/voucher`);
    await expect(customer.page.getByTestId("reservation-ref")).toHaveText(String(r.reference));
  });

  test("anonymous visitors are sent to login for reservation pages", async ({ page, customer }) => {
    const v = await freshVehicle();
    const id = await startBooking(customer.page, v.vehicleId, trip(v.branchCode, 9, 10));
    for (const path of [`/my-rentals/${id}`, `/my-rentals/${id}/voucher`, `/checkout/${id}`]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login/);
    }
  });

  test("junk and guessed ids are a clean not-found", async ({ customer }) => {
    for (const path of ["/my-rentals/not-a-uuid", "/my-rentals/00000000-0000-4000-8000-000000000000/voucher", "/checkout/../../etc/passwd", "/vehicles/xyz"]) {
      await expectNotFound(customer.page, path);
    }
  });

  test("licence files: owner and admin can download, other customers and anonymous get 404", async ({ customer, otherCustomer, admin, request }) => {
    const v = await freshVehicle();
    await startBooking(customer.page, v.vehicleId, trip(v.branchCode, 10, 11));
    await fillDriver(customer.page);
    const [p] = await e2eDb().query<{ licence_file_key: string }>(
      "select licence_file_key from driver_profiles dp join users u on u.id = dp.user_id where u.email = $1",
      [customer.user.email],
    );
    expect(p?.licence_file_key, "licence uploaded").toBeTruthy();
    const url = `/api/files/${p.licence_file_key}`;
    const own = await customer.page.request.get(url);
    expect(own.status()).toBe(200);
    expect(own.headers()["content-type"]).toBe("image/jpeg");
    expect(own.headers()["cache-control"]).toContain("no-store");
    expect((await admin.page.request.get(url)).status()).toBe(200);
    expect((await otherCustomer.page.request.get(url)).status()).toBe(404);
    expect((await request.get(url)).status()).toBe(404);
    // Path tricks
    for (const evil of [
      `/api/files/${p.licence_file_key.replace(/licences\/[^/]+/, "licences/..")}`,
      "/api/files/..%2f..%2f.env.local",
      "/api/files/%2e%2e/%2e%2e/.env.local",
      "/api/files/licences/../../.env.local",
    ]) {
      const res = await otherCustomer.page.request.get(evil);
      expect(res.status(), evil).toBe(404);
      expect(await res.text(), evil).not.toMatch(/BETTER_AUTH_SECRET|CRON_SECRET|DATABASE_URL/);
    }
  });

  test("server actions ignore a forged reservation id (cancel)", async ({ customer, otherCustomer }) => {
    const v1 = await freshVehicle();
    const v2 = await freshVehicle();
    const victim = await bookAndPay(customer.page, v1.vehicleId, trip(v1.branchCode, 15, 16));
    const mine = await bookAndPay(otherCustomer.page, v2.vehicleId, trip(v2.branchCode, 15, 16));
    const page = otherCustomer.page;
    // Rewrite every server-action POST so it targets the victim's reservation.
    await page.route("**/*", async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        const body = req.postData() ?? "";
        return route.continue({ postData: body.split(mine).join(victim) });
      }
      return route.continue();
    });
    await page.goto(`/my-rentals/${mine}`);
    await page.getByTestId("cancel-panel").getByRole("button", { name: /cancel booking/i }).click();
    const confirm = page.getByRole("button", { name: /confirm|yes, cancel/i });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await page.waitForTimeout(2000);
    expect((await reservation(victim)).status).toBe("CONFIRMED");
    // Proves the forged request was the one sent (otherwise Bob's own booking would be cancelled).
    expect((await reservation(mine)).status).toBe("CONFIRMED");
  });
});
