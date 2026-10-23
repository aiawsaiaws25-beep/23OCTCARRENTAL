// Provider-neutral payments interface. The app only talks to this; the fake
// local provider and the Stripe test-mode adapter both implement it.

export type Money = { amount: number; currency: string }; // amount in minor units (fils for AED)

// "pending" = the provider has not finished (e.g. Stripe "processing" / "requires_action").
export type PaymentStatus = "pending" | "succeeded" | "failed" | "canceled" | "refunded" | "partially_refunded";

export type Payment = Money & {
  id: string;
  status: PaymentStatus;
  refundedAmount: number;
  failureReason?: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type DepositHoldStatus = "held" | "released" | "captured";

export type DepositHold = Money & {
  id: string;
  status: DepositHoldStatus;
  capturedAmount: number;
  expiresAt: string;
  metadata: Record<string, string>;
  createdAt: string;
};

export type WebhookEventType =
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "payment.refunded"
  | "deposit.held"
  | "deposit.released"
  | "deposit.captured"
  | "unsupported"; // provider event we do not act on (acknowledged and ignored)

export type WebhookEvent = {
  id: string; // stable across redeliveries, so handlers can de-duplicate
  type: WebhookEventType;
  createdAt: string;
  data: Payment | DepositHold;
};

export type CreatePaymentInput = Money & {
  // Real providers take a tokenised card here. The fake provider accepts
  // "pm_fake_success" (default) or "pm_fake_declined"; Stripe test mode accepts
  // test PaymentMethods such as "pm_card_visa" or "pm_card_chargeDeclined".
  paymentMethod?: string;
  metadata?: Record<string, string>;
  // Same key => same provider payment; a retried request never charges twice.
  idempotencyKey?: string;
};

export type HoldDepositInput = Money & {
  expiresAt: Date;
  paymentMethod?: string;
  metadata?: Record<string, string>;
  idempotencyKey?: string;
};

export type OperationOptions = { idempotencyKey?: string };

export interface PaymentProvider {
  readonly name: string;
  /** Request header that carries the webhook signature. */
  readonly signatureHeader: string;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  cancelPayment(paymentId: string): Promise<Payment>;
  refundPayment(paymentId: string, amount?: number, opts?: OperationOptions): Promise<Payment>;
  holdDeposit(input: HoldDepositInput): Promise<DepositHold>;
  releaseDeposit(holdId: string): Promise<DepositHold>;
  captureDeposit(holdId: string, amount?: number, opts?: OperationOptions): Promise<DepositHold>;
  listHolds(filter: { status?: DepositHoldStatus; expiresBefore?: Date }): Promise<DepositHold[]>;
  // Throws if the signature is missing, wrong or too old.
  verifyWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "declined" | "invalid_state" | "invalid_amount" | "bad_signature" | "provider_error",
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
