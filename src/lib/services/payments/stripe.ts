import Stripe from "stripe";
import {
  type CreatePaymentInput,
  type DepositHold,
  type DepositHoldStatus,
  type HoldDepositInput,
  type OperationOptions,
  type Payment,
  PaymentError,
  type PaymentProvider,
  type WebhookEvent,
} from "./types";

export type StripeOptions = { secretKey: string; webhookSecret: string; client?: Stripe };

/**
 * Stripe test-mode adapter (selected by PAYMENTS_PROVIDER=stripe).
 *
 * - Rental charges are PaymentIntents confirmed server-side with a PaymentMethod id
 *   (test mode: "pm_card_visa", "pm_card_chargeDeclined", ...). Redirect-based
 *   methods are disabled; a card needing 3-D Secure comes back as "pending"
 *   (requires_action), which a production checkout would complete with Stripe.js.
 * - Deposits are PaymentIntents with capture_method "manual": an authorisation
 *   that is later released (cancel) or captured (fully or partly).
 * - Every create/refund/capture call passes an Idempotency-Key.
 * - Webhooks are verified with STRIPE_WEBHOOK_SECRET and mapped to our event types.
 *
 * NOT live-tested yet: no Stripe account is connected to this project.
 */
export class StripePaymentProvider implements PaymentProvider {
  readonly name = "stripe";
  readonly signatureHeader = "stripe-signature";
  private readonly stripe: Stripe;

  constructor(private readonly opts: StripeOptions) {
    this.stripe = opts.client ?? new Stripe(opts.secretKey, { maxNetworkRetries: 2, appInfo: { name: "DriveEasy" } });
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    try {
      const pi = await this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: input.paymentMethod ?? "pm_card_visa",
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: { ...input.metadata, kind: input.metadata?.kind ?? "payment" },
        },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      );
      return toPayment(pi);
    } catch (err) {
      return this.declinedPayment(err, input);
    }
  }

  async cancelPayment(paymentId: string): Promise<Payment> {
    return toPayment(await this.call(() => this.stripe.paymentIntents.cancel(paymentId)));
  }

  async refundPayment(paymentId: string, amount?: number, opts: OperationOptions = {}): Promise<Payment> {
    await this.call(() =>
      this.stripe.refunds.create(
        { payment_intent: paymentId, ...(amount ? { amount } : {}) },
        opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
      ),
    );
    const pi = await this.call(() => this.stripe.paymentIntents.retrieve(paymentId, { expand: ["latest_charge"] }));
    return toPayment(pi);
  }

  async holdDeposit(input: HoldDepositInput): Promise<DepositHold> {
    const pi = await this.call(() =>
      this.stripe.paymentIntents.create(
        {
          amount: input.amount,
          currency: input.currency.toLowerCase(),
          payment_method: input.paymentMethod ?? "pm_card_visa",
          capture_method: "manual",
          confirm: true,
          automatic_payment_methods: { enabled: true, allow_redirects: "never" },
          metadata: { ...input.metadata, kind: "deposit", expires_at: input.expiresAt.toISOString() },
        },
        input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined,
      ),
    );
    if (pi.status !== "requires_capture") {
      throw new PaymentError(`Deposit authorisation failed (${pi.status})`, "declined");
    }
    return toHold(pi);
  }

  async releaseDeposit(holdId: string): Promise<DepositHold> {
    return toHold(await this.call(() => this.stripe.paymentIntents.cancel(holdId)));
  }

  async captureDeposit(holdId: string, amount?: number, opts: OperationOptions = {}): Promise<DepositHold> {
    return toHold(
      await this.call(() =>
        this.stripe.paymentIntents.capture(
          holdId,
          amount ? { amount_to_capture: amount } : {},
          opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
        ),
      ),
    );
  }

  async listHolds(filter: { status?: DepositHoldStatus; expiresBefore?: Date }): Promise<DepositHold[]> {
    const statusQuery =
      filter.status === "held" ? " AND status:'requires_capture'" : filter.status === "released" ? " AND status:'canceled'" : "";
    const holds: DepositHold[] = [];
    for await (const pi of this.stripe.paymentIntents.search({ query: `metadata['kind']:'deposit'${statusQuery}`, limit: 100 })) {
      const hold = toHold(pi);
      if (filter.status && hold.status !== filter.status) continue;
      if (filter.expiresBefore && new Date(hold.expiresAt) > filter.expiresBefore) continue;
      holds.push(hold);
    }
    return holds;
  }

  verifyWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent {
    if (!signatureHeader) throw new PaymentError("Missing webhook signature", "bad_signature");
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signatureHeader, this.opts.webhookSecret);
    } catch {
      throw new PaymentError("Invalid webhook signature", "bad_signature");
    }
    return mapEvent(event);
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Stripe.errors.StripeCardError) throw new PaymentError(err.message, "declined");
      if (err instanceof Stripe.errors.StripeInvalidRequestError) throw new PaymentError(err.message, "invalid_state");
      throw new PaymentError((err as Error).message, "provider_error");
    }
  }

  private declinedPayment(err: unknown, input: CreatePaymentInput): Payment {
    if (err instanceof Stripe.errors.StripeCardError) {
      const pi = (err.raw as { payment_intent?: Stripe.PaymentIntent }).payment_intent;
      return {
        id: pi?.id ?? `pi_declined_${Date.now()}`,
        amount: input.amount,
        currency: input.currency.toLowerCase(),
        status: "failed",
        refundedAmount: 0,
        failureReason: err.decline_code ?? err.code ?? "card_declined",
        metadata: input.metadata ?? {},
        createdAt: new Date().toISOString(),
      };
    }
    if (err instanceof Stripe.errors.StripeError) throw new PaymentError(err.message, "provider_error");
    throw err;
  }
}

