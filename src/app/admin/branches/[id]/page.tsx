import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { first } from "@/components/search-params";
import { Alert } from "@/components/ui/alert";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { adminListBranches } from "@/server/admin";
import { adminActor } from "../../_lib/data";
import { AdminPage } from "../../_lib/gate";
import { updateBranchAction } from "../actions";
import { BranchForm } from "../branch-form";

export const metadata: Metadata = { title: "Edit branch" };

async function EditBranch({
  params,
  searchParams,
}: {
  params: PageProps<"/admin/branches/[id]">["params"];
  searchParams: PageProps<"/admin/branches/[id]">["searchParams"];
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const branches = await adminListBranches(await adminActor("/admin/branches"));
  const branch = branches.find((b) => b.id === id);
  if (!branch) notFound();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/branches" className="text-sm text-muted underline">
          All branches
        </Link>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">{branch.name}</h1>
      </div>
      {first(sp.created) === "1" ? <Alert tone="success">Branch created.</Alert> : null}
      <Card>
        <CardBody>
          <BranchForm action={updateBranchAction.bind(null, branch.id)} branch={branch} submitLabel="Save branch" />
        </CardBody>
      </Card>
    </div>
  );
}

export default function EditBranchPage({ params, searchParams }: PageProps<"/admin/branches/[id]">) {
  return (
    <AdminPage path="/admin/branches">
      <Suspense fallback={<Skeleton className="h-96" />}>
        <EditBranch params={params} searchParams={searchParams} />
      </Suspense>
    </AdminPage>
  );
}
