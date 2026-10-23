"use client";

import { useState, useTransition } from "react";
import type { ChangeDatesInput, ChangeQuoteResult, ChangeResult } from "@/app/my-rentals/[id]/actions";
import { formatAED } from "@/components/format";
import { PriceBreakdown } from "@/components/price-breakdown";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

export function ChangeDatesForm({
  initial,
  minDate,
  confirmed,
  provider,
  idempotencyKey,
  quoteAction,
  confirmAction,
}: {
  initial: ChangeDatesInput;
  minDate: string;
  /** CONFIRMED (paid) bookings may need a top-up payment. */
  confirmed: boolean;
  provider: string;
  idempotencyKey: string;
  quoteAction: (input: ChangeDatesInput) => Promise<ChangeQuoteResult>;
  confirmAction: (input: ChangeDatesInput & { paymentMethod?: string; idempotencyKey: string }) => Promise<ChangeResult>;
}) {
  const [values, setValues] = useState<ChangeDatesInput>(initial);
  const [quote, setQuote] = useState<ChangeQuoteResult | null>(null);
  const [done, setDone] = useState<ChangeResult | null>(null);
  const [paymentMethod, setPaymentMethod] = useState(provider === "fake" ? "pm_fake_success" : "pm_card_visa");
  const [pending, start] = useTransition();

  const set = (k: keyof ChangeDatesInput) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setValues((v) => ({ ...v, [k]: e.target.value }));
    setQuote(null);
    setDone(null);
  };

  const unchanged =
    values.pickupDate === initial.pickupDate &&
    values.pickupTime === initial.pickupTime &&
    values.returnDate === initial.returnDate &&
    values.returnTime === initial.returnTime;
  const canConfirm = quote?.ok && quote.available && !unchanged;
  const needsPayment = Boolean(confirmed && quote?.ok && quote.differenceFils > 0);

  return (
    <div className="space-y-4" data-testid="change-dates">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          setDone(null);
          start(async () => setQuote(await quoteAction(values)));
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <fieldset className="grid grid-cols-[1fr_8.5rem] gap-2">
            <legend className="sr-only">New pick-up</legend>
            <div className="space-y-1.5">
              <Label htmlFor="newPickupDate">New pick-up date</Label>
              <Input id="newPickupDate" type="date" required min={minDate} value={values.pickupDate} onChange={set("pickupDate")} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newPickupTime">Time</Label>
              <Input id="newPickupTime" type="time" step={1800} required value={values.pickupTime} onChange={set("pickupTime")} />
            </div>
          </fieldset>
          <fieldset className="grid grid-cols-[1fr_8.5rem] gap-2">
            <legend className="sr-only">New return</legend>
            <div className="space-y-1.5">
              <Label htmlFor="newReturnDate">New return date</Label>
              <Input
                id="newReturnDate"
                type="date"
                required
                min={values.pickupDate || minDate}
                value={values.returnDate}
                onChange={set("returnDate")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="newReturnTime">Time</Label>
              <Input id="newReturnTime" type="time" step={1800} required value={values.returnTime} onChange={set("returnTime")} />
            </div>
          </fieldset>
        </div>
        {unchanged ? <p className="text-sm text-muted">Change the dates or times above to see the new price.</p> : null}
        <Button type="submit" variant="secondary" disabled={pending || unchanged}>
          {pending && !quote ? <Spinner className="size-4" /> : null}
          Check new price
        </Button>
      </form>

      <div aria-live="polite" className="space-y-4">
        {quote && !quote.ok ? <Alert tone="error">{quote.message}</Alert> : null}
        {quote?.ok && !quote.available ? (
          <Alert tone="error" title="Not available">
            {quote.message ?? "The car is not available for these dates."}
          </Alert>
        ) : null}
        {quote?.ok && quote.available ? (
          <div className="space-y-4 rounded-lg border border-line p-4">
            <PriceBreakdown quote={quote.quote} title="New price" />
            <p className="text-sm font-medium" data-testid="change-difference">
              {quote.differenceFils > 0
                ? `Difference to pay: ${formatAED(quote.differenceFils)}`
                : quote.differenceFils < 0
                  ? `New price is ${formatAED(-quote.differenceFils)} lower. Refunds apply when you change 48 hours or more before the original pick-up.`
                  : "No change in price."}
            </p>
            {needsPayment ? (
              <div className="space-y-1.5">
                <Label htmlFor="changePaymentMethod">Card for the difference</Label>
                <Select id="changePaymentMethod" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {provider === "fake" ? (
                    <>
                      <option value="pm_fake_success">Test Visa ending 4242 (approved)</option>
                      <option value="pm_fake_declined">Test card ending 0002 (declined)</option>
                    </>
                  ) : (
                    <>
                      <option value="pm_card_visa">Visa (pm_card_visa)</option>
                      <option value="pm_card_chargeDeclined">Declined (pm_card_chargeDeclined)</option>
                    </>
                  )}
                </Select>
              </div>
            ) : null}
          </div>
        ) : null}
        {done ? (
          <Alert tone={done.ok ? "success" : "error"} testId={done.ok ? "change-success" : "change-error"}>
            {done.message}
          </Alert>
        ) : null}
        {canConfirm && !done?.ok ? (
          <Button
            disabled={pending}
            onClick={() =>
              start(async () => {
                const result = await confirmAction({
                  ...values,
                  paymentMethod: needsPayment ? paymentMethod : undefined,
                  idempotencyKey: `${idempotencyKey}-${values.pickupDate}${values.pickupTime}${values.returnDate}${values.returnTime}-${paymentMethod}`,
                });
                setDone(result);
                if (result.ok) setQuote(null);
              })
            }
          >
            {pending ? <Spinner className="size-4" /> : null}
            {needsPayment && quote?.ok ? `Pay ${formatAED(quote.differenceFils)} and change dates` : "Confirm new dates"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
