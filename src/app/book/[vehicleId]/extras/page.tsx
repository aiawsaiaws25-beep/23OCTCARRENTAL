import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ExtrasForm } from "@/components/extras-form";
import { formatDateTime } from "@/components/format";
import { parseTrip, tripQuery, type RawSearchParams } from "@/components/search-params";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { getQuote, getVehicle, isUuid, listBranches, listExtras } from "@/server/catalog";
import { resolveTrip } from "../../trip";

export const metadata: Metadata = { title: "Extras" };

/** ?extra=<id>:<qty> (repeatable) preselects extras, e.g. when coming back from checkout. */
function parseSelection(sp: RawSearchParams): Record<string, number> {
  const raw = sp.extra;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const out: Record<string, number> = {};
  for (const item of list) {
    const [id, q] = item.split(":");
    const qty = Number(q);
    if (isUuid(id) && Number.isInteger(qty) && qty > 0 && qty <= 10) out[id] = qty;
  }
  return out;
}

async function ExtrasView({
  params,
  searchParams,
}: {
  params: PageProps<"/book/[vehicleId]/extras">["params"];
  searchParams: Promise<RawSearchParams>;
}) {
  await connection();
  const [{ vehicleId }, sp] = await Promise.all([params, searchParams]);
  const vehicle = await getVehicle(vehicleId);
  if (!vehicle) notFound();
  const trip = parseTrip(sp);
  const datesHref = `/book/${vehicle.id}${trip ? `?${tripQuery(trip)}` : ""}`;

  if (!trip) {
    return (
      <Alert tone="warning" title="Choose your dates first">
        <ButtonLink href={datesHref} size="sm" className="mt-2">
          Choose dates
        </ButtonLink>
      </Alert>
    );
  }
  if (trip.pickupBranch !== vehicle.branch.code) {
    return (
      <Alert tone="error" title="This car is collected from a different branch">
        <p>
          The {vehicle.make} {vehicle.model} is based at {vehicle.branch.name}.
        </p>
        <ButtonLink href={`/book/${vehicle.id}`} size="sm" className="mt-2">
          Choose dates at {vehicle.branch.name}
        </ButtonLink>
      </Alert>
    );
  }

  const [extras, resolved, branches] = await Promise.all([listExtras(), resolveTrip(trip), listBranches()]);
  if (!resolved) {
    return (
      <Alert tone="error" title="Those branches or dates aren't valid">
        <ButtonLink href={datesHref} size="sm" className="mt-2">
          Change dates
        </ButtonLink>
      </Alert>
    );
  }
  const selection = parseSelection(sp);
  const known = Object.fromEntries(Object.entries(selection).filter(([id]) => extras.some((e) => e.id === id)));
  const result = await getQuote({
    vehicleId: vehicle.id,
    ...resolved,
    extras: Object.entries(known).map(([extraId, quantity]) => ({ extraId, quantity })),
  });
  const dropoff = branches.find((b) => b.id === resolved.returnBranchId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 rounded-xl border border-line bg-white p-4 text-sm shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-semibold">
            {vehicle.make} {vehicle.model}
          </span>
          <span className="text-muted">
            {" "}
            from {vehicle.branch.name}, {formatDateTime(resolved.pickupAt, vehicle.branch.timeZone)} to{" "}
            {dropoff?.name ?? ""}, {formatDateTime(resolved.returnAt, dropoff?.timeZone)}
          </span>
        </p>
        <Link href={datesHref} className="font-medium text-brand-700 underline">
          Change dates
        </Link>
      </div>
      {!result.ok ? (
        <Alert tone="error" title="This car can't be booked for these dates" testId="quote-error">
          <p>{result.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <ButtonLink href={datesHref} size="sm">
              Choose other dates
            </ButtonLink>
            <ButtonLink href={`/search?${tripQuery(trip)}`} size="sm" variant="secondary">
              See other cars
            </ButtonLink>
          </div>
        </Alert>
      ) : (
        <ExtrasForm
          vehicleId={vehicle.id}
          trip={trip}
          extras={extras}
          initialSelection={known}
          initialQuote={result.quote}
          initialError={null}
          idempotencyKey={crypto.randomUUID()}
        />
      )}
    </div>
  );
}

export default function ExtrasPage({ params, searchParams }: PageProps<"/book/[vehicleId]/extras">) {
  return (
    <Container className="py-8">
      <div className="mb-6">
        <Stepper current={1} />
      </div>
      <Suspense fallback={<Skeleton className="h-96" />}>
        <ExtrasView params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}
