import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { Container } from "@/components/ui/page-header";
import { PageSkeleton } from "@/components/ui/skeleton";
import { requireAdmin } from "@/server/session";

async function Gate({ path, children }: { path: string; children: ReactNode }) {
  await connection();
  // Signed out -> /login?next=..., signed in without ADMIN -> 404. Nothing renders before this.
  await requireAdmin(path);
  return <>{children}</>;
}

/** Wraps every admin page: the whole page body renders only after the server-side admin check. */
export function AdminPage({ path, children }: { path: string; children: ReactNode }) {
  return (
    <Container className="py-8">
      <Suspense fallback={<PageSkeleton label="Loading admin" />}>
        <Gate path={path}>{children}</Gate>
      </Suspense>
    </Container>
  );
}
