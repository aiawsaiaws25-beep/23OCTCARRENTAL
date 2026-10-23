import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatAED, formatDateTime } from "@/components/format";
import { ReservationStatusBadge } from "@/components/status-badge";
import { nowMs } from "@/components/search-params";
import { VehicleImage } from "@/components/vehicle-card";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Container, PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listReservationsForUser, type ReservationSummary } from "@/server/reservations";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "My rentals" };

function RentalRow({ r }: { r: ReservationSummary }) {
  return (
    <li data-testid="rental-row" data-reference={r.reference}>
      <Link
        href={r.status === "PENDING" ? `/checkout/${r.id}` : `/my-rentals/${r.id}`}
        className="flex flex-col overflow-hidden rounded-xl border border-line bg-white shadow-sm transition-shadow hover:shadow-md sm:flex-row"
      >
        <VehicleImage src={r.imageUrl} alt={r.vehicleName} className="sm:w-56 sm:shrink-0" />
        <div className="flex flex-1 flex-col gap-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">{r.vehicleName}</h3>
            <ReservationStatusBadge status={r.status} />
          </div>
          <p className="text-sm text-muted">
            Ref <span className="font-mono text-ink">{r.reference}</span>
          </p>
          <p className="text-sm">
            {r.pickupBranchName}, {formatDateTime(r.pickupAt)}
            <span aria-hidden="true"> → </span>
            <span className="sr-only"> to </span>
            {r.returnBranchName}, {formatDateTime(r.returnAt)}
          </p>
          <p className="mt-auto text-sm font-medium">{formatAED(r.totalFils)}</p>
          {r.status === "PENDING" ? (
            <p className="text-sm font-medium text-amber-900">Awaiting payment. Continue to checkout.</p>
          ) : null}
        </div>
      </Link>
    </li>
  );
}

async function Rentals() {
  await connection();
  const user = await requireUser("/my-rentals");
  const all = await listReservationsForUser(user.id);
  const now = nowMs();
  const active = all.filter(
    (r) => r.status === "PICKED_UP" || r.status === "CONFIRMED" || (r.status === "PENDING" && r.holdExpiresAt && r.holdExpiresAt.getTime() > now),
  );
  const past = all.filter((r) => !active.includes(r));

  if (!all.length) {
    return (
      <EmptyState
        title="No rentals yet"
        description="When you book a car, it will appear here with your voucher."
        action={<ButtonLink href="/search">Find a car</ButtonLink>}
      />
    );
  }
  return (
    <div className="space-y-10">
      <section aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading" className="mb-4 text-lg font-semibold">
          Upcoming and active
        </h2>
        {active.length ? (
          <ul className="space-y-4" data-testid="upcoming-rentals">
            {active.map((r) => (
              <RentalRow key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing coming up" action={<ButtonLink href="/search">Book a car</ButtonLink>} />
        )}
      </section>
      {past.length ? (
        <section aria-labelledby="past-heading">
          <h2 id="past-heading" className="mb-4 text-lg font-semibold">
            Past and cancelled
          </h2>
          <ul className="space-y-4" data-testid="past-rentals">
            {past.map((r) => (
              <RentalRow key={r.id} r={r} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

export default function MyRentalsPage() {
  return (
    <Container className="py-8">
      <PageHeader title="My rentals" description="View vouchers, change dates or cancel upcoming bookings." />
      <div className="mt-8">
        <Suspense fallback={<ListSkeleton label="Loading your rentals" />}>
          <Rentals />
        </Suspense>
      </div>
    </Container>
  );
}
