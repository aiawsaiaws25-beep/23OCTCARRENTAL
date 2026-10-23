import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatAED } from "@/components/format";
import { first, type RawSearchParams } from "@/components/search-params";
import { StatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { adminListBranches, adminListVehicles, listFeatures } from "@/server/admin";
import { listCategories } from "@/server/catalog";
import { adminActor } from "../_lib/data";
import { AdminPage } from "../_lib/gate";
import { createVehicleAction } from "./actions";
import { VehicleForm } from "./vehicle-form";

export const metadata: Metadata = { title: "Fleet" };

const STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"];

async function Fleet({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const actor = await adminActor("/admin/fleet");
  const [branches, categories, features] = await Promise.all([adminListBranches(actor), listCategories(), listFeatures()]);
  const branch = branches.find((b) => b.code === first(sp.branch));
  const category = categories.find((c) => c.slug === first(sp.category));
  const status = STATUSES.find((s) => s === first(sp.status));
  const q = first(sp.q)?.slice(0, 60) || undefined;
  const vehicles = await adminListVehicles(actor, { branchId: branch?.id, categoryId: category?.id, status, q });

  return (
    <div className="space-y-6">
      <form action="/admin/fleet" aria-label="Filter fleet" className="grid gap-3 rounded-xl border border-line bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="fq">Search</Label>
          <Input id="fq" name="q" defaultValue={q} placeholder="Make, model, plate, VIN" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fbranch">Branch</Label>
          <Select id="fbranch" name="branch" defaultValue={branch?.code ?? ""}>
            <option value="">All</option>
            {branches.map((b) => (
              <option key={b.id} value={b.code}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fcategory">Category</Label>
          <Select id="fcategory" name="category" defaultValue={category?.slug ?? ""}>
            <option value="">All</option>
            {categories.map((c) => (
              <option key={c.id} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="fstatus">Status</Label>
          <Select id="fstatus" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex gap-2">
          <button type="submit" className={buttonClass("primary")}>
            Apply
          </button>
          <Link href="/admin/fleet" className={buttonClass("secondary")}>
            Reset
          </Link>
        </div>
      </form>

      {vehicles.length === 0 ? (
        <EmptyState title="No vehicles found" />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <caption className="sr-only">Fleet, {vehicles.length} vehicles</caption>
            <thead className="border-b border-line bg-canvas text-xs uppercase text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Plate</th>
                <th scope="col" className="px-4 py-3">Branch</th>
                <th scope="col" className="px-4 py-3">Category</th>
                <th scope="col" className="px-4 py-3 text-right">Rate / day</th>
                <th scope="col" className="px-4 py-3 text-right">Odometer</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {vehicles.map((v) => (
                <tr key={v.id} data-testid="admin-vehicle-row">
                  <td className="px-4 py-3">
                    <Link href={`/admin/fleet/${v.id}`} className="font-medium text-brand-700 underline">
                      {v.make} {v.model}
                    </Link>{" "}
                    <span className="text-muted">{v.year}</span>
                  </td>
                  <td className="px-4 py-3 font-mono">{v.plateNumber}</td>
                  <td className="px-4 py-3">{v.branchCode}</td>
                  <td className="px-4 py-3">{v.categoryName}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {formatAED(v.dailyRateFils)}
                    {v.rateOverrideFils != null ? <span className="block text-xs text-muted">override</span> : null}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{v.mileageKm.toLocaleString("en-AE")} km</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add a vehicle</CardTitle>
        </CardHeader>
        <CardBody>
          <VehicleForm
            action={createVehicleAction}
            branches={branches}
            categories={categories}
            features={features}
            submitLabel="Add vehicle"
          />
        </CardBody>
      </Card>
    </div>
  );
}

export default function AdminFleetPage({ searchParams }: PageProps<"/admin/fleet">) {
  return (
    <AdminPage path="/admin/fleet">
      <PageHeader title="Fleet" />
      <div className="mt-6">
        <Suspense fallback={<ListSkeleton label="Loading fleet" rows={8} />}>
          <Fleet searchParams={searchParams} />
        </Suspense>
      </div>
    </AdminPage>
  );
}
