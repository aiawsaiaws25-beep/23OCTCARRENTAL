import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { formatAED, formatDateTime } from "@/components/format";
import { first, zonedToUtc, type RawSearchParams } from "@/components/search-params";
import { ReservationStatusBadge } from "@/components/status-badge";
import { buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { listBranches } from "@/server/catalog";
import { adminListReservations } from "../_lib/data";
import { AdminPage } from "../_lib/gate";

export const metadata: Metadata = { title: "Reservations" };

const STATUSES = ["PENDING", "CONFIRMED", "PICKED_UP", "RETURNED", "CANCELLED", "EXPIRED", "REFUNDED"];
const PAGE_SIZE = 25;

async function Results({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const sp = await searchParams;
  const status = STATUSES.find((s) => s === first(sp.status));
  const branchCode = first(sp.branch);
  const q = first(sp.q)?.slice(0, 100) || undefined;
  const fromDate = first(sp.from);
  const toDate = first(sp.to);
  const page = Math.max(1, Number(first(sp.page)) || 1);
  const branches = await listBranches({ includeInactive: true });
  const branch = branches.find((b) => b.code === branchCode);
  const valid = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

  const { rows, total } = await adminListReservations({
    status,
    branchId: branch?.id,
    q,
    from: valid(fromDate) ? zonedToUtc(fromDate!, "00:00") : undefined,
    to: valid(toDate) ? zonedToUtc(toDate!, "23:59") : undefined,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) {
      const val = first(v);
      if (val && k !== "page") params.set(k, val);
    }
    params.set("page", String(p));
    return `/admin/reservations?${params}`;
  };

  return (
    <div className="space-y-4">
      <form action="/admin/reservations" className="grid gap-3 rounded-xl border border-line bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-6 lg:items-end" aria-label="Filter reservations">
        <div className="space-y-1.5 lg:col-span-2">
          <Label htmlFor="q">Search</Label>
          <Input id="q" name="q" defaultValue={q} placeholder="Reference, customer, email or plate" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="status">Status</Label>
          <Select id="status" name="status" defaultValue={status ?? ""}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace("_", " ").toLowerCase()}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="branch">Branch</Label>
          <Select id="branch" name="branch" defaultValue={branch?.code ?? ""}>
            <option value="">All</option>
            {branches.map((b) => (
              <option key={b.id} value={b.code}>
                {b.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="from">From</Label>
          <Input id="from" name="from" type="date" defaultValue={valid(fromDate)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="to">To</Label>
          <Input id="to" name="to" type="date" defaultValue={valid(toDate)} />
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-6">
          <button type="submit" className={buttonClass("primary")}>
            Apply
          </button>
          <Link href="/admin/reservations" className={buttonClass("secondary")}>
            Reset
          </Link>
        </div>
      </form>

      <p className="text-sm text-muted" data-testid="admin-reservations-total">
        {total} reservation{total === 1 ? "" : "s"}
      </p>
      {rows.length === 0 ? (
        <EmptyState title="No reservations found" description="Try a different filter." />
      ) : (
        <div className="relative overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Reference</th>
                <th scope="col" className="px-4 py-3">Customer</th>
                <th scope="col" className="px-4 py-3">Vehicle</th>
                <th scope="col" className="px-4 py-3">Pick-up</th>
                <th scope="col" className="px-4 py-3">Return</th>
                <th scope="col" className="px-4 py-3 text-right">Total</th>
                <th scope="col" className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} data-testid="admin-reservation-row" className="hover:bg-canvas">
                  <td className="px-4 py-3 font-mono">
                    <Link href={`/admin/reservations/${r.id}`} className="font-medium text-brand-700 underline">
                      {r.reference}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {r.customerName}
                    <div className="text-xs text-muted">{r.customerEmail}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.vehicleName}
                    <div className="text-xs text-muted">{r.plateNumber}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.pickupBranchCode}
                    <div className="text-xs text-muted">{formatDateTime(r.pickupAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    {r.returnBranchCode}
                    <div className="text-xs text-muted">{formatDateTime(r.returnAt)}</div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{formatAED(r.totalFils)}</td>
                  <td className="px-4 py-3">
                    <ReservationStatusBadge status={r.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 ? (
        <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={pageHref(page - 1)} className={buttonClass("secondary", "sm")}>
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted">
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={pageHref(page + 1)} className={buttonClass("secondary", "sm")}>
              Next
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}

export default function AdminReservationsPage({ searchParams }: PageProps<"/admin/reservations">) {
  return (
    <AdminPage path="/admin/reservations">
      <PageHeader title="Reservations" />
      <div className="mt-6">
        <Suspense fallback={<ListSkeleton label="Loading reservations" rows={8} />}>
          <Results searchParams={searchParams} />
        </Suspense>
      </div>
    </AdminPage>
  );
}
