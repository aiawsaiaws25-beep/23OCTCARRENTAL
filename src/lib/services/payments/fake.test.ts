import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { releaseExpiredHolds } from "@/lib/jobs/release-expired-holds";
import { FakePaymentProvider } from "./fake";
import type { WebhookEvent } from "./types";
import { SIGNATURE_HEADER } from "./webhook-signature";

const secret = "test-webhook-secret-123456";

function setup(opts: { duplicateWebhooks?: boolean } = {}) {
  const received: { body: string; signature: string | null }[] = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    received.push({ body: init.body as string, signature: headers[SIGNATURE_HEADER] });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
  const provider = new FakePaymentProvider({
    stateFile: join(mkdtempSync(join(tmpdir(), "fake-pay-")), "state.json"),
    webhookUrl: "http://localhost/webhook",
    webhookSecret: secret,
    fetchImpl,
    ...opts,
  });
  const events = () => received.map((r) => provider.verifyWebhook(r.body, r.signature) as WebhookEvent);
  return { provider, received, events };
}

describe("FakePaymentProvider", () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => {
    t = setup();
  });

  it("succeeds a payment and sends a signed webhook", async () => {
    const p = await t.provider.createPayment({ amount: 5000, currency: "AUD" });
    expect(p.status).toBe("succeeded");
    expect(t.events().map((e) => e.type)).toEqual(["payment.succeeded"]);
  });

  it("fails a payment with the declined test card", async () => {
    const p = await t.provider.createPayment({ amount: 5000, currency: "aud", paymentMethod: "pm_fake_declined" });
    expect(p.status).toBe("failed");
    expect(t.events()[0].type).toBe("payment.failed");
  });

  it("cancels a payment", async () => {
    const p = await t.provider.createPayment({ amount: 5000, currency: "aud" });
    expect((await t.provider.cancelPayment(p.id)).status).toBe("canceled");
    await expect(t.provider.refundPayment(p.id)).rejects.toThrow(/canceled/);
  });

  it("refunds partially then fully", async () => {
    const p = await t.provider.createPayment({ amount: 5000, currency: "aud" });
    expect((await t.provider.refundPayment(p.id, 2000)).status).toBe("partially_refunded");
    expect((await t.provider.refundPayment(p.id)).status).toBe("refunded");
    await expect(t.provider.refundPayment(p.id, 1)).rejects.toThrow();
  });

  it("holds, releases and captures deposits", async () => {
    const future = new Date(Date.now() + 86_400_000);
    const a = await t.provider.holdDeposit({ amount: 30000, currency: "aud", expiresAt: future });
    const b = await t.provider.holdDeposit({ amount: 30000, currency: "aud", expiresAt: future });
    expect((await t.provider.releaseDeposit(a.id)).status).toBe("released");
    const captured = await t.provider.captureDeposit(b.id, 12000);
    expect(captured).toMatchObject({ status: "captured", capturedAmount: 12000 });
    await expect(t.provider.releaseDeposit(b.id)).rejects.toThrow(/captured/);
  });

  it("sends duplicate webhooks with the same event id", async () => {
    const d = setup({ duplicateWebhooks: true });
    await d.provider.createPayment({ amount: 100, currency: "aud" });
    const [first, second] = d.events();
    expect(d.received).toHaveLength(2);
    expect(first.id).toBe(second.id);

    await d.provider.redeliverWebhook(first.id);
    expect(new Set(d.events().map((e) => e.id)).size).toBe(1);
  });

  it("rejects webhooks with a bad signature", async () => {
    await t.provider.createPayment({ amount: 100, currency: "aud" });
    const { body } = t.received[0];
    expect(() => t.provider.verifyWebhook(body, "t=1,v1=00")).toThrow(/signature/);
    expect(() => t.provider.verifyWebhook(body.replace("100", "999"), t.received[0].signature)).toThrow();
  });

  it("releaseExpiredHolds releases only expired holds", async () => {
    const expired = await t.provider.holdDeposit({ amount: 100, currency: "aud", expiresAt: new Date(Date.now() - 1000) });
    const active = await t.provider.holdDeposit({ amount: 100, currency: "aud", expiresAt: new Date(Date.now() + 60_000) });
    const result = await releaseExpiredHolds(t.provider);
    expect(result.released).toEqual([expired.id]);
    const [stillHeld] = await t.provider.listHolds({ status: "held" });
    expect(stillHeld.id).toBe(active.id);
    expect((await releaseExpiredHolds(t.provider)).released).toEqual([]);
  });
});
