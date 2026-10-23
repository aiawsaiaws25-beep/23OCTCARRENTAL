// Q3/Q4/Q8/Q9 end to end through the UI: search → vehicle + calendar → extras → hold → driver + licence →
// declined payment → retry → voucher; my rentals; cancellation; client price tampering.
import { aedText, bookAndPay, fillDriver, freshVehicle, moneyOf, pay, q, reservation, startBooking, trip } from "./booking";
import { expect, test } from "./fixtures";

test.describe("rental flow", () => {
  // Full UI flows (book + pay twice) are slow on WebKit, especially with mobile emulation.
  test.slow(({ browserName }) => browserName === "webkit");
  test("search shows the car, the vehicle page shows availability, and filters narrow results", async ({ page }) => {
    const v = await freshVehicle({ dailyRateFils: 12_300 });
    const t = trip(v.branchCode, 5, 8);
    await page.goto(`/search?${q(t)}`);
    await expect(page.getByTestId("search-results")).toBeVisible();
    const card = page.locator(`[data-testid="vehicle-card"][data-vehicle-id="${v.vehicleId}"]`);
    await expect(card).toBeVisible();
    await expect(card).toContainText("123");

    // Filters that exclude it
    await page.goto(`/search?${q(t)}&transmission=MANUAL`);
    await expect(page.locator(`[data-vehicle-id="${v.vehicleId}"]`)).toHaveCount(0);
    await expect(page.getByTestId("empty-state")).toBeVisible();
    await page.goto(`/search?${q(t)}&maxPrice=100`);
    await expect(page.locator(`[data-vehicle-id="${v.vehicleId}"]`)).toHaveCount(0);
    await page.goto(`/search?${q(t)}&maxPrice=130`);
    await expect(page.locator(`[data-vehicle-id="${v.vehicleId}"]`)).toHaveCount(1);

    // Invalid range
    await page.goto(`/search?${q({ ...t, returnDate: t.pickupDate, returnTime: "09:00" })}`);
    await expect(page.getByTestId("search-error")).toBeVisible();

    // Vehicle page + calendar
    await page.goto(`/vehicles/${v.vehicleId}?${q(t)}`);
    await expect(page.getByTestId("availability-status")).toBeVisible();
    await expect(page.locator(`[data-testid="calendar-day"][data-date="${t.pickupDate}"]`)).toHaveAttribute("data-available", "true");
  });

  test("full booking: hold, driver + licence, declined then successful payment, voucher, my rentals", async ({ customer }) => {
    const { page } = customer;
    const v = await freshVehicle({ dailyRateFils: 15_000, depositFils: 100_000 });
    const t = trip(v.branchCode, 6, 9); // 3 days
    const id = await startBooking(page, v.vehicleId, t);
    await expect(page.getByTestId("hold-countdown")).toBeVisible();
    await expect(page.getByRole("region", { name: "Price breakdown" }).getByTestId("price-total")).toContainText(aedText(47_250));
    await expect(page.getByRole("region", { name: "Price breakdown" }).getByTestId("price-vat")).toContainText(aedText(2_250));
    await expect(page.getByRole("region", { name: "Price breakdown" }).getByTestId("price-deposit")).toContainText(aedText(100_000));

    await fillDriver(page);
    await pay(page, "pm_fake_declined");
    await expect(page.getByTestId("payment-error")).toBeVisible();
    expect((await reservation(id)).status).toBe("PENDING");

    await page.getByLabel("Card").selectOption("pm_fake_success");
    await page.getByRole("button", { name: /try again|pay aed/i }).click();
    await page.waitForURL(/\/my-rentals\/[0-9a-f-]{36}\/voucher/);
    await expect(page.getByTestId("payment-success")).toBeVisible();
    const r = await reservation(id);
    expect(r.status).toBe("CONFIRMED");
    await expect(page.getByTestId("reservation-ref")).toHaveText(String(r.reference));
    await expect(page.getByTestId("voucher-qr")).toBeVisible();

    const { payments, deposits } = await moneyOf(id);
    expect(payments.filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
    expect(payments.filter((p) => p.status === "FAILED")).toHaveLength(1);
    expect(payments.find((p) => p.status === "SUCCEEDED")!.amount_fils).toBe(47_250);
    expect(deposits.filter((d) => d.status === "AUTHORIZED")).toHaveLength(1);

    // Reload the voucher (refresh after pay must not re-charge)
    await page.reload();
    expect((await moneyOf(id)).payments.filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);

    await page.goto("/my-rentals");
    await expect(page.locator(`[data-testid="rental-row"][data-reference="${r.reference}"]`)).toBeVisible();
  });

  test("going back and re-submitting checkout after paying does not charge twice", async ({ customer }) => {
    const { page } = customer;
    const v = await freshVehicle();
    const id = await bookAndPay(page, v.vehicleId, trip(v.branchCode, 7, 8));
    await page.goBack();
    const payBtn = page.getByRole("button", { name: /pay aed/i });
    if (await payBtn.isVisible().catch(() => false)) await payBtn.click().catch(() => {});
    await page.waitForLoadState("networkidle");
    expect((await moneyOf(id)).payments.filter((p) => p.status === "SUCCEEDED")).toHaveLength(1);
  });

  test("cancel booking from checkout releases the car", async ({ customer, otherCustomer }) => {
    const v = await freshVehicle();
    const t = trip(v.branchCode, 10, 11);
    const id = await startBooking(customer.page, v.vehicleId, t);
    await customer.page.getByRole("button", { name: /cancel booking and release the car/i }).click();
    await expect.poll(async () => (await reservation(id)).status).toBe("CANCELLED");
    await startBooking(otherCustomer.page, v.vehicleId, t);
  });

  test("cancel a confirmed booking (>48h ahead) from My rentals: full refund, deposit released", async ({ customer }) => {
    const { page } = customer;
    const v = await freshVehicle();
    const id = await bookAndPay(page, v.vehicleId, trip(v.branchCode, 12, 13));
    await page.goto(`/my-rentals/${id}`);
    const panel = page.getByTestId("cancel-panel");
    await expect(panel.getByTestId("cancel-fee")).toContainText("0.00");
    await panel.getByRole("button", { name: /cancel booking/i }).click();
    const confirm = page.getByRole("button", { name: /confirm|yes, cancel/i });
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    // The page re-renders with the new status after cancelling.
    await expect(page.getByTestId("cancel-success").or(page.getByText(/^Refunded$/).first())).toBeVisible();
    await expect.poll(async () => (await reservation(id)).status).toBe("REFUNDED");
    const { payments, deposits } = await moneyOf(id);
    expect(payments[0]).toMatchObject({ status: "REFUNDED" });
    expect(deposits[0]).toMatchObject({ status: "RELEASED" });
  });

  test("change dates from My rentals: longer stay charges the difference", async ({ customer }) => {
    const { page } = customer;
    const v = await freshVehicle({ dailyRateFils: 10_000 });
    const t = trip(v.branchCode, 14, 15);
    const id = await bookAndPay(page, v.vehicleId, t);
    await page.goto(`/my-rentals/${id}`);
    const panel = page.getByTestId("change-dates");
    const newReturn = trip(v.branchCode, 14, 16).returnDate;
    // Re-fill until it sticks: a fill before hydration is reset by React's controlled state.
    await page.waitForLoadState("networkidle");
    const input = panel.getByLabel(/new return date/i);
    await input.fill(newReturn);
    // Playwright's WebKit on Windows renders <input type=date> as a plain textbox and its fill() does not
    // reach React's onChange; set the value the way a real date picker does (native setter + input event).
    await input.evaluate((el: HTMLInputElement, value) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, newReturn);
    await expect(input).toHaveValue(newReturn);
    await panel.getByRole("button", { name: /check new price/i }).click();
    await panel.getByRole("button", { name: /pay aed .* and change dates|confirm new dates/i }).click();
    await expect(page.getByTestId("change-success")).toBeVisible();
    const r = await reservation(id);
    expect(r.total_fils).toBe(21_000);
    const paid = (await moneyOf(id)).payments.filter((p) => p.status === "SUCCEEDED").reduce((s, p) => s + Number(p.amount_fils), 0);
    expect(paid).toBe(21_000);
  });

  test("client-side price tampering is ignored", async ({ customer }) => {
    const { page } = customer;
    const v = await freshVehicle({ dailyRateFils: 20_000 });
    const t = trip(v.branchCode, 16, 18); // 2 days → 42000
    await page.goto(`/book/${v.vehicleId}/extras?${q(t)}`);
    // Inject forged price fields and rewrite any displayed totals before submitting.
    await page.evaluate(() => {
      for (const form of Array.from(document.forms)) {
        for (const [name, value] of [
          ["totalFils", "1"],
          ["priceFils", "1"],
          ["dailyRateFils", "1"],
          ["depositFils", "0"],
          ["amount", "1"],
        ]) {
          const i = document.createElement("input");
          i.type = "hidden";
          i.name = name;
          i.value = value;
          form.appendChild(i);
        }
        form.querySelectorAll<HTMLInputElement>('input[type="hidden"]').forEach((i) => {
          if (/price|total|amount|fils/i.test(i.name)) i.value = "1";
        });
      }
    });
    await page.getByRole("button", { name: /continue to driver details/i }).click();
    await page.waitForURL(/\/checkout\//);
    const id = page.url().match(/checkout\/([0-9a-f-]{36})/)![1];
    const r = await reservation(id);
    expect(r).toMatchObject({ daily_rate_fils: 20_000, subtotal_fils: 40_000, vat_fils: 2_000, total_fils: 42_000, deposit_fils: 100_000 });
    await fillDriver(page);
    await page.evaluate(() => {
      for (const form of Array.from(document.forms)) {
        const i = document.createElement("input");
        i.type = "hidden";
        i.name = "amount";
        i.value = "1";
        form.appendChild(i);
      }
    });
    await pay(page);
    await page.waitForURL(/voucher/);
    const [p] = (await moneyOf(id)).payments;
    expect(p.amount_fils).toBe(42_000);
  });

  test("logged-out visitors are sent to log in and returned to the booking", async ({ page, baseURL }) => {
    const v = await freshVehicle();
    const t = trip(v.branchCode, 20, 21);
    await page.goto(`/book/${v.vehicleId}/extras?${q(t)}`);
    await page.getByRole("button", { name: /continue to driver details/i }).click();
    await page.waitForURL(/\/login\?next=/);
    const { signUp, uniqueEmail, PASSWORD } = await import("./fixtures");
    const email = uniqueEmail("next");
    await signUp(page.request, baseURL!, { email, password: PASSWORD, name: "Next" });
    await page.context().clearCookies();
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/book\/.*\/extras/);
  });
});
