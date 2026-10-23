import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatAED, formatDateTime, pluralize } from "@/components/format";
import { SearchForm } from "@/components/search-form";
import { addDays, first, parseTrip, todayIn, tripQuery, zonedToUtc, type RawSearchParams } from "@/components/search-params";
import { SectionBoundary } from "@/components/section-boundary";
import { titleCase, VehicleCard } from "@/components/vehicle-card";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/field";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getSearchFilterOptions, listBranches, searchVehicles, type BranchSummary, type SearchFilterOptions } from "@/server/catalog";

export const metadata: Metadata = { title: "Find a car" };

type Filters = {
  category?: string;
  transmission?: "AUTOMATIC" | "MANUAL";
  fuel?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  seats?: number;
  maxPrice?: number; // AED
  sort?: "price_asc" | "price_desc";
};

function parseFilters(sp: RawSearchParams, options: SearchFilterOptions): Filters {
  const category = first(sp.category);
  const transmission = first(sp.transmission);
  const fuel = first(sp.fuel);
  const seats = Number(first(sp.seats));
  const maxPrice = Number(first(sp.maxPrice));
  const sort = first(sp.sort);
  return {
    category: options.categories.some((c) => c.slug === category) ? category : undefined,
    transmission: options.transmissions.find((t) => t === transmission),
    fuel: options.fuelTypes.find((f) => f === fuel),
    seats: Number.isInteger(seats) && seats > 0 && seats <= 15 ? seats : undefined,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? Math.floor(maxPrice) : undefined,
    sort: sort === "price_desc" ? "price_desc" : sort === "price_asc" ? "price_asc" : undefined,
  };
}

function filterQuery(f: Filters): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.category) out.category = f.category;
  if (f.transmission) out.transmission = f.transmission;
  if (f.fuel) out.fuel = f.fuel;
  if (f.seats) out.seats = String(f.seats);
  if (f.maxPrice) out.maxPrice = String(f.maxPrice);
  if (f.sort) out.sort = f.sort;
  return out;
}

