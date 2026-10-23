import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { formatAED } from "@/components/format";
import { SearchForm } from "@/components/search-form";
import { SectionBoundary } from "@/components/section-boundary";
import { addDays, todayIn } from "@/components/search-params";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { listBranches, listCategories } from "@/server/catalog";

async function HeroSearch() {
  await connection();
  const branches = await listBranches();
  if (!branches.length) {
    return <Alert tone="warning">No branches are open for online booking right now. Please check back soon.</Alert>;
  }
  const today = todayIn();
  return (
    <SearchForm
      branches={branches.map((b) => ({ code: b.code, name: b.name, city: b.city }))}
      minDate={today}
      defaults={{
        pickupBranch: branches[0].code,
        pickupDate: addDays(today, 1),
        pickupTime: "10:00",
        returnDate: addDays(today, 4),
        returnTime: "10:00",
      }}
    />
  );
}

async function Categories() {
  const categories = await listCategories();
  if (!categories.length) return null;
  return (
    <section aria-labelledby="categories-heading">
      <h2 id="categories-heading" className="text-2xl font-bold tracking-tight">
        Cars for every trip
      </h2>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {categories.map((c) => (
          <li key={c.id} className="rounded-xl border border-line bg-white p-5 shadow-sm">
            <h3 className="font-semibold">{c.name}</h3>
            {c.description ? <p className="mt-1 text-sm text-muted">{c.description}</p> : null}
            <p className="mt-3 text-sm">
              From <span className="font-semibold">{formatAED(c.dailyRateFils)}</span> / day
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Branches() {
  const branches = await listBranches();
  if (!branches.length) return null;
  return (
    <section aria-labelledby="branches-heading">
      <div className="flex items-end justify-between gap-4">
        <h2 id="branches-heading" className="text-2xl font-bold tracking-tight">
          Pick up across the UAE
        </h2>
        <Link href="/branches" className="text-sm font-medium text-brand-700 underline">
          All branches
        </Link>
      </div>
      <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {branches.map((b) => (
          <li key={b.id}>
            <Link
              href={`/branches/${b.code}`}
              className="block h-full rounded-xl border border-line bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">{b.name}</h3>
                {b.isAirport ? <Badge tone="info">Airport</Badge> : null}
              </div>
              <p className="mt-1 text-sm text-muted">
                {b.city}, {b.emirate}
              </p>
              <p className="mt-2 text-sm">{b.openingHours}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const perks = [
  { title: "All-in prices", body: "Daily rate, extras, one-way fee and 5% VAT are shown before you pay." },
  { title: "Free cancellation", body: "Cancel for free up to 48 hours before pick-up." },
  { title: "Digital voucher", body: "Show the QR code at the counter and drive away." },
];

export default function Home() {
  return (
    <>
      <section className="bg-gradient-to-b from-brand-800 to-brand-600 pb-10 pt-12 text-white sm:pb-14 sm:pt-16">
        <Container>
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-5xl">Rent a car in the UAE</h1>
          <p className="mt-3 max-w-xl text-brand-50 sm:text-lg">
            From Dubai Marina to Abu Dhabi airport. Choose your branch and dates, and see the full price up front.
          </p>
          <div className="mt-8 rounded-2xl bg-white p-4 text-ink shadow-xl sm:p-6">
            <SectionBoundary label="the branch list">
              <Suspense fallback={<Skeleton className="h-40 lg:h-24" />}>
                <HeroSearch />
              </Suspense>
            </SectionBoundary>
          </div>
        </Container>
      </section>
      <Container className="py-4">
        <ul className="mt-10 grid gap-4 sm:grid-cols-3">
          {perks.map((p) => (
            <li key={p.title} className="rounded-xl bg-sand-50 p-5 ring-1 ring-sand-100">
              <h2 className="font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-muted">{p.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-16">
          <SectionBoundary label="car categories">
            <Suspense fallback={<Skeleton className="h-48" />}>
              <Categories />
            </Suspense>
          </SectionBoundary>
        </div>
        <div className="mt-16">
          <SectionBoundary label="branches">
            <Suspense fallback={<Skeleton className="h-48" />}>
              <Branches />
            </Suspense>
          </SectionBoundary>
        </div>
      </Container>
    </>
  );
}
