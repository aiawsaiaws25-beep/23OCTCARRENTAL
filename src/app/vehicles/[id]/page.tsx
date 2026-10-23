import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { formatAED, formatDateTime } from "@/components/format";
import { PriceBreakdown } from "@/components/price-breakdown";
import { addDays, first, parseTrip, todayIn, tripQuery, zonedToUtc, type RawSearchParams } from "@/components/search-params";
import { SectionBoundary } from "@/components/section-boundary";
import { VehicleImage, VehicleSpecs } from "@/components/vehicle-card";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getQuote, getVehicle, getVehicleCalendar, listBranches, type VehicleDetails } from "@/server/catalog";

export const metadata: Metadata = { title: "Vehicle details" };

const CALENDAR_DAYS = 61;

function monthStart(ymd: string) {
  return `${ymd.slice(0, 7)}-01`;
}

function shiftMonth(ymd: string, delta: number) {
  const [y, m] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 10);
}

async function Calendar({ vehicle, sp }: { vehicle: VehicleDetails; sp: RawSearchParams }) {
  const today = todayIn(vehicle.branch.timeZone);
  const requested = first(sp.from);
  const thisMonth = monthStart(today);
  let from = requested && /^\d{4}-\d{2}-01$/.test(requested) ? requested : thisMonth;
  if (from < thisMonth) from = thisMonth;
  // Two whole months from `from`.
  const end = shiftMonth(from, 2);
  // Past days are not shown: the current month starts today.
  const start = from === thisMonth ? today : from;
  const days = Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
  const cal = await getVehicleCalendar(vehicle.id, start, Math.min(days, CALENDAR_DAYS + 1));
  if (!cal) return <Alert tone="error">Availability could not be loaded.</Alert>;

  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const val = first(v);
    if (val && k !== "from") params.set(k, val);
  }
  const href = (f: string) => {
    const p = new URLSearchParams(params);
    p.set("from", f);
    return `/vehicles/${vehicle.id}?${p}#availability`;
  };
  return (
    <AvailabilityCalendar
      days={cal.days}
      caption={`Dates in ${cal.timeZone.replace("_", " ")} time. Partly booked days have some hours free.`}
      prevHref={from > thisMonth ? href(shiftMonth(from, -2)) : null}
      nextHref={shiftMonth(from, 2) <= shiftMonth(thisMonth, 10) ? href(shiftMonth(from, 2)) : null}
    />
  );
}

async function BookingPanel({ vehicle, sp }: { vehicle: VehicleDetails; sp: RawSearchParams }) {
  const trip = parseTrip(sp);
  if (!vehicle.bookable) {
    return <Alert tone="warning">This car is not available for online booking at the moment.</Alert>;
  }
  const bookHref = `/book/${vehicle.id}${trip ? `?${tripQuery({ ...trip, pickupBranch: vehicle.branch.code })}` : ""}`;

  if (!trip || trip.pickupBranch !== vehicle.branch.code) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">Choose your dates to see the total price, including VAT and any fees.</p>
        <ButtonLink href={bookHref} size="lg" className="w-full">
          Choose dates
        </ButtonLink>
      </div>
    );
  }

  const branches = await listBranches();
  const dropoff = branches.find((b) => b.code === trip.returnBranch);
  if (!dropoff) {
    return <Alert tone="error">The selected return branch is not available.</Alert>;
  }
  const pickupAt = zonedToUtc(trip.pickupDate, trip.pickupTime, vehicle.branch.timeZone);
  const returnAt = zonedToUtc(trip.returnDate, trip.returnTime, dropoff.timeZone);
  const result = await getQuote({
    vehicleId: vehicle.id,
    pickupBranchId: vehicle.branch.id,
    returnBranchId: dropoff.id,
    pickupAt,
    returnAt,
  });

  return (
    <div className="space-y-4">
      <dl className="space-y-1 text-sm">
        <div>
          <dt className="inline font-medium">Pick-up: </dt>
          <dd className="inline text-muted">
            {vehicle.branch.name}, {formatDateTime(pickupAt, vehicle.branch.timeZone)}
          </dd>
        </div>
        <div>
          <dt className="inline font-medium">Return: </dt>
          <dd className="inline text-muted">
            {dropoff.name}, {formatDateTime(returnAt, dropoff.timeZone)}
          </dd>
        </div>
      </dl>
      {result.ok ? (
        <>
          <Alert tone="success" testId="availability-status">
            Available for your dates
          </Alert>
          <PriceBreakdown quote={result.quote} title="Price for your dates (before extras)" />
          <ButtonLink href={`/book/${vehicle.id}/extras?${tripQuery(trip)}`} size="lg" className="w-full">
            Continue to extras
          </ButtonLink>
          <ButtonLink href={bookHref} variant="secondary" className="w-full">
            Change dates
          </ButtonLink>
        </>
      ) : (
        <>
          <Alert tone="error" title="Not available" testId="availability-status">
            {result.message}
          </Alert>
          <ButtonLink href={bookHref} size="lg" className="w-full">
            Choose other dates
          </ButtonLink>
        </>
      )}
    </div>
  );
}

