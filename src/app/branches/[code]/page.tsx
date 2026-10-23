import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { pluralize } from "@/components/format";
import { SearchForm } from "@/components/search-form";
import { addDays, todayIn } from "@/components/search-params";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getBranchByCode, listBranches } from "@/server/catalog";

export const metadata: Metadata = { title: "Branch" };

async function BranchView({ params }: { params: PageProps<"/branches/[code]">["params"] }) {
  await connection();
  const { code } = await params;
  if (!/^[A-Za-z0-9]{2,10}$/.test(code)) notFound();
  const [branch, branches] = await Promise.all([getBranchByCode(code), listBranches()]);
  if (!branch) notFound();
  const today = todayIn(branch.timeZone);
  const mapHref =
    branch.latitude != null && branch.longitude != null
      ? `https://www.openstreetmap.org/?mlat=${branch.latitude}&mlon=${branch.longitude}#map=16/${branch.latitude}/${branch.longitude}`
      : null;

  return (
    <div className="space-y-8">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{branch.name}</h1>
          {branch.isAirport ? <Badge tone="info">Airport</Badge> : null}
          {!branch.active ? <Badge tone="danger">Temporarily closed</Badge> : null}
        </div>
        <p className="mt-1 text-muted">
          {branch.city}, {branch.emirate}
        </p>
      </div>
      {branch.imageUrl ? (
        <div className="relative aspect-[3/1] overflow-hidden rounded-xl border border-line">
          <Image
            src={branch.imageUrl}
            alt={`${branch.name} branch`}
            fill
            sizes="(min-width: 1152px) 1152px, 100vw"
            className="object-cover"
            unoptimized={branch.imageUrl.endsWith(".svg")}
          />
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <Card>
          <CardBody>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="font-medium">Address</dt>
                <dd className="text-muted">{branch.address}</dd>
              </div>
              <div>
                <dt className="font-medium">Opening hours</dt>
                <dd className="text-muted">{branch.openingHours}</dd>
              </div>
              <div>
                <dt className="font-medium">Phone</dt>
                <dd>
                  <a href={`tel:${branch.phone.replace(/\s/g, "")}`} className="text-brand-700 underline">
                    {branch.phone}
                  </a>
                </dd>
              </div>
              {branch.email ? (
                <div>
                  <dt className="font-medium">Email</dt>
                  <dd>
                    <a href={`mailto:${branch.email}`} className="text-brand-700 underline">
                      {branch.email}
                    </a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt className="font-medium">Fleet</dt>
                <dd className="text-muted" data-testid="branch-fleet-count">
                  {pluralize(branch.vehicleCount, "car")} based here
                </dd>
              </div>
              <div>
                <dt className="font-medium">Time zone</dt>
                <dd className="text-muted">{branch.timeZone}</dd>
              </div>
            </dl>
            {mapHref ? (
              <a
                href={mapHref}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block text-sm font-medium text-brand-700 underline"
              >
                Open in map<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <h2 className="mb-4 text-lg font-semibold">Find a car at {branch.name}</h2>
            {branch.active ? (
              <SearchForm
                layout="stacked"
                branches={branches.map((b) => ({ code: b.code, name: b.name, city: b.city }))}
                minDate={today}
                defaults={{
                  pickupBranch: branch.code,
                  pickupDate: addDays(today, 1),
                  pickupTime: "10:00",
                  returnDate: addDays(today, 4),
                  returnTime: "10:00",
                }}
              />
            ) : (
              <Alert tone="warning">This branch is not taking bookings right now.</Alert>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function BranchPage({ params }: PageProps<"/branches/[code]">) {
  return (
    <Container className="py-8">
      <Suspense
        fallback={
          <div role="status" className="space-y-4">
            <span className="sr-only">Loading branch…</span>
            <Skeleton className="h-10 w-72" />
            <Skeleton className="h-64" />
          </div>
        }
      >
        <BranchView params={params} />
      </Suspense>
    </Container>
  );
}
