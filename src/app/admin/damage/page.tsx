import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { first, type RawSearchParams } from "@/components/search-params";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { adminListVehicles, listDamageReports } from "@/server/admin";
import { adminActor } from "../_lib/data";
import { DamageForm, DamageReportCard } from "../_lib/damage-ui";
import { AdminPage } from "../_lib/gate";

export const metadata: Metadata = { title: "Damage reports" };

const FILTERS = [
  { value: "", label: "All" },
  { value: "OPEN", label: "Open" },
  { value: "CHARGED", label: "Charged" },
  { value: "RESOLVED", label: "Resolved" },
];

async function Reports({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const status = FILTERS.find((f) => f.value && f.value === first(sp.status))?.value;
  const actor = await adminActor("/admin/damage");
  const [reports, vehicles] = await Promise.all([listDamageReports(actor, { status }), adminListVehicles(actor)]);
  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section aria-labelledby="reports-heading" className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="reports-heading" className="text-lg font-semibold">
            Reports
          </h2>
          <nav aria-label="Filter by status" className="flex flex-wrap gap-1">
            {FILTERS.map((f) => {
              const active = (status ?? "") === f.value;
              return (
                <Link
                  key={f.label}
                  href={f.value ? `/admin/damage?status=${f.value}` : "/admin/damage"}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-full px-3 py-1 text-sm ring-1 ring-line",
                    active ? "bg-brand-600 text-white ring-brand-600" : "bg-white hover:bg-canvas",
                  )}
                >
                  {f.label}
                </Link>
              );
            })}
          </nav>
        </div>
        {reports.length ? (
          reports.map((d) => <DamageReportCard key={d.id} d={d} />)
        ) : (
          <EmptyState title="No damage reports" description={status ? "No reports with this status." : "Nothing has been reported yet."} />
        )}
      </section>
      <aside>
        <Card>
          <CardHeader>
            <CardTitle>New report</CardTitle>
          </CardHeader>
          <CardBody>
            <p className="mb-4 text-sm text-muted">
              For damage found during a rental, report it from the reservation page so it is charged at check-in.
            </p>
            <DamageForm vehicles={vehicles.map((v) => ({ id: v.id, label: `${v.make} ${v.model} (${v.plateNumber})` }))} />
          </CardBody>
        </Card>
      </aside>
    </div>
  );
}

export default function AdminDamagePage({ searchParams }: PageProps<"/admin/damage">) {
  return (
    <AdminPage path="/admin/damage">
      <PageHeader title="Damage reports" description="Photos are stored privately and only visible to staff and the renter." />
      <div className="mt-6">
        <Suspense fallback={<ListSkeleton label="Loading damage reports" />}>
          <Reports searchParams={searchParams} />
        </Suspense>
      </div>
    </AdminPage>
  );
}
