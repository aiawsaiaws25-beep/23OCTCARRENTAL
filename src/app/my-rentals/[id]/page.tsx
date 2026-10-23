import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { CancelForm } from "@/components/cancel-form";
import { ChangeDatesForm } from "@/components/change-dates-form";
import { formatAED, formatDateTime, zonedParts } from "@/components/format";
import { fuelLabel } from "@/components/fuel";
import { PriceBreakdown } from "@/components/price-breakdown";
import { nowMs, todayIn } from "@/components/search-params";
import { ReservationStatusBadge, StatusBadge } from "@/components/status-badge";
import { VehicleImage } from "@/components/vehicle-card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getEnv } from "@/lib/env";
import { getCancellationQuote, getReservationForUser, type ReservationDetail } from "@/server/reservations";
import { requireUser } from "@/server/session";
import { cancelAction, confirmChangeAction, quoteChangeAction } from "./actions";

export const metadata: Metadata = { title: "Booking" };

async function CancelPanel({ userId, r }: { userId: string; r: ReservationDetail }) {
  const q = await getCancellationQuote(userId, r.id);
  if (!q.ok) return <Alert tone="error">{q.message}</Alert>;
  return (
    <div className="space-y-3 text-sm" data-testid="cancel-panel">
      <p className="text-muted">{q.policySummary}</p>
      {q.eligible ? (
        <>
          <dl className="space-y-1 rounded-lg bg-canvas p-3">
            <div className="flex justify-between gap-4">
              <dt>Paid</dt>
              <dd className="tabular-nums">{formatAED(q.paidFils)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt>Cancellation fee</dt>
              <dd className="tabular-nums" data-testid="cancel-fee">
                {formatAED(q.feeFils)}
              </dd>
            </div>
            <div className="flex justify-between gap-4 font-semibold">
              <dt>You will be refunded</dt>
              <dd className="tabular-nums" data-testid="cancel-refund">
                {formatAED(q.refundFils)}
              </dd>
            </div>
          </dl>
          <p className="text-muted">The security deposit hold is released in full.</p>
          <CancelForm
            action={cancelAction.bind(null, r.id)}
            label={q.refundFils > 0 ? `Cancel booking and refund ${formatAED(q.refundFils)}` : "Cancel booking"}
          />
        </>
      ) : (
        <Alert tone="warning" testId="cancel-not-eligible">
          {q.reason ?? "This booking can't be cancelled online."} Contact {r.pickupBranch.name} on {r.pickupBranch.phone}.
        </Alert>
      )}
    </div>
  );
}

function ChargesCard({ r }: { r: ReservationDetail }) {
  const a = r.agreement;
  if (!a) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Rental agreement {a.agreementNumber}</CardTitle>
      </CardHeader>
      <CardBody>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Picked up</dt>
            <dd>
              {formatDateTime(a.pickupAt, r.pickupBranch.timeZone)}, {a.pickupMileageKm.toLocaleString("en-AE")} km, fuel{" "}
              {fuelLabel(a.pickupFuelEighths)}
            </dd>
          </div>
          {a.returnAt ? (
            <div>
              <dt className="text-muted">Returned</dt>
              <dd>
                {formatDateTime(a.returnAt, r.returnBranch.timeZone)}, {a.returnMileageKm?.toLocaleString("en-AE")} km, fuel{" "}
                {fuelLabel(a.returnFuelEighths)}
              </dd>
            </div>
          ) : null}
          {a.lateFeeFils ? (
            <div>
              <dt className="text-muted">Late return ({a.lateMinutes} min)</dt>
              <dd>{formatAED(a.lateFeeFils)}</dd>
            </div>
          ) : null}
          {a.fuelChargeFils ? (
            <div>
              <dt className="text-muted">Refuelling</dt>
              <dd>{formatAED(a.fuelChargeFils)}</dd>
            </div>
          ) : null}
          {a.damageChargeFils ? (
            <div>
              <dt className="text-muted">Damage</dt>
              <dd>{formatAED(a.damageChargeFils)}</dd>
            </div>
          ) : null}
          {a.extraChargesVatFils ? (
            <div>
              <dt className="text-muted">VAT on additional charges</dt>
              <dd>{formatAED(a.extraChargesVatFils)}</dd>
            </div>
          ) : null}
          {a.depositCapturedFils ? (
            <div>
              <dt className="text-muted">Taken from deposit</dt>
              <dd>{formatAED(a.depositCapturedFils)}</dd>
            </div>
          ) : null}
          {a.outstandingFils ? (
            <div>
              <dt className="text-muted">Outstanding</dt>
              <dd className="font-semibold">{formatAED(a.outstandingFils)}</dd>
            </div>
          ) : null}
        </dl>
      </CardBody>
    </Card>
  );
}

