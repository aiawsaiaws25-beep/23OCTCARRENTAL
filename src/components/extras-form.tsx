"use client";

import { useActionState, useState, useTransition } from "react";
import { previewQuoteAction, startBookingAction, type StartBookingState } from "@/app/book/actions";
import { formatAED } from "@/components/format";
import { PriceBreakdown, type QuoteView } from "@/components/price-breakdown";
import type { TripParams } from "@/components/search-params";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { SubmitButton } from "@/components/ui/submit-button";

export type ExtraOption = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceFils: number;
  maxPriceFils: number | null;
  per: "day" | "rental";
  maxQuantity: number;
};

const icons: Record<string, string> = {
  CHILD_SEAT: "M12 3a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm-5 9h10l-1 9H8l-1-9z",
  GPS: "M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7zm0 4a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  ADDITIONAL_DRIVER:
    "M9 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm7 1a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5zM3 20c0-3 3-5 6-5s6 2 6 5H3zm13-5c2.5 0 5 1.5 5 4h-4",
  FULL_INSURANCE: "M12 2l8 3v6c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V5l8-3z",
};

function priceLabel(e: ExtraOption) {
  const base = `${formatAED(e.priceFils)} ${e.per === "day" ? "per day" : "per rental"}`;
  return e.maxPriceFils ? `${base}, max ${formatAED(e.maxPriceFils)}` : base;
}

export function ExtrasForm({
  vehicleId,
  trip,
  extras,
  initialSelection,
  initialQuote,
  initialError,
  idempotencyKey,
}: {
  vehicleId: string;
  trip: TripParams;
  extras: ExtraOption[];
  initialSelection: Record<string, number>;
  initialQuote: QuoteView | null;
  initialError: string | null;
  idempotencyKey: string;
}) {
  const [selection, setSelection] = useState<Record<string, number>>(initialSelection);
  const [quote, setQuote] = useState<QuoteView | null>(initialQuote);
  const [quoteError, setQuoteError] = useState<string | null>(initialError);
  const [repricing, startRepricing] = useTransition();
  const [bookState, bookAction] = useActionState<StartBookingState, FormData>(startBookingAction, {});

  function update(extraId: string, quantity: number) {
    const next = { ...selection, [extraId]: quantity };
    setSelection(next);
    startRepricing(async () => {
      const result = await previewQuoteAction({
        vehicleId,
        trip,
        extras: Object.entries(next).map(([id, q]) => ({ extraId: id, quantity: q })),
      });
      if (result.ok) {
        setQuote(result.quote);
        setQuoteError(null);
      } else {
        setQuoteError(result.message);
      }
    });
  }

  const selected = Object.entries(selection).filter(([, q]) => q > 0);

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section aria-labelledby="extras-heading" className="min-w-0">
        <h1 id="extras-heading" className="text-2xl font-bold tracking-tight">
          Add extras
        </h1>
        <p className="mt-1 text-muted">Optional. You can review everything before paying.</p>
        <ul className="mt-6 space-y-3">
          {extras.map((e) => {
            const qty = selection[e.id] ?? 0;
            const inputId = `extra-${e.code}`;
            return (
              <li key={e.id} data-testid="extra-option" data-code={e.code}>
                <div
                  className={`flex items-start gap-4 rounded-xl border bg-white p-4 shadow-sm ${qty > 0 ? "border-brand-600 ring-1 ring-brand-600" : "border-line"}`}
                >
                  <span className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-700" aria-hidden="true">
                    <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
                      <path d={icons[e.code] ?? icons.GPS} />
                    </svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    {e.maxQuantity > 1 ? (
                      <label htmlFor={inputId} className="font-semibold">
                        {e.name}
                      </label>
                    ) : (
                      <label htmlFor={inputId} className="font-semibold">
                        {e.name}
                      </label>
                    )}
                    {e.description ? <p className="mt-0.5 text-sm text-muted">{e.description}</p> : null}
                    <p className="mt-1 text-sm font-medium">{priceLabel(e)}</p>
                  </div>
                  <div className="shrink-0">
                    {e.maxQuantity > 1 ? (
                      <Select
                        id={inputId}
                        className="w-20"
                        value={qty}
                        onChange={(ev) => update(e.id, Number(ev.target.value))}
                        aria-label={`${e.name} quantity`}
                      >
                        {Array.from({ length: e.maxQuantity + 1 }, (_, i) => (
                          <option key={i} value={i}>
                            {i}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <input
                        id={inputId}
                        type="checkbox"
                        className="mt-1 size-6 rounded accent-brand-600"
                        checked={qty > 0}
                        onChange={(ev) => update(e.id, ev.target.checked ? 1 : 0)}
                      />
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card>
          <CardBody className="space-y-4">
            <div aria-live="polite" aria-busy={repricing}>
              {repricing ? (
                <p className="mb-2 flex items-center gap-2 text-sm text-muted">
                  <Spinner className="size-4" /> Updating price…
                </p>
              ) : null}
              {quoteError ? (
                <Alert tone="error" title="Can't price this trip" testId="quote-error">
                  {quoteError}
                </Alert>
              ) : null}
              {quote ? <PriceBreakdown quote={quote} /> : null}
            </div>
            <form action={bookAction} className="space-y-3">
              <input type="hidden" name="vehicleId" value={vehicleId} />
              <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
              {Object.entries(trip).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              {selected.map(([id, q]) => (
                <input key={id} type="hidden" name="extra" value={`${id}:${q}`} />
              ))}
              {bookState.message ? (
                <Alert tone="error" testId="booking-error">
                  {bookState.message}
                </Alert>
              ) : null}
              <SubmitButton
                size="lg"
                className="w-full"
                disabled={!quote || Boolean(quoteError) || repricing}
                pendingLabel="Reserving your car…"
              >
                Continue to driver details
              </SubmitButton>
              <p className="text-xs text-muted">
                We hold the car for you for 15 minutes while you complete your details and payment.
              </p>
            </form>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}
