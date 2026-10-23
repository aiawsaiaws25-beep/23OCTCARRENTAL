import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { adminListBranches } from "@/server/admin";
import { adminActor } from "../_lib/data";
import { AdminPage } from "../_lib/gate";
import { createBranchAction } from "./actions";
import { BranchForm } from "./branch-form";

export const metadata: Metadata = { title: "Branches" };

async function BranchTable() {
  const branches = await adminListBranches(await adminActor("/admin/branches"));
  if (!branches.length) return <EmptyState title="No branches yet" description="Add the first branch below." />;
  return (
    <div className="relative overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="border-b border-line bg-canvas text-xs uppercase text-muted">
          <tr>
            <th scope="col" className="px-4 py-3">Code</th>
            <th scope="col" className="px-4 py-3">Name</th>
            <th scope="col" className="px-4 py-3">City</th>
            <th scope="col" className="px-4 py-3">Hours</th>
            <th scope="col" className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {branches.map((b) => (
            <tr key={b.id} data-testid="admin-branch-row">
              <td className="px-4 py-3 font-mono">{b.code}</td>
              <td className="px-4 py-3">
                <Link href={`/admin/branches/${b.id}`} className="font-medium text-brand-700 underline">
                  {b.name}
                </Link>
                {b.isAirport ? <Badge tone="info" className="ml-2">Airport</Badge> : null}
              </td>
              <td className="px-4 py-3">
                {b.city}, {b.emirate}
              </td>
              <td className="px-4 py-3">{b.openingHours}</td>
              <td className="px-4 py-3">{b.active ? <Badge tone="success">Open</Badge> : <Badge tone="danger">Closed</Badge>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function AdminBranchesPage() {
  return (
    <AdminPage path="/admin/branches">
      <PageHeader title="Branches" />
      <div className="mt-6 space-y-6">
        <Suspense fallback={<ListSkeleton label="Loading branches" />}>
          <BranchTable />
        </Suspense>
        <Card>
          <CardHeader>
            <CardTitle>Add a branch</CardTitle>
          </CardHeader>
          <CardBody>
            <BranchForm action={createBranchAction} submitLabel="Create branch" />
          </CardBody>
        </Card>
      </div>
    </AdminPage>
  );
}
