// Provider-neutral payments interface. The app only talks to this; the fake
// local provider and a future real one (e.g. Stripe) both implement it.

export type Money = { amount: number; currency: string }; // amount in minor units (cents)

export type PaymentStatus = "succeeded" | "failed" | "canceled" | "refunded" | "partially_refunded";

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
  | "deposit.captured";

export type WebhookEvent = {
  id: string; // stable across redeliveries, so handlers can de-duplicate
  type: WebhookEventType;
  createdAt: string;
  data: Payment | DepositHold;
};

export type CreatePaymentInput = Money & {
  // Real providers take a tokenised card here. The fake provider accepts
  // "pm_fake_success" (default) or "pm_fake_declined".
  paymentMethod?: string;
  metadata?: Record<string, string>;
};

export type HoldDepositInput = Money & {
  expiresAt: Date;
  paymentMethod?: string;
  metadata?: Record<string, string>;
};

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  cancelPayment(paymentId: string): Promise<Payment>;
  refundPayment(paymentId: string, amount?: number): Promise<Payment>;
  holdDeposit(input: HoldDepositInput): Promise<DepositHold>;
  releaseDeposit(holdId: string): Promise<DepositHold>;
  captureDeposit(holdId: string, amount?: number): Promise<DepositHold>;
  listHolds(filter: { status?: DepositHoldStatus; expiresBefore?: Date }): Promise<DepositHold[]>;
  // Throws if the signature is missing, wrong or too old.
  verifyWebhook(rawBody: string, signatureHeader: string | null): WebhookEvent;
}

export class PaymentError extends Error {
  constructor(
    message: string,
    readonly code: "not_found" | "declined" | "invalid_state" | "invalid_amount" | "bad_signature",
  ) {
    super(message);
    this.name = "PaymentError";
  }
}
