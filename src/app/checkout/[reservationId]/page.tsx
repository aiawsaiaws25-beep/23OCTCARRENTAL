import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { formatDateTime } from "@/components/format";
import { HoldCountdown } from "@/components/hold-countdown";
import { PayForm } from "@/components/pay-form";
import { PriceBreakdown } from "@/components/price-breakdown";
import { first } from "@/components/search-params";
import { VehicleImage } from "@/components/vehicle-card";
import { Alert } from "@/components/ui/alert";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { getEnv } from "@/lib/env";
import { ALLOWED_LICENCE_TYPES, MAX_UPLOAD_BYTES, MIN_DRIVER_AGE } from "@/server/policy";
import { getReservationForUser, type ReservationDetail } from "@/server/reservations";
import { requireUser } from "@/server/session";
import { abandonCheckoutAction, payAction, saveDriverAction } from "./actions";

export const metadata: Metadata = { title: "Checkout" };

/** Request-time check (called after connection()). */
function isHoldActive(r: ReservationDetail): boolean {
  return r.status === "PENDING" && r.holdExpiresAt != null && r.holdExpiresAt.getTime() > Date.now();
}

function TripSummary({ r }: { r: ReservationDetail }) {
  const name = `${r.vehicle.make} ${r.vehicle.model}`;
  return (
    <Card className="overflow-hidden">
      <VehicleImage src={r.vehicle.imageUrl} alt={name} />
      <CardBody className="space-y-3 text-sm">
        <div>
          <p className="text-base font-semibold">{name}</p>
          <p className="text-muted">
            {r.vehicle.categoryName} or similar. Reference{" "}
            <span className="font-mono font-medium text-ink" data-testid="checkout-ref">
              {r.reference}
            </span>
          </p>
        </div>
        <dl className="space-y-1">
          <div>
            <dt className="inline font-medium">Pick-up: </dt>
            <dd className="inline text-muted">
              {r.pickupBranch.name}, {formatDateTime(r.pickupAt, r.pickupBranch.timeZone)}
            </dd>
          </div>
          <div>
            <dt className="inline font-medium">Return: </dt>
            <dd className="inline text-muted">
              {r.returnBranch.name}, {formatDateTime(r.returnAt, r.returnBranch.timeZone)}
            </dd>
          </div>
        </dl>
      </CardBody>
    </Card>
  );
}

