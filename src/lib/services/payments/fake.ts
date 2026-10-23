import { randomUUID } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  type CreatePaymentInput,
  type DepositHold,
  type HoldDepositInput,
  type OperationOptions,
  type Payment,
  PaymentError,
  type PaymentProvider,
  type WebhookEvent,
  type WebhookEventType,
} from "./types";
import { isValidSignature, SIGNATURE_HEADER, signPayload } from "./webhook-signature";

type State = {
  payments: Record<string, Payment>;
  holds: Record<string, DepositHold>;
  events: WebhookEvent[];
  // idempotency key -> result id (payment, hold, or a refund/capture marker)
  idempotency?: Record<string, string>;
};

export type FakePaymentOptions = {
  stateFile: string; // JSON file, so the dev server and CLI jobs share state
  webhookUrl: string;
  webhookSecret: string;
  duplicateWebhooks?: boolean; // deliver every event twice, like real providers sometimes do
  fetchImpl?: typeof fetch;
  webhookTimeoutMs?: number;
};

export type WebhookDelivery = { eventId: string; ok: boolean; status?: number; error?: string };

const DECLINED = "pm_fake_declined";

// Local stand-in for a real payment provider. Never contacts the internet;
// webhooks go to the app's own URL (localhost by default).
// State updates are serialised with a lock file and written atomically
// (temp file + rename), so the dev server and CLI jobs can share the file.
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  readonly signatureHeader = SIGNATURE_HEADER;
  readonly deliveries: WebhookDelivery[] = [];

  constructor(private readonly opts: FakePaymentOptions) {}

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    assertAmount(input.amount);
    const declined = input.paymentMethod === DECLINED;
    const { payment, created } = this.update((s) => {
      const prior = this.idem(s, "pay", input.idempotencyKey);
      if (prior && s.payments[prior]) return { payment: s.payments[prior], created: false };
      const p: Payment = {
        id: `pay_fake_${randomUUID()}`,
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        status: declined ? "failed" : "succeeded",
        refundedAmount: 0,
        failureReason: declined ? "card_declined" : undefined,
        metadata: input.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
      s.payments[p.id] = p;
      this.remember(s, "pay", input.idempotencyKey, p.id);
      return { payment: p, created: true };
    });
    if (created) await this.emit(declined ? "payment.failed" : "payment.succeeded", payment);
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

  async refundPayment(paymentId: string, amount?: number, opts: OperationOptions = {}): Promise<Payment> {
    const { payment, changed } = this.update((s) => {
      const p = getOrThrow(s.payments, paymentId);
      if (this.idem(s, "refund", opts.idempotencyKey)) return { payment: p, changed: false };
      if (p.status !== "succeeded" && p.status !== "partially_refunded") {
        throw new PaymentError(`Cannot refund a payment that is ${p.status}`, "invalid_state");
      }
      const refund = amount ?? p.amount - p.refundedAmount;
      assertAmount(refund);
      if (p.refundedAmount + refund > p.amount) throw new PaymentError("Refund exceeds payment", "invalid_amount");
      p.refundedAmount += refund;
      p.status = p.refundedAmount === p.amount ? "refunded" : "partially_refunded";
      this.remember(s, "refund", opts.idempotencyKey, p.id);
      return { payment: p, changed: true };
    });
    if (changed) await this.emit("payment.refunded", payment);
    return payment;
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    assertAmount(input.amount);
    if (input.paymentMethod === DECLINED) throw new PaymentError("Card declined", "declined");
    const { hold, created } = this.update((s) => {
      const prior = this.idem(s, "hold", input.idempotencyKey);
      if (prior && s.holds[prior]) return { hold: s.holds[prior], created: false };
      const h: DepositHold = {
        id: `hold_fake_${randomUUID()}`,
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        status: "held",
        capturedAmount: 0,
        expiresAt: input.expiresAt.toISOString(),
        metadata: input.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
      s.holds[h.id] = h;
      this.remember(s, "hold", input.idempotencyKey, h.id);
      return { hold: h, created: true };
    });
    if (created) await this.emit("deposit.held", hold);
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

  async captureDeposit(holdId: string, amount?: number, opts: OperationOptions = {}): Promise<DepositHold> {
    const { hold, changed } = this.update((s) => {
      const h = getOrThrow(s.holds, holdId);
      if (this.idem(s, "capture", opts.idempotencyKey)) return { hold: h, changed: false };
      if (h.status !== "held") throw new PaymentError(`Cannot capture a hold that is ${h.status}`, "invalid_state");
      const capture = amount ?? h.amount;
      assertAmount(capture);
      if (capture > h.amount) throw new PaymentError("Capture exceeds hold", "invalid_amount");
      h.status = "captured";
      h.capturedAmount = capture;
      this.remember(s, "capture", opts.idempotencyKey, h.id);
      return { hold: h, changed: true };
    });
    if (changed) await this.emit("deposit.captured", hold);
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

  private idem(s: State, scope: string, key?: string): string | undefined {
    return key ? s.idempotency?.[`${scope}:${key}`] : undefined;
  }

  private remember(s: State, scope: string, key: string | undefined, id: string) {
    if (!key) return;
    s.idempotency ??= {};
    s.idempotency[`${scope}:${key}`] = id;
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
        signal: AbortSignal.timeout(this.opts.webhookTimeoutMs ?? 5000),
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
    mkdirSync(dirname(this.opts.stateFile), { recursive: true });
    const release = acquireLock(`${this.opts.stateFile}.lock`);
    try {
      const state = this.read();
      const result = fn(state);
      const tmp = `${this.opts.stateFile}.${process.pid}.${randomUUID()}.tmp`;
      writeFileSync(tmp, JSON.stringify(state, null, 2));
      renameSync(tmp, this.opts.stateFile);
      return result;
    } finally {
      release();
    }
  }
}

// Cross-process lock via an exclusively created file. Stale locks (> 10 s) are broken.
function acquireLock(path: string): () => void {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      closeSync(fd);
      return () => {
        try {
          unlinkSync(path);
        } catch {
          /* already gone */
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      try {
        if (Date.now() - statSync(path).mtimeMs > 10_000) unlinkSync(path);
      } catch {
        /* raced with the owner */
      }
      if (Date.now() > deadline) throw new PaymentError("Fake payment state is locked", "provider_error");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
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