async function VehicleView({
  params,
  searchParams,
}: {
  params: PageProps<"/vehicles/[id]">["params"];
  searchParams: Promise<RawSearchParams>;
}) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const vehicle = await getVehicle(id);
  if (!vehicle) notFound();
  const name = `${vehicle.make} ${vehicle.model}`;
  const trip = parseTrip(sp);
  const today = todayIn(vehicle.branch.timeZone);

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-muted">
        <Link
          href={trip ? `/search?${tripQuery(trip)}` : `/search?pickupBranch=${vehicle.branch.code}&returnBranch=${vehicle.branch.code}&pickupDate=${addDays(today, 1)}&pickupTime=10:00&returnDate=${addDays(today, 4)}&returnTime=10:00`}
          className="underline hover:text-ink"
        >
          {trip ? "Back to results" : "Search cars"}
        </Link>
      </nav>
      <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-8">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{name}</h1>
              <Badge tone="brand">{vehicle.category.name}</Badge>
            </div>
            <p className="mt-1 text-muted">
              {vehicle.year}
              {vehicle.color ? `, ${vehicle.color}` : ""}. Picked up at{" "}
              <Link href={`/branches/${vehicle.branch.code}`} className="underline">
                {vehicle.branch.name}
              </Link>
              .
            </p>
          </div>
          <div className="overflow-hidden rounded-xl border border-line">
            <VehicleImage src={vehicle.images[0] ?? null} alt={`${name} ${vehicle.year}`} priority />
          </div>
          {vehicle.images.length > 1 ? (
            <ul className="grid grid-cols-3 gap-2">
              {vehicle.images.slice(1, 4).map((src, i) => (
                <li key={src} className="overflow-hidden rounded-lg border border-line">
                  <VehicleImage src={src} alt={`${name}, photo ${i + 2}`} />
                </li>
              ))}
            </ul>
          ) : null}
          <section aria-labelledby="specs-heading">
            <h2 id="specs-heading" className="text-lg font-semibold">
              Specifications
            </h2>
            <div className="mt-2">
              <VehicleSpecs v={vehicle} />
            </div>
            {vehicle.category.description ? <p className="mt-3 text-sm text-muted">{vehicle.category.description}</p> : null}
            {vehicle.features.length ? (
              <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Features">
                {vehicle.features.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 text-sm">
                    <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 text-brand-600" fill="currentColor">
                      <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-7.5 7.5a1 1 0 0 1-1.4 0L3.3 9.7a1 1 0 1 1 1.4-1.4l3.8 3.8 6.8-6.8a1 1 0 0 1 1.4 0z" />
                    </svg>
                    {f.name}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          <section aria-labelledby="availability-heading" id="availability" className="scroll-mt-24">
            <h2 id="availability-heading" className="mb-3 text-lg font-semibold">
              Availability
            </h2>
            <SectionBoundary label="availability">
              <Suspense fallback={<Skeleton className="h-72" />}>
                <Calendar vehicle={vehicle} sp={sp} />
              </Suspense>
            </SectionBoundary>
          </section>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card>
            <CardBody className="space-y-4">
              <div>
                <p className="text-sm text-muted">
                  <span className="text-2xl font-bold text-ink">{formatAED(vehicle.dailyRateFils)}</span> / day
                </p>
                <p className="text-xs text-muted">
                  Excludes VAT. Security deposit {formatAED(vehicle.depositFils)} (refundable hold).
                </p>
              </div>
              <SectionBoundary label="pricing">
                <Suspense fallback={<Skeleton className="h-48" />}>
                  <BookingPanel vehicle={vehicle} sp={sp} />
                </Suspense>
              </SectionBoundary>
            </CardBody>
          </Card>
        </aside>
      </div>
    </>
  );
}

export default function VehiclePage({ params, searchParams }: PageProps<"/vehicles/[id]">) {
  return (
    <Container className="py-8">
      <Suspense
        fallback={
          <div role="status" className="grid gap-8 lg:grid-cols-[1fr_380px]">
            <span className="sr-only">Loading vehicle…</span>
            <Skeleton className="h-96" />
            <Skeleton className="h-72" />
          </div>
        }
      >
        <VehicleView params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}
