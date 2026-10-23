import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { SectionBoundary } from "@/components/section-boundary";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Container, PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listBranches } from "@/server/catalog";

export const metadata: Metadata = { title: "Branches" };

async function BranchList() {
  const branches = await listBranches();
  if (!branches.length) {
    return <EmptyState title="No branches open" description="Please check back soon." />;
  }
  const byEmirate = new Map<string, typeof branches>();
  for (const b of branches) {
    if (!byEmirate.has(b.emirate)) byEmirate.set(b.emirate, []);
    byEmirate.get(b.emirate)!.push(b);
  }
  return (
    <div className="space-y-10">
      {[...byEmirate.entries()].map(([emirate, list]) => (
        <section key={emirate} aria-labelledby={`em-${emirate}`}>
          <h2 id={`em-${emirate}`} className="text-lg font-semibold">
            {emirate}
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {list.map((b) => (
              <li key={b.id}>
                <Link
                  href={`/branches/${b.code}`}
                  data-testid="branch-card"
                  className="block h-full rounded-xl border border-line bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-semibold">{b.name}</h3>
                    {b.isAirport ? <Badge tone="info">Airport</Badge> : null}
                  </div>
                  <p className="mt-1 text-sm text-muted">{b.address}</p>
                  <p className="mt-3 text-sm">{b.openingHours}</p>
                  <p className="mt-1 text-sm text-muted">{b.phone}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function BranchesPage() {
  return (
    <Container className="py-8">
      <PageHeader title="Our branches" description="Pick up and return at any DriveEasy branch in the UAE." />
      <div className="mt-8">
        <SectionBoundary label="branches">
          <Suspense fallback={<ListSkeleton label="Loading branches" />}>
            <BranchList />
          </Suspense>
        </SectionBoundary>
      </div>
    </Container>
  );
}
