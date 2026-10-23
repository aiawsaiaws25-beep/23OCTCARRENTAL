// Q7/Q9/Q10 HTTP-level checks that need only the running server.
import { signPayload } from "../src/lib/services/payments/webhook-signature";
import { freshVehicle, bookAndPay, reservation, startBooking, trip } from "./booking";
import { e2eDb, expect, test } from "./fixtures";

const CRON = "/api/cron/release-holds";
const WEBHOOK = "/api/webhooks/payments";

// These are pure HTTP checks; one browser project is enough.
test.skip(({ browserName, isMobile }) => browserName !== "chromium" || isMobile, "API checks run once");

test.describe("cron endpoint", () => {
  test("rejects missing CRON_SECRET", async ({ request }) => {
    for (const method of ["post", "get"] as const) {
      const res = await request[method](CRON);
      expect([401, 403, 405], `${method} ${res.status()}`).toContain(res.status());
    }
  });

  test("rejects a wrong CRON_SECRET", async ({ request }) => {
    const res = await request.post(CRON, { headers: { authorization: "Bearer wrong-secret-0000000000" } });
    expect([401, 403]).toContain(res.status());
  });

  test("accepts the right CRON_SECRET and is idempotent", async ({ request }) => {
    const headers = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const a = await request.post(CRON, { headers });
    expect(a.status()).toBe(200);
    const b = await request.post(CRON, { headers });
    expect(b.status()).toBe(200);
    const body = await b.json();
    // Second run right after the first has nothing left to expire.
    expect(body).toMatchObject({ ok: true, expired: 0 });
    // Vercel Cron uses GET with the same header.
    expect((await request.get(CRON, { headers })).status()).toBe(200);
  });

  test("an expired hold is released by the cron and the period becomes bookable again", async ({ request, customer, otherCustomer }) => {
    const headers = { authorization: `Bearer ${process.env.CRON_SECRET}` };
    const v = await freshVehicle();
    const t = trip(v.branchCode, 25, 27);
    const id = await startBooking(customer.page, v.vehicleId, t);
    await e2eDb().query("update reservations set hold_expires_at = now() - interval '1 minute' where id = $1", [id]);
    const res = await request.post(CRON, { headers });
    expect(res.status()).toBe(200);
    expect((await res.json()).expiredIds).toContain(id);
    expect((await reservation(id)).status).toBe("EXPIRED");
    const again = await request.post(CRON, { headers });
    expect((await again.json()).expiredIds).not.toContain(id);
    // Someone else can now book the same dates.
    await startBooking(otherCustomer.page, v.vehicleId, t);
  });
});

test.describe("payment webhook", () => {
  test("a correctly signed event is applied once; the same event again is a duplicate", async ({ request, customer }) => {
    const v = await freshVehicle();
    const id = await bookAndPay(customer.page, v.vehicleId, trip(v.branchCode, 30, 31));
    const [p] = await e2eDb().query<Record<string, string | number>>("select * from payments where reservation_id = $1 and status = 'SUCCEEDED'", [id]);
    const event = {
      id: `evt_qa_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      type: "payment.succeeded",
      createdAt: new Date().toISOString(),
      data: {
        id: p.provider_payment_id,
        amount: p.amount_fils,
        currency: "aed",
        status: "succeeded",
        refundedAmount: 0,
        metadata: { paymentRowId: p.id, reservationId: id },
        createdAt: new Date().toISOString(),
      },
    };
    const body = JSON.stringify(event);
    const headers = { "content-type": "application/json", "x-driveeasy-signature": signPayload(body, process.env.PAYMENTS_WEBHOOK_SECRET!) };
    const [a, b] = await Promise.all([request.post(WEBHOOK, { data: body, headers }), request.post(WEBHOOK, { data: body, headers })]);
    const statuses = [(await a.json()).status, (await b.json()).status].sort();
    expect([a.status(), b.status()]).toEqual([200, 200]);
    expect(statuses).toEqual(["duplicate", "processed"]);
    const c = await request.post(WEBHOOK, { data: body, headers });
    expect((await c.json()).status).toBe("duplicate");
    const rows = await e2eDb().query<{ n: number }>("select count(*)::int n from payment_webhook_events where event_id = $1", [event.id]);
    expect(rows[0].n).toBe(1);
    expect((await e2eDb().query("select * from payments where reservation_id = $1 and status = 'SUCCEEDED'", [id])).length).toBe(1);
  });

  test("signed but malformed JSON is a 400, not a 500", async ({ request }) => {
    const body = "{not json";
    const res = await request.post(WEBHOOK, {
      data: body,
      headers: { "content-type": "application/json", "x-driveeasy-signature": signPayload(body, process.env.PAYMENTS_WEBHOOK_SECRET!) },
    });
    expect(res.status()).toBe(400);
  });

  test("rejects an unsigned event", async ({ request }) => {
    const res = await request.post(WEBHOOK, { data: { id: "evt_x", type: "payment.succeeded", data: {} } });
    expect([400, 401, 403]).toContain(res.status());
  });

  test("rejects a bad signature", async ({ request }) => {
    const res = await request.post(WEBHOOK, {
      data: JSON.stringify({ id: "evt_y", type: "payment.succeeded", data: {} }),
      headers: { "content-type": "application/json", "x-driveeasy-signature": `t=${Math.floor(Date.now() / 1000)},v1=${"0".repeat(64)}` },
    });
    expect([400, 401, 403]).toContain(res.status());
  });
});

test.describe("private files", () => {
  test("uploads are not served statically", async ({ request }) => {
    for (const p of ["/uploads/", "/uploads/licences/x.jpg", "/licences/x.jpg", "/.local/uploads-e2e/x"]) {
      const res = await request.get(p);
      expect(res.status(), p).toBe(404);
    }
  });
});