async function BookingView({ params }: { params: PageProps<"/my-rentals/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const user = await requireUser(`/my-rentals/${id}`);
  const r = await getReservationForUser(user.id, id);
  if (!r) notFound();
  const name = `${r.vehicle.make} ${r.vehicle.model}`;
  const changeable = r.status === "CONFIRMED" && r.pickupAt.getTime() > nowMs();
  const p = zonedParts(r.pickupAt, r.pickupBranch.timeZone);
  const ret = zonedParts(r.returnAt, r.returnBranch.timeZone);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/my-rentals" className="text-sm text-muted underline">
            All rentals
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">{name}</h1>
          <p className="text-muted">
            Reference <span className="font-mono text-ink" data-testid="reservation-ref">{r.reference}</span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReservationStatusBadge status={r.status} />
          {r.status === "CONFIRMED" || r.status === "PICKED_UP" ? (
            <ButtonLink href={`/my-rentals/${r.id}/voucher`} size="sm">
              View voucher
            </ButtonLink>
          ) : null}
          {r.status === "PENDING" ? (
            <ButtonLink href={`/checkout/${r.id}`} size="sm">
              Continue to payment
            </ButtonLink>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardBody className="grid gap-4 sm:grid-cols-[200px_1fr]">
              <VehicleImage src={r.vehicle.imageUrl} alt={name} className="rounded-lg" />
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="font-medium">Pick-up</dt>
                  <dd className="text-muted">
                    {r.pickupBranch.name}, {formatDateTime(r.pickupAt, r.pickupBranch.timeZone)}
                  </dd>
                </div>
                <div>
                  <dt className="font-medium">Return</dt>
                  <dd className="text-muted">
                    {r.returnBranch.name}, {formatDateTime(r.returnAt, r.returnBranch.timeZone)}
                  </dd>
                </div>
                {r.driver ? (
                  <div>
                    <dt className="font-medium">Main driver</dt>
                    <dd className="text-muted">
                      {r.driver.fullName}, licence {r.driver.licenceNumber}
                    </dd>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2 pt-1">
                  {r.payment ? (
                    <span className="text-xs">
                      Payment <StatusBadge status={r.payment.status} />
                    </span>
                  ) : null}
                  {r.deposit ? (
                    <span className="text-xs">
                      Deposit <StatusBadge status={r.deposit.status} />
                    </span>
                  ) : null}
                </div>
                {r.refundedFils > 0 ? (
                  <p className="text-sm" data-testid="refunded-amount">
                    Refunded: <span className="font-semibold">{formatAED(r.refundedFils)}</span>
                    {r.cancellationFeeFils ? ` (cancellation fee ${formatAED(r.cancellationFeeFils)})` : ""}
                  </p>
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <ChargesCard r={r} />

          {changeable ? (
            <Card>
              <CardHeader>
                <CardTitle>Change dates</CardTitle>
              </CardHeader>
              <CardBody>
                <ChangeDatesForm
                  initial={{ pickupDate: p.date, pickupTime: p.time, returnDate: ret.date, returnTime: ret.time }}
                  minDate={todayIn(r.pickupBranch.timeZone)}
                  confirmed={r.status === "CONFIRMED"}
                  provider={getEnv().PAYMENTS_PROVIDER}
                  idempotencyKey={crypto.randomUUID()}
                  quoteAction={quoteChangeAction.bind(null, r.id)}
                  confirmAction={confirmChangeAction.bind(null, r.id)}
                />
              </CardBody>
            </Card>
          ) : null}

          {r.status === "CONFIRMED" ? (
            <Card>
              <CardHeader>
                <CardTitle>Cancel booking</CardTitle>
              </CardHeader>
              <CardBody>
                <Suspense fallback={<Skeleton className="h-32" />}>
                  <CancelPanel userId={user.id} r={r} />
                </Suspense>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody>
              <PriceBreakdown quote={r.quote} title={r.status === "PENDING" ? "Price breakdown" : "Your booking price"} totalLabel={r.status === "PENDING" ? "Total to pay" : "Total"} />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export default function BookingPage({ params }: PageProps<"/my-rentals/[id]">) {
  return (
    <Container className="py-8">
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <BookingView params={params} />
      </Suspense>
    </Container>
  );
}
