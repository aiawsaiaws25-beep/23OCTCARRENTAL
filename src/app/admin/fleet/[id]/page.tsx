import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { AvailabilityCalendar } from "@/components/availability-calendar";
import { formatDateTime } from "@/components/format";
import { first, todayIn } from "@/components/search-params";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { adminGetVehicle, adminListBranches, listFeatures, listMaintenanceBlocks } from "@/server/admin";
import { getVehicleCalendar, listCategories } from "@/server/catalog";
import { adminActor } from "../../_lib/data";
import { AdminPage } from "../../_lib/gate";
import { cancelMaintenanceAction, createMaintenanceAction, updateVehicleAction } from "../actions";
import { VehicleForm } from "../vehicle-form";

export const metadata: Metadata = { title: "Vehicle" };

async function EditVehicle({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/fleet/[id]">["params"];
  searchParams: PageProps<"/admin/fleet/[id]">["searchParams"];
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const actor = await adminActor("/admin/fleet");
  const v = await adminGetVehicle(actor, id);
  if (!v) notFound();
  const [branches, categories, features, blocks] = await Promise.all([
    adminListBranches(actor),
    listCategories(),
    listFeatures(),
    listMaintenanceBlocks(actor, { vehicleId: v.id }),
  ]);
  const branch = branches.find((b) => b.id === v.branchId);
  const tz = branch?.timeZone ?? "Asia/Dubai";
  const today = todayIn(tz);
  const cal = await getVehicleCalendar(v.id, today, 42);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/fleet" className="text-sm text-muted underline">
          All vehicles
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          {v.make} {v.model} <span className="font-mono text-lg text-muted">{v.plateNumber}</span>
        </h1>
      </div>
      {first(sp.created) === "1" ? <Alert tone="success">Vehicle added.</Alert> : null}
      <Card>
        <CardBody>
          <VehicleForm
            action={updateVehicleAction.bind(null, v.id)}
            vehicle={v}
            branches={branches}
            categories={categories}
            features={features}
            submitLabel="Save vehicle"
          />
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Maintenance</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            {blocks.length ? (
              <ul className="divide-y divide-line text-sm" data-testid="maintenance-blocks">
                {blocks.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {formatDateTime(b.startAt, tz)} to {formatDateTime(b.endAt, tz)}
                      <span className="block text-muted">{b.reason}</span>
                    </span>
                    <form action={cancelMaintenanceAction.bind(null, b.id)}>
                      <button type="submit" className={buttonClass("ghost", "sm")}>
                        Cancel block
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No maintenance scheduled.</p>
            )}
            <ActionForm action={createMaintenanceAction.bind(null, v.id)} submitLabel="Schedule maintenance" variant="secondary" resetOnSuccess testId="maintenance-form">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="m-sd" label="Start date">
                  {(p) => <Input {...p} name="startDate" type="date" required min={today} />}
                </Field>
                <Field id="m-st" label="Start time">
                  {(p) => <Input {...p} name="startTime" type="time" required defaultValue="08:00" />}
                </Field>
                <Field id="m-ed" label="End date">
                  {(p) => <Input {...p} name="endDate" type="date" required min={today} />}
                </Field>
                <Field id="m-et" label="End time">
                  {(p) => <Input {...p} name="endTime" type="time" required defaultValue="18:00" />}
                </Field>
                <Field id="m-reason" label="Reason" className="sm:col-span-2">
                  {(p) => <Input {...p} name="reason" required minLength={3} placeholder="e.g. 20,000 km service" />}
                </Field>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next six weeks</CardTitle>
          </CardHeader>
          <CardBody>{cal ? <AvailabilityCalendar days={cal.days} /> : null}</CardBody>
        </Card>
      </div>
    </div>
  );
}

export default function AdminVehiclePage({ params, searchParams }: PageProps<"/admin/fleet/[id]">) {
  return (
    <AdminPage path="/admin/fleet">
      <Suspense fallback={<Skeleton className="h-[40rem]" />}>
        <EditVehicle params={params} searchParams={searchParams} />
      </Suspense>
    </AdminPage>
  );
}
