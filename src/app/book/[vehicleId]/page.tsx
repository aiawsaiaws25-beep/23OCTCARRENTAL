import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { formatAED } from "@/components/format";
import { addDays, parseTrip, todayIn, type RawSearchParams } from "@/components/search-params";
import { SectionBoundary } from "@/components/section-boundary";
import { TripDatesForm } from "@/components/trip-dates-form";
import { VehicleImage } from "@/components/vehicle-card";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { getVehicle, getVehicleCalendar, listBranches, type VehicleDetails } from "@/server/catalog";

export const metadata: Metadata = { title: "Choose dates" };

async function UpcomingAvailability({ vehicle }: { vehicle: VehicleDetails }) {
  const today = todayIn(vehicle.branch.timeZone);
  const cal = await getVehicleCalendar(vehicle.id, today, 42);
  if (!cal) return null;
  return <AvailabilityCalendar days={cal.days} caption="Next six weeks. Booked days can't be selected for your rental." />;
}

async function DatesView({
  params,
  searchParams,
}: {
  params: PageProps<"/book/[vehicleId]">["params"];
  searchParams: Promise<RawSearchParams>;
}) {
  await connection();
  const [{ vehicleId }, sp] = await Promise.all([params, searchParams]);
  const [vehicle, branches] = await Promise.all([getVehicle(vehicleId), listBranches()]);
  if (!vehicle) notFound();
  const name = `${vehicle.make} ${vehicle.model}`;
  const trip = parseTrip(sp);
  const today = todayIn(vehicle.branch.timeZone);
  const branchOptions = branches.map((b) => ({ code: b.code, name: b.name, city: b.city }));

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-6">
        <Card>
          <CardBody className="py-6">
            <h1 className="mb-5 text-2xl font-bold tracking-tight">When do you need the {name}?</h1>
            {!vehicle.bookable || !vehicle.branch.active ? (
              <Alert tone="warning">This car can&apos;t be booked online right now.</Alert>
            ) : (
              <TripDatesForm
                action={`/book/${vehicle.id}/extras`}
                pickupBranch={{ code: vehicle.branch.code, name: vehicle.branch.name, city: vehicle.branch.city }}
                branches={branchOptions}
                minDate={today}
                defaults={{
                  returnBranch: trip?.returnBranch ?? vehicle.branch.code,
                  pickupDate: trip?.pickupDate ?? addDays(today, 1),
                  pickupTime: trip?.pickupTime ?? "10:00",
                  returnDate: trip?.returnDate ?? addDays(today, 4),
                  returnTime: trip?.returnTime ?? "10:00",
                }}
              />
            )}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="mb-3 text-lg font-semibold">Availability</h2>
            <SectionBoundary label="availability">
              <Suspense fallback={<Skeleton className="h-64" />}>
                <UpcomingAvailability vehicle={vehicle} />
              </Suspense>
            </SectionBoundary>
          </CardBody>
        </Card>
      </div>
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <Card className="overflow-hidden">
          <VehicleImage src={vehicle.images[0] ?? null} alt={name} />
          <CardBody>
            <p className="font-semibold">{name}</p>
            <p className="text-sm text-muted">{vehicle.category.name}</p>
            <p className="mt-2 text-sm">
              <span className="font-semibold">{formatAED(vehicle.dailyRateFils)}</span> / day, excl. VAT
            </p>
            <Link href={`/vehicles/${vehicle.id}`} className="mt-2 inline-block text-sm text-brand-700 underline">
              View car details
            </Link>
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

export default function BookDatesPage({ params, searchParams }: PageProps<"/book/[vehicleId]">) {
  return (
    <Container className="py-8">
      <div className="mb-6">
        <Stepper current={0} />
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <DatesView params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}