function DriverForm({ r, defaults }: { r: ReservationDetail; defaults: { name: string; email: string; phone: string } }) {
  const d = r.driver;
  const accept = ALLOWED_LICENCE_TYPES.join(",");
  return (
    <ActionForm
      action={saveDriverAction.bind(null, r.id)}
      submitLabel={d ? "Update driver details" : "Save driver details"}
      pendingLabel="Saving…"
      variant={d ? "secondary" : "primary"}
      testId="driver-form"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fullName" label="Full name (as on licence)" required className="sm:col-span-2">
          {(p) => <Input {...p} name="fullName" autoComplete="name" defaultValue={d?.fullName ?? defaults.name} />}
        </Field>
        <Field id="driverEmail" label="Driver email" required>
          {(p) => <Input {...p} name="email" type="email" autoComplete="email" defaultValue={d?.email ?? defaults.email} />}
        </Field>
        <Field id="driverPhone" label="Mobile number" required>
          {(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" defaultValue={d?.phone ?? defaults.phone} />}
        </Field>
        <Field id="dateOfBirth" label="Date of birth" hint={`Driver must be at least ${MIN_DRIVER_AGE}.`} required>
          {(p) => <Input {...p} name="dateOfBirth" type="date" autoComplete="bday" defaultValue={d?.dateOfBirth ?? ""} />}
        </Field>
        <Field id="nationality" label="Nationality">
          {(p) => <Input {...p} name="nationality" autoComplete="country-name" />}
        </Field>
        <Field id="licenceNumber" label="Driving licence number" required>
          {(p) => <Input {...p} name="licenceNumber" defaultValue={d?.licenceNumber ?? ""} />}
        </Field>
        <Field id="licenceCountry" label="Licence issued in (country)" required>
          {(p) => <Input {...p} name="licenceCountry" defaultValue={d?.licenceCountry ?? ""} />}
        </Field>
        <Field id="licenceExpiry" label="Licence expiry date" hint="Must be valid until the return date." required>
          {(p) => <Input {...p} name="licenceExpiry" type="date" defaultValue={d?.licenceExpiry ?? ""} />}
        </Field>
        <Field
          id="licence"
          label={r.hasLicence ? "Replace licence photo (optional)" : "Driving licence photo or scan"}
          hint={`JPEG, PNG, WebP or PDF, up to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Stored privately; only you and DriveEasy staff can see it.`}
          required={!r.hasLicence}
          className="sm:col-span-2"
        >
          {(p) => (
            <Input
              {...p}
              name="licence"
              type="file"
              accept={accept}
              className="h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-800"
            />
          )}
        </Field>
      </div>
    </ActionForm>
  );
}

async function CheckoutView({
  params,
  searchParams,
}: {
  params: PageProps<"/checkout/[reservationId]">["params"];
  searchParams: PageProps<"/checkout/[reservationId]">["searchParams"];
}) {
  await connection();
  const [{ reservationId }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/checkout/${reservationId}`);
  const r = await getReservationForUser(user.id, reservationId);
  if (!r) notFound();

  if (r.status === "CONFIRMED" || r.status === "PICKED_UP" || r.status === "RETURNED") {
    redirect(`/my-rentals/${r.id}/voucher`);
  }

  const vehicleHref = `/vehicles/${r.vehicle.id}`;
  const holdActive = isHoldActive(r);

  if (!holdActive) {
    const cancelled = r.status === "CANCELLED" || first(sp.cancelled) === "1";
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <Alert
          tone={cancelled ? "info" : "warning"}
          title={cancelled ? "Booking cancelled" : "Your hold has expired"}
          testId="checkout-closed"
        >
          {cancelled
            ? "You cancelled this booking before paying. The car has been released and nothing was charged."
            : "The car was held for 15 minutes and has now been released. Nothing was charged."}
        </Alert>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/book/${r.vehicle.id}`}>Book this car again</ButtonLink>
          <ButtonLink href="/search" variant="secondary">
            Search other cars
          </ButtonLink>
        </div>
        <TripSummary r={r} />
      </div>
    );
  }

  const driverDone = Boolean(r.driver) && r.hasLicence;
  const env = getEnv();

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      <div className="min-w-0 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Driver details and payment</h1>
        <HoldCountdown expiresAt={r.holdExpiresAt!.toISOString()} />
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle>1. Main driver</CardTitle>
            {driverDone ? <span className="text-sm font-medium text-green-800">Complete</span> : null}
          </CardHeader>
          <CardBody>
            {!r.hasLicence && r.driver ? (
              <Alert tone="warning" className="mb-4">
                Please upload a photo or scan of the driving licence to continue.
              </Alert>
            ) : null}
            <DriverForm r={r} defaults={{ name: user.name, email: user.email, phone: user.phone ?? "" }} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>2. Payment</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {!driverDone ? (
              <Alert tone="info">Save the driver details and licence above to continue to payment.</Alert>
            ) : null}
            <PayForm
              action={payAction.bind(null, r.id)}
              totalFils={r.quote.totalFils}
              depositFils={r.quote.depositFils}
              idempotencyKey={crypto.randomUUID()}
              disabled={!driverDone}
              lastFailure={r.payment?.status === "FAILED" ? r.payment.failureReason : r.deposit?.status === "FAILED" ? r.deposit.failureReason : null}
              provider={env.PAYMENTS_PROVIDER}
            />
          </CardBody>
        </Card>
        <form action={abandonCheckoutAction.bind(null, r.id)} className="text-center sm:text-left">
          <button type="submit" className={buttonClass("ghost", "sm")}>
            Cancel booking and release the car
          </button>
        </form>
      </div>
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <TripSummary r={r} />
        <Card>
          <CardBody>
            <PriceBreakdown quote={r.quote} />
          </CardBody>
        </Card>
        <ButtonLink href={vehicleHref} variant="ghost" size="sm">
          View car details
        </ButtonLink>
      </aside>
    </div>
  );
}

export default function CheckoutPage({ params, searchParams }: PageProps<"/checkout/[reservationId]">) {
  return (
    <Container className="py-8">
      <div className="mb-6">
        <Stepper current={2} />
      </div>
      <Suspense fallback={<Skeleton className="h-[32rem]" />}>
        <CheckoutView params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}
