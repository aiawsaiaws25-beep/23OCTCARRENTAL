import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { formatAED, formatDateTime, zonedParts } from "@/components/format";
import { FuelSelect, fuelLabel } from "@/components/fuel";
import { PriceBreakdown } from "@/components/price-breakdown";
import { nowMs } from "@/components/search-params";
import { ReservationStatusBadge, StatusBadge } from "@/components/status-badge";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { adminGetReservation, adminGetVehicle, listAuditLogs } from "@/server/admin";
import { listBranches } from "@/server/catalog";
import { adminActor } from "../../_lib/data";
import { DamageForm, DamageReportCard } from "../../_lib/damage-ui";
import { AdminPage } from "../../_lib/gate";
import { adminCancelAction, checkInAction, checkOutAction } from "./actions";

export const metadata: Metadata = { title: "Reservation" };

async function Detail({ params }: { params: PageProps<"/admin/reservations/[id]">["params"] }) {
  const { id } = await params;
  const actor = await adminActor(`/admin/reservations/${id}`);
  const r = await adminGetReservation(actor, id);
  if (!r) notFound();
  const [vehicle, branches, audit] = await Promise.all([
    adminGetVehicle(actor, r.vehicle.id),
    listBranches({ includeInactive: true }),
    listAuditLogs(actor, { entityType: "reservation", entityId: r.id, limit: 20 }),
  ]);
  const name = `${r.vehicle.make} ${r.vehicle.model}`;
  const now = zonedParts(new Date(nowMs()), r.returnBranch.timeZone);
  const a = r.agreement;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <Link href="/admin/reservations" className="text-sm text-muted underline">
            All reservations
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            <span className="font-mono" data-testid="reservation-ref">
              {r.reference}
            </span>
          </h1>
          <p className="text-muted">
            {name} ({r.vehicle.plateNumber}) for {r.customer.name}
          </p>
        </div>
        <ReservationStatusBadge status={r.status} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Booking</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted">Pick-up</dt>
                  <dd>
                    {r.pickupBranch.name}
                    <br />
                    {formatDateTime(r.pickupAt, r.pickupBranch.timeZone)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Return</dt>
                  <dd>
                    {r.returnBranch.name}
                    <br />
                    {formatDateTime(r.returnAt, r.returnBranch.timeZone)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Customer</dt>
                  <dd>
                    {r.customer.name}
                    <br />
                    <a className="text-brand-700 underline" href={`mailto:${r.customer.email}`}>
                      {r.customer.email}
                    </a>
                    {r.customer.phone ? <> · {r.customer.phone}</> : null}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Main driver</dt>
                  <dd>
                    {r.driver ? (
                      <>
                        {r.driver.fullName}, born {r.driver.dateOfBirth}
                        <br />
                        Licence {r.driver.licenceNumber} ({r.driver.licenceCountry}), expires {r.driver.licenceExpiry}
                      </>
                    ) : (
                      "Not provided"
                    )}
                  </dd>
                  <dd className="mt-1">
                    {r.licenceFileUrl ? (
                      <a href={r.licenceFileUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-brand-700 underline">
                        View licence document<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="text-amber-900">No licence document uploaded</span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Payment</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    {r.payment ? (
                      <>
                        <StatusBadge status={r.payment.status} /> {formatAED(r.payment.amountFils)}
                        {r.payment.refundedFils ? ` (refunded ${formatAED(r.payment.refundedFils)})` : ""}
                      </>
                    ) : (
                      "None"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Deposit</dt>
                  <dd className="flex flex-wrap items-center gap-2">
                    {r.deposit ? (
                      <>
                        <StatusBadge status={r.deposit.status} /> {formatAED(r.deposit.amountFils)}
                        {r.deposit.capturedFils ? ` (captured ${formatAED(r.deposit.capturedFils)})` : ""}
                      </>
                    ) : (
                      "None"
                    )}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {a ? (
            <Card>
              <CardHeader>
                <CardTitle>Rental agreement {a.agreementNumber}</CardTitle>
              </CardHeader>
              <CardBody>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-muted">Checked out</dt>
                    <dd>
                      {formatDateTime(a.pickupAt, r.pickupBranch.timeZone)} · {a.pickupMileageKm.toLocaleString("en-AE")} km · fuel{" "}
                      {fuelLabel(a.pickupFuelEighths)}
                    </dd>
                  </div>
                  {a.returnAt ? (
                    <div>
                      <dt className="text-muted">Checked in</dt>
                      <dd>
                        {formatDateTime(a.returnAt, r.returnBranch.timeZone)} · {a.returnMileageKm?.toLocaleString("en-AE")} km · fuel{" "}
                        {fuelLabel(a.returnFuelEighths)}
                        {a.returnMileageKm != null ? ` · driven ${(a.returnMileageKm - a.pickupMileageKm).toLocaleString("en-AE")} km` : ""}
                      </dd>
                    </div>
                  ) : null}
                  {a.returnAt ? (
                    <div className="sm:col-span-2" data-testid="return-charges">
                      <dt className="text-muted">Return charges</dt>
                      <dd>
                        Late {a.lateMinutes} min: {formatAED(a.lateFeeFils)} · Fuel {formatAED(a.fuelChargeFils)} · Damage{" "}
                        {formatAED(a.damageChargeFils)} · VAT {formatAED(a.extraChargesVatFils)} · From deposit{" "}
                        {formatAED(a.depositCapturedFils)} · Outstanding {formatAED(a.outstandingFils)}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              </CardBody>
            </Card>
          ) : null}

          {r.status === "CONFIRMED" ? (
            <Card>
              <CardHeader>
                <CardTitle>Check-out (hand over the car)</CardTitle>
              </CardHeader>
              <CardBody>
                {!r.driver || !r.licenceFileUrl ? (
                  <Alert tone="warning" className="mb-4">
                    Check the driver&apos;s licence in person before handing over the car.
                  </Alert>
                ) : null}
                <ActionForm action={checkOutAction.bind(null, r.id)} submitLabel="Check out" pendingLabel="Checking out…" testId="checkout-form">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="out-mileage" label="Odometer (km)" hint={vehicle ? `Last recorded: ${vehicle.mileageKm.toLocaleString("en-AE")} km` : undefined}>
                      {(p) => <Input {...p} name="mileageKm" type="number" inputMode="numeric" min={vehicle?.mileageKm ?? 0} required defaultValue={vehicle?.mileageKm} />}
                    </Field>
                    <Field id="out-fuel" label="Fuel level">
                      {(p) => <FuelSelect {...p} name="fuelEighths" defaultValue="8" />}
                    </Field>
                    <Field id="out-notes" label="Notes" hint="Optional" className="sm:col-span-2">
                      {(p) => <Textarea {...p} name="notes" />}
                    </Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {r.status === "PICKED_UP" && a ? (
            <Card>
              <CardHeader>
                <CardTitle>Check-in (car returned)</CardTitle>
              </CardHeader>
              <CardBody>
                <p className="mb-4 text-sm text-muted">
                  Record any damage below first: damage charges are included at check-in. Late returns are charged after 59 minutes;
                  missing fuel is charged per eighth.
                </p>
                <ActionForm action={checkInAction.bind(null, r.id)} submitLabel="Check in" pendingLabel="Checking in…" testId="checkin-form">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="in-mileage" label="Odometer (km)" hint={`At pick-up: ${a.pickupMileageKm.toLocaleString("en-AE")} km`}>
                      {(p) => <Input {...p} name="mileageKm" type="number" inputMode="numeric" min={a.pickupMileageKm} required />}
                    </Field>
                    <Field id="in-fuel" label="Fuel level" hint={`At pick-up: ${fuelLabel(a.pickupFuelEighths)}`}>
                      {(p) => <FuelSelect {...p} name="fuelEighths" defaultValue={String(a.pickupFuelEighths)} />}
                    </Field>
                    <Field id="in-date" label="Returned on" hint={`Due ${formatDateTime(r.returnAt, r.returnBranch.timeZone)}`}>
                      {(p) => <Input {...p} name="returnedDate" type="date" required defaultValue={now.date} />}
                    </Field>
                    <Field id="in-time" label="Returned at (local time)">
                      {(p) => <Input {...p} name="returnedTime" type="time" required defaultValue={now.time} />}
                    </Field>
                    <Field id="in-branch" label="Returned to branch">
                      {(p) => (
                        <Select {...p} name="returnBranchId" defaultValue={r.returnBranch.id}>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field id="in-notes" label="Notes" hint="Optional">
                      {(p) => <Textarea {...p} name="notes" />}
                    </Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>Damage reports</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              {r.damageReports.length ? (
                r.damageReports.map((d) => <DamageReportCard key={d.id} d={d} />)
              ) : (
                <p className="text-sm text-muted">No damage reported for this rental.</p>
              )}
              {r.status !== "CANCELLED" && r.status !== "EXPIRED" && r.status !== "PENDING" ? (
                <details key={r.status} className="rounded-lg border border-line p-4" open={r.status === "PICKED_UP"}>
                  <summary className="cursor-pointer font-medium">Report damage</summary>
                  <div className="mt-4">
                    <DamageForm
                      vehicleId={r.vehicle.id}
                      reservationId={r.id}
                      defaultStage={r.status === "CONFIRMED" ? "PICKUP" : "RETURN"}
                    />
                  </div>
                </details>
              ) : null}
            </CardBody>
          </Card>

          {r.status === "CONFIRMED" || r.status === "PENDING" ? (
            <Card>
              <CardHeader>
                <CardTitle>Cancel reservation</CardTitle>
              </CardHeader>
              <CardBody>
                <ActionForm action={adminCancelAction.bind(null, r.id)} submitLabel="Cancel reservation" variant="danger" pendingLabel="Cancelling…">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="cancel-fee" label="Cancellation fee (AED)" hint="Leave empty to apply the standard policy. 0 = full refund.">
                      {(p) => <Input {...p} name="feeAed" inputMode="decimal" pattern="\d+(\.\d{1,2})?" />}
                    </Field>
                    <Field id="cancel-reason" label="Reason" hint="Optional">
                      {(p) => <Input {...p} name="reason" />}
                    </Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}

          {audit.length ? (
            <Card>
              <CardHeader>
                <CardTitle>History</CardTitle>
              </CardHeader>
              <CardBody>
                <ol className="space-y-2 text-sm">
                  {audit.map((e) => (
                    <li key={e.id} className="flex flex-wrap justify-between gap-2">
                      <span>
                        <span className="font-medium">{e.action}</span> by {e.actorName ?? "system"}
                      </span>
                      <span className="text-muted">{formatDateTime(e.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody>
              <PriceBreakdown quote={r.quote} title="Booking price" totalLabel="Total" />
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}

export default function AdminReservationPage({ params }: PageProps<"/admin/reservations/[id]">) {
  return (
    <AdminPage path="/admin/reservations">
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <Detail params={params} />
      </Suspense>
    </AdminPage>
  );
}