function FilterPanel({
  trip,
  filters,
  options,
}: {
  trip: Record<string, string>;
  filters: Filters;
  options: SearchFilterOptions;
}) {
  const maxAed = Math.ceil(options.priceRange.maxFils / 100);
  return (
    <form action="/search" aria-label="Filter cars" className="space-y-4" data-testid="filters">
      {Object.entries(trip).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="space-y-1.5">
        <Label htmlFor="f-category">Category</Label>
        <Select id="f-category" name="category" defaultValue={filters.category ?? ""}>
          <option value="">All categories</option>
          {options.categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {c.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-transmission">Transmission</Label>
        <Select id="f-transmission" name="transmission" defaultValue={filters.transmission ?? ""}>
          <option value="">Any</option>
          {options.transmissions.map((t) => (
            <option key={t} value={t}>
              {titleCase(t)}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-seats">Seats</Label>
        <Select id="f-seats" name="seats" defaultValue={filters.seats ? String(filters.seats) : ""}>
          <option value="">Any</option>
          {options.seatOptions.map((s) => (
            <option key={s} value={s}>
              {s}+ seats
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-fuel">Fuel type</Label>
        <Select id="f-fuel" name="fuel" defaultValue={filters.fuel ?? ""}>
          <option value="">Any</option>
          {options.fuelTypes.map((f) => (
            <option key={f} value={f}>
              {titleCase(f)}
            </option>
          ))}
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-maxPrice">Max price per day (AED)</Label>
        <Input
          id="f-maxPrice"
          name="maxPrice"
          type="number"
          inputMode="numeric"
          min={1}
          max={maxAed || undefined}
          step={1}
          placeholder={maxAed ? `Up to ${maxAed}` : undefined}
          defaultValue={filters.maxPrice}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="f-sort">Sort by</Label>
        <Select id="f-sort" name="sort" defaultValue={filters.sort ?? "price_asc"}>
          <option value="price_asc">Price: low to high</option>
          <option value="price_desc">Price: high to low</option>
        </Select>
      </div>
      <div className="flex gap-2">
        <button type="submit" className={buttonClass("primary", "md", "flex-1")}>
          Apply filters
        </button>
        <a href={`/search?${new URLSearchParams(trip)}`} className={buttonClass("secondary", "md")}>
          Reset
        </a>
      </div>
    </form>
  );
}

async function Results({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  await connection();
  const sp = await searchParams;
  const [branches, options] = await Promise.all([listBranches(), getSearchFilterOptions()]);
  const today = todayIn();
  const trip = parseTrip(sp);
  const branchOptions = branches.map((b) => ({ code: b.code, name: b.name, city: b.city }));

  const searchBox = (hidden?: Record<string, string>) => (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-5">
      <SearchForm
        layout="compact"
        branches={branchOptions}
        minDate={today}
        hidden={hidden}
        defaults={
          trip ?? {
            pickupBranch: branches[0]?.code,
            pickupDate: addDays(today, 1),
            pickupTime: "10:00",
            returnDate: addDays(today, 4),
            returnTime: "10:00",
          }
        }
      />
    </div>
  );

  if (!branches.length) {
    return <EmptyState title="No branches available" description="Online booking is temporarily unavailable." />;
  }

  if (!trip) {
    return (
      <div className="space-y-6">
        {searchBox()}
        <EmptyState
          title="Choose where and when"
          description="Pick a branch and your rental dates to see the cars available for your trip."
        />
      </div>
    );
  }

  const byCode = new Map<string, BranchSummary>(branches.map((b) => [b.code, b]));
  const pickup = byCode.get(trip.pickupBranch);
  const dropoff = byCode.get(trip.returnBranch);
  const filters = parseFilters(sp, options);
  const tripRecord = { ...trip };

  if (!pickup || !dropoff) {
    return (
      <div className="space-y-6">
        {searchBox()}
        <Alert tone="error">The selected branch is not available. Please choose another branch.</Alert>
      </div>
    );
  }

  const pickupAt = zonedToUtc(trip.pickupDate, trip.pickupTime, pickup.timeZone);
  const returnAt = zonedToUtc(trip.returnDate, trip.returnTime, dropoff.timeZone);
  const category = options.categories.find((c) => c.slug === filters.category);

  const result = await searchVehicles({
    pickupBranchId: pickup.id,
    returnBranchId: dropoff.id,
    pickupAt,
    returnAt,
    categoryId: category?.id,
    transmission: filters.transmission,
    fuelType: filters.fuel,
    minSeats: filters.seats,
    maxDailyRateFils: filters.maxPrice ? filters.maxPrice * 100 : undefined,
    sort: filters.sort,
  });

  const activeFilters = Object.keys(filterQuery({ ...filters, sort: undefined })).length;

  return (
    <div className="space-y-6">
      {searchBox(filterQuery(filters))}
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside aria-label="Filters">
          <details className="group rounded-xl border border-line bg-white p-4 shadow-sm lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between font-semibold">
              Filters{activeFilters ? ` (${activeFilters})` : ""}
              <span aria-hidden="true" className="transition-transform group-open:rotate-180">
                ▾
              </span>
            </summary>
            <div className="mt-4">
              <FilterPanel trip={tripRecord} filters={filters} options={options} />
            </div>
          </details>
          <div className="hidden rounded-xl border border-line bg-white p-4 shadow-sm lg:block">
            <h2 className="mb-4 font-semibold">Filters</h2>
            <FilterPanel trip={tripRecord} filters={filters} options={options} />
          </div>
        </aside>
        <section aria-labelledby="results-heading">
          {!result.ok ? (
            <Alert tone="error" title="We couldn't search for these dates" testId="search-error">
              {result.message}
            </Alert>
          ) : (
            <>
              <div className="mb-4">
                <h2 id="results-heading" className="text-lg font-semibold" data-testid="results-count">
                  {pluralize(result.vehicles.length, "car")} available
                </h2>
                <p className="text-sm text-muted">
                  {pickup.name}, {formatDateTime(pickupAt, pickup.timeZone)} to{" "}
                  {pickup.id === dropoff.id ? "" : `${dropoff.name}, `}
                  {formatDateTime(returnAt, dropoff.timeZone)}
                  {result.vehicles[0]?.oneWayFeeFils
                    ? `. One-way fee ${formatAED(result.vehicles[0].oneWayFeeFils)} included in totals.`
                    : ""}
                </p>
              </div>
              {result.vehicles.length === 0 ? (
                <EmptyState
                  title="No cars match your search"
                  description={
                    activeFilters
                      ? "Try removing some filters, or choose different dates or another branch."
                      : "Every car at this branch is booked for these dates. Try different dates or another branch."
                  }
                />
              ) : (
                <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="search-results">
                  {result.vehicles.map((v, i) => (
                    <li key={v.id} className="flex">
                      <div className="flex w-full">
                        <VehicleCard
                          priority={i < 3}
                          href={`/vehicles/${v.id}?${tripQuery(trip)}`}
                          v={{ ...v, totalFils: v.estimatedTotalFils }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ResultsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Searching for available cars…</span>
      <Skeleton className="h-32" />
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Skeleton className="hidden h-96 lg:block" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-80" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function SearchPage({ searchParams }: PageProps<"/search">) {
  return (
    <Container className="py-8">
      <h1 className="mb-6 text-2xl font-bold tracking-tight sm:text-3xl">Find a car</h1>
      <SectionBoundary label="search results">
        <Suspense fallback={<ResultsSkeleton />}>
          <Results searchParams={searchParams} />
        </Suspense>
      </SectionBoundary>
    </Container>
  );
}
