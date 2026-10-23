import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type CreatePaymentInput,
  type DepositHold,
  type HoldDepositInput,
  type Payment,
  PaymentError,
  type PaymentProvider,
  type WebhookEvent,
  type WebhookEventType,
} from "./types";
import { isValidSignature, SIGNATURE_HEADER, signPayload } from "./webhook-signature";

type State = { payments: Record<string, Payment>; holds: Record<string, DepositHold>; events: WebhookEvent[] };

export type FakePaymentOptions = {
  stateFile: string; // JSON file, so the dev server and CLI jobs share state
  webhookUrl: string;
  webhookSecret: string;
  duplicateWebhooks?: boolean; // deliver every event twice, like real providers sometimes do
  fetchImpl?: typeof fetch;
};

export type WebhookDelivery = { eventId: string; ok: boolean; status?: number; error?: string };

const DECLINED = "pm_fake_declined";

// Local stand-in for a real payment provider. Never contacts the internet;
// webhooks go to the app's own URL (localhost by default).
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly deliveries: WebhookDelivery[] = [];

  constructor(private readonly opts: FakePaymentOptions) {}

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    assertAmount(input.amount);
    const declined = input.paymentMethod === DECLINED;
    const payment: Payment = {
      id: `pay_fake_${randomUUID()}`,
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      status: declined ? "failed" : "succeeded",
      refundedAmount: 0,
      failureReason: declined ? "card_declined" : undefined,
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    this.update((s) => void (s.payments[payment.id] = payment));
    await this.emit(declined ? "payment.failed" : "payment.succeeded", payment);
    return payment;
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    const payment = this.update((s) => {
      const p = getOrThrow(s.payments, paymentId);
      if (p.status !== "succeeded" || p.refundedAmount > 0) {
        throw new PaymentError(`Cannot cancel a payment that is ${p.status}`, "invalid_state");
      }
      p.status = "canceled";
      return p;
    });
    await this.emit("payment.canceled", payment);
    return payment;
  }

  async refundPayment(paymentId: string, amount?: number): Promise<Payment> {
    const payment = this.update((s) => {
      const p = getOrThrow(s.payments, paymentId);
      if (p.status !== "succeeded" && p.status !== "partially_refunded") {
        throw new PaymentError(`Cannot refund a payment that is ${p.status}`, "invalid_state");
      }
      const refund = amount ?? p.amount - p.refundedAmount;
      assertAmount(refund);
      if (p.refundedAmount + refund > p.amount) throw new PaymentError("Refund exceeds payment", "invalid_amount");
      p.refundedAmount += refund;
      p.status = p.refundedAmount === p.amount ? "refunded" : "partially_refunded";
      return p;
    });
    await this.emit("payment.refunded", payment);
    return payment;
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    assertAmount(input.amount);
    if (input.paymentMethod === DECLINED) throw new PaymentError("Card declined", "declined");
    const hold: DepositHold = {
      id: `hold_fake_${randomUUID()}`,
      amount: input.amount,
      currency: input.currency.toLowerCase(),
      status: "held",
      capturedAmount: 0,
      expiresAt: input.expiresAt.toISOString(),
      metadata: input.metadata ?? {},
      createdAt: new Date().toISOString(),
    };
    this.update((s) => void (s.holds[hold.id] = hold));
    await this.emit("deposit.held", hold);
    return hold;
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    const hold = this.update((s) => {
      const h = getOrThrow(s.holds, holdId);
      if (h.status !== "held") throw new PaymentError(`Cannot release a hold that is ${h.status}`, "invalid_state");
      h.status = "released";
      return h;
    });
    await this.emit("deposit.released", hold);
    return hold;
  }

  async captureDeposit(holdId: string, amount?: number): Promise<DepositHold> {
    const hold = this.update((s) => {
      const h = getOrThrow(s.holds, holdId);
      if (h.status !== "held") throw new PaymentError(`Cannot capture a hold that is ${h.status}`, "invalid_state");
      const capture = amount ?? h.amount;
      assertAmount(capture);
      if (capture > h.amount) throw new PaymentError("Capture exceeds hold", "invalid_amount");
      h.status = "captured";
      h.capturedAmount = capture;
      return h;
    });
    await this.emit("deposit.captured", hold);
    return hold;
  }

  async listHolds(filter: { status?: DepositHold["status"]; expiresBefore?: Date }): Promise<DepositHold[]> {
    return Object.values(this.read().holds).filter(
      (h) =>
        (!filter.status || h.status === filter.status) &&
        (!filter.expiresBefore || new Date(h.expiresAt) <= filter.expiresBefore),
    );
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent {
    if (!isValidSignature(rawBody, signatureHeader, this.opts.webhookSecret)) {
      throw new PaymentError("Invalid webhook signature", "bad_signature");
    }
    return JSON.parse(rawBody) as WebhookEvent;
  }

  // Test helper: send an already-emitted event again (same event id).
  async redeliverWebhook(eventId: string): Promise<WebhookDelivery> {
    const event = this.read().events.find((e) => e.id === eventId);
    if (!event) throw new PaymentError(`No event ${eventId}`, "not_found");
    return this.deliver(event);
  }

  listEvents(): WebhookEvent[] {
    return this.read().events;
  }

  private async emit(type: WebhookEventType, data: Payment | DepositHold) {
    const event: WebhookEvent = { id: `evt_fake_${randomUUID()}`, type, createdAt: new Date().toISOString(), data };
    this.update((s) => void s.events.push(event));
    await this.deliver(event);
    if (this.opts.duplicateWebhooks) await this.deliver(event);
  }

  private async deliver(event: WebhookEvent): Promise<WebhookDelivery> {
    const body = JSON.stringify(event);
    let delivery: WebhookDelivery;
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(this.opts.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", [SIGNATURE_HEADER]: signPayload(body, this.opts.webhookSecret) },
        body,
      });
      delivery = { eventId: event.id, ok: res.ok, status: res.status };
    } catch (err) {
      // The app may not be running (e.g. CLI jobs); the event stays in the state file for redelivery.
      delivery = { eventId: event.id, ok: false, error: (err as Error).message };
    }
    this.deliveries.push(delivery);
    return delivery;
  }

  private read(): State {
    try {
      return JSON.parse(readFileSync(this.opts.stateFile, "utf8")) as State;
    } catch {
      return { payments: {}, holds: {}, events: [] };
    }
  }

  private update<T>(fn: (s: State) => T): T {
    const state = this.read();
    const result = fn(state);
    mkdirSync(dirname(this.opts.stateFile), { recursive: true });
    writeFileSync(this.opts.stateFile, JSON.stringify(state, null, 2));
    return result;
  }
}

function getOrThrow<T>(map: Record<string, T>, id: string): T {
  const item = map[id];
  if (!item) throw new PaymentError(`Not found: ${id}`, "not_found");
  return item;
}

function assertAmount(amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new PaymentError("Amount must be a positive integer", "invalid_amount");
}
