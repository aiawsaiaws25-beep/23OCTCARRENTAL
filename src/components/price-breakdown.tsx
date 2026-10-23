import { formatAED, pluralize } from "@/components/format";

/** Structural subset of the server quote. Every number comes from the server; nothing is computed here. */
export type QuoteView = {
  days: number;
  dailyRateFils: number;
  baseFils: number;
  seasonalAdjustmentFils?: number;
  durationDiscountFils?: number;
  extras: { extraId: string; name: string; quantity: number; totalFils: number }[];
  oneWayFeeFils: number;
  vatRateBps: number;
  vatFils: number;
  totalFils: number;
  depositFils: number;
};

function Row({ label, value, testId, strong }: { label: string; value: string; testId: string; strong?: boolean }) {
  return (
    <div className={strong ? "flex justify-between gap-4 pt-1 text-base font-semibold" : "flex justify-between gap-4"}>
      <dt className={strong ? "text-ink" : "text-muted"}>{label}</dt>
      <dd data-testid={testId} className="tabular-nums text-ink">
        {value}
      </dd>
    </div>
  );
}

export function PriceBreakdown({
  quote,
  title = "Price breakdown",
  totalLabel = "Total to pay",
}: {
  quote: QuoteView;
  title?: string;
  totalLabel?: string;
}) {
  const vatPercent = quote.vatRateBps / 100;
  return (
    <section aria-label={title} data-testid="price-breakdown" className="text-sm">
      <h2 className="text-base font-semibold">{title}</h2>
      <dl className="mt-3 space-y-2">
        <Row label="Daily rate" value={formatAED(quote.dailyRateFils)} testId="price-daily-rate" />
        <Row label="Rental days" value={pluralize(quote.days, "day")} testId="price-days" />
        <Row label={`Rental (${pluralize(quote.days, "day")})`} value={formatAED(quote.baseFils)} testId="price-base" />
        {quote.seasonalAdjustmentFils ? (
          <Row
            label={quote.seasonalAdjustmentFils > 0 ? "Seasonal surcharge" : "Seasonal discount"}
            value={formatAED(quote.seasonalAdjustmentFils)}
            testId="price-seasonal"
          />
        ) : null}
        {quote.durationDiscountFils ? (
          <Row
            label="Long-rental discount"
            value={`−${formatAED(Math.abs(quote.durationDiscountFils))}`}
            testId="price-duration-discount"
          />
        ) : null}
        {quote.extras.map((e) => (
          <Row
            key={e.extraId}
            label={e.quantity > 1 ? `${e.name} × ${e.quantity}` : e.name}
            value={formatAED(e.totalFils)}
            testId="price-extras"
          />
        ))}
        <Row
          label="One-way fee"
          value={quote.oneWayFeeFils > 0 ? formatAED(quote.oneWayFeeFils) : "None"}
          testId="price-one-way-fee"
        />
        <Row label={`VAT (${vatPercent}%)`} value={formatAED(quote.vatFils)} testId="price-vat" />
        <div className="border-t border-line pt-2">
          <Row label={totalLabel} value={formatAED(quote.totalFils)} testId="price-total" strong />
        </div>
      </dl>
      <div className="mt-4 rounded-lg bg-sand-50 px-3 py-2 ring-1 ring-sand-100">
        <dl>
          <Row label="Security deposit (refundable hold)" value={formatAED(quote.depositFils)} testId="price-deposit" />
        </dl>
        <p className="mt-1 text-xs text-muted">
          Held on your card at booking and released after the car is returned without damage. It is not charged.
        </p>
      </div>
    </section>
  );
}
