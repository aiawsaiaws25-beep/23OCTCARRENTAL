"use client";

import { useActionState } from "react";
import { formatAED } from "@/components/format";
import { Alert } from "@/components/ui/alert";
import { Field, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export type PayState = {
  status?: "failed" | "expired" | "error";
  message?: string;
};

/**
 * Payment step. Locally the fake provider takes a test payment method; with Stripe this
 * select is replaced by the card element and the same Server Action receives the payment method id.
 */
export function PayForm({
  action,
  totalFils,
  depositFils,
  idempotencyKey,
  disabled,
  lastFailure,
  provider,
}: {
  action: (state: PayState, formData: FormData) => Promise<PayState>;
  totalFils: number;
  depositFils: number;
  idempotencyKey: string;
  disabled?: boolean;
  lastFailure?: string | null;
  provider: string;
}) {
  const [state, formAction] = useActionState(action, {});
  const failure = state.message ?? (lastFailure ? `Your last payment attempt failed: ${lastFailure}` : null);

  return (
    <form action={formAction} className="space-y-4" data-testid="pay-form">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      {provider === "fake" ? (
        <Field
          id="paymentMethod"
          label="Card"
          hint="Test mode: no real card is charged. Choose a test card to simulate an approved or declined payment."
        >
          {(p) => (
            <Select {...p} name="paymentMethod" defaultValue="pm_fake_success">
              <option value="pm_fake_success">Test Visa ending 4242 (approved)</option>
              <option value="pm_fake_declined">Test card ending 0002 (declined)</option>
            </Select>
          )}
        </Field>
      ) : (
        <Field id="paymentMethod" label="Card" hint="Stripe test mode. Use a Stripe test payment method id.">
          {(p) => (
            <Select {...p} name="paymentMethod" defaultValue="pm_card_visa">
              <option value="pm_card_visa">Visa (pm_card_visa)</option>
              <option value="pm_card_chargeDeclined">Declined (pm_card_chargeDeclined)</option>
            </Select>
          )}
        </Field>
      )}
      {failure ? (
        <Alert tone="error" title="Payment not completed" testId="payment-error">
          <p>{failure}</p>
          <p className="mt-1">Nothing has been charged for this attempt. You can try again or use another card.</p>
        </Alert>
      ) : null}
      <SubmitButton size="lg" className="w-full" disabled={disabled} pendingLabel="Processing payment…">
        {failure ? "Try again: " : ""}Pay {formatAED(totalFils)}
      </SubmitButton>
      <p className="text-xs text-muted">
        We charge {formatAED(totalFils)} now and place a refundable hold of {formatAED(depositFils)} for the security deposit.
      </p>
    </form>
  );
}