function refundedOf(pi: Stripe.PaymentIntent): number {
  const charge = pi.latest_charge;
  return charge && typeof charge === "object" ? charge.amount_refunded : 0;
}

function toPayment(pi: Stripe.PaymentIntent): Payment {
  const refunded = refundedOf(pi);
  const status: Payment["status"] =
    pi.status === "succeeded"
      ? refunded >= pi.amount
        ? "refunded"
        : refunded > 0
          ? "partially_refunded"
          : "succeeded"
      : pi.status === "canceled"
        ? "canceled"
        : pi.status === "requires_payment_method"
          ? "failed"
          : "pending";
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status,
    refundedAmount: refunded,
    failureReason: pi.last_payment_error?.decline_code ?? pi.last_payment_error?.code ?? undefined,
    metadata: (pi.metadata ?? {}) as Record<string, string>,
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}

function toHold(pi: Stripe.PaymentIntent): DepositHold {
  const status: DepositHoldStatus = pi.status === "requires_capture" ? "held" : pi.status === "succeeded" ? "captured" : "released";
  return {
    id: pi.id,
    amount: pi.amount,
    currency: pi.currency,
    status,
    capturedAmount: pi.amount_received ?? 0,
    expiresAt: pi.metadata?.expires_at ?? new Date((pi.created + 7 * 86400) * 1000).toISOString(),
    metadata: (pi.metadata ?? {}) as Record<string, string>,
    createdAt: new Date(pi.created * 1000).toISOString(),
  };
}

function mapEvent(event: Stripe.Event): WebhookEvent {
  const base = { id: event.id, createdAt: new Date(event.created * 1000).toISOString() };
  const obj = event.data.object as unknown;
  switch (event.type) {
    case "payment_intent.succeeded": {
      const pi = obj as Stripe.PaymentIntent;
      return pi.metadata?.kind === "deposit"
        ? { ...base, type: "deposit.captured", data: toHold(pi) }
        : { ...base, type: "payment.succeeded", data: toPayment(pi) };
    }
    case "payment_intent.amount_capturable_updated":
      return { ...base, type: "deposit.held", data: toHold(obj as Stripe.PaymentIntent) };
    case "payment_intent.payment_failed":
      return { ...base, type: "payment.failed", data: { ...toPayment(obj as Stripe.PaymentIntent), status: "failed" } };
    case "payment_intent.canceled": {
      const pi = obj as Stripe.PaymentIntent;
      return pi.metadata?.kind === "deposit"
        ? { ...base, type: "deposit.released", data: toHold(pi) }
        : { ...base, type: "payment.canceled", data: toPayment(pi) };
    }
    case "charge.refunded": {
      const ch = obj as Stripe.Charge;
      const piId = typeof ch.payment_intent === "string" ? ch.payment_intent : (ch.payment_intent?.id ?? ch.id);
      return {
        ...base,
        type: "payment.refunded",
        data: {
          id: piId,
          amount: ch.amount,
          currency: ch.currency,
          status: ch.amount_refunded >= ch.amount ? "refunded" : "partially_refunded",
          refundedAmount: ch.amount_refunded,
          metadata: (ch.metadata ?? {}) as Record<string, string>,
          createdAt: new Date(ch.created * 1000).toISOString(),
        },
      };
    }
    default:
      return { ...base, type: "unsupported", data: { id: "", amount: 0, currency: "", status: "pending", refundedAmount: 0, metadata: { stripeType: event.type }, createdAt: base.createdAt } };
  }
}
