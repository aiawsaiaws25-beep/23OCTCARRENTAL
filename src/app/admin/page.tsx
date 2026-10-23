import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { formatDateTime } from "@/components/format";
import { addDays, todayIn, zonedToUtc } from "@/components/search-params";
import { ReservationStatusBadge } from "@/components/status-badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Field, Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { adminListDamageCount, adminListReservations, type AdminReservationRow } from "./_lib/data";
import { AdminPage } from "./_lib/gate";
import { lookupReservationAction } from "./actions";

export const metadata: Metadata = { title: "Overview" };

function MiniList({ rows, empty, when }: { rows: AdminReservationRow[]; empty: string; when: "pickup" | "return" }) {
  if (!rows.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.id}>
          <Link href={`/admin/reservations/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 py-3 hover:bg-canvas">
            <span>
              <span className="font-mono text-sm font-medium">{r.reference}</span>{" "}
              <span className="text-sm text-muted">
                {r.customerName}, {r.vehicleName} ({r.plateNumber})
              </span>
            </span>
            <span className="flex items-center gap-2 text-sm">
              {formatDateTime(when === "pickup" ? r.pickupAt : r.returnAt)}
              <ReservationStatusBadge status={r.status} />
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

async function Overview() {
  const today = todayIn();
  const start = zonedToUtc(today, "00:00");
  const end = zonedToUtc(addDays(today, 2), "00:00");
  const [pickups, returns, pending, openDamage] = await Promise.all([
    adminListReservations({ status: "CONFIRMED", from: start, to: end }),
    adminListReservations({ status: "PICKED_UP" }),
    adminListReservations({ status: "PENDING" }),
    adminListDamageCount("OPEN"),
  ]);
  const duePickups = pickups.rows.filter((r) => r.pickupAt >= start && r.pickupAt < end);
  const stats = [
    { label: "Pick-ups today and tomorrow", value: duePickups.length, href: "/admin/reservations?status=CONFIRMED" },
    { label: "Cars on rent", value: returns.total, href: "/admin/reservations?status=PICKED_UP" },
    { label: "Awaiting payment", value: pending.total, href: "/admin/reservations?status=PENDING" },
    { label: "Open damage reports", value: openDamage, href: "/admin/damage?status=OPEN" },
  ];
  return (
    <div className="space-y-6">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <li key={s.label}>
            <Link href={s.href} className="block rounded-xl border border-line bg-white p-4 shadow-sm hover:shadow-md">
              <p className="text-sm text-muted">{s.label}</p>
              <p className="mt-1 text-3xl font-bold tabular-nums">{s.value}</p>
            </Link>
          </li>
        ))}
      </ul>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Upcoming pick-ups</CardTitle>
          </CardHeader>
          <CardBody>
            <MiniList rows={duePickups} empty="No pick-ups today or tomorrow." when="pickup" />
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cars on rent (due back)</CardTitle>
          </CardHeader>
          <CardBody>
            {returns.rows.length ? (
              <MiniList rows={[...returns.rows].sort((a, b) => +a.returnAt - +b.returnAt).slice(0, 10)} empty="" when="return" />
            ) : (
              <EmptyState title="No cars on rent" className="py-6" />
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function AdminHome() {
  return (
    <AdminPage path="/admin">
      <PageHeader title="Admin overview" description="Branch desk: look up a voucher, hand cars over and take them back." />
      <Card className="mt-6">
        <CardBody>
          <ActionForm
            action={lookupReservationAction}
            submitLabel="Find reservation"
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
            testId="desk-lookup"
          >
            <Field id="code" label="Reservation reference or scanned voucher code" className="flex-1">
              {(p) => <Input {...p} name="code" placeholder="DE-ABC123" autoComplete="off" />}
            </Field>
          </ActionForm>
        </CardBody>
      </Card>
      <div className="mt-6">
        <Suspense fallback={<Skeleton className="h-96" />}>
          <Overview />
        </Suspense>
      </div>
    </AdminPage>
  );
}
