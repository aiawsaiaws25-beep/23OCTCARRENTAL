import type { Metadata } from "next";
import { Suspense } from "react";
import { LoginForm } from "@/components/auth-forms";
import { first } from "@/components/search-params";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { loginAction } from "../actions";

export const metadata: Metadata = { title: "Log in" };

async function Form({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const next = first((await searchParams).next);
  return <LoginForm action={loginAction} next={next} />;
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-center text-2xl font-bold tracking-tight">Log in to DriveEasy</h1>
      <p className="mt-2 text-center text-sm text-muted">Manage your bookings, vouchers and profile.</p>
      <Card className="mt-8">
        <CardBody className="py-6">
          <Suspense fallback={<Skeleton className="h-64" />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </CardBody>
      </Card>
    </div>
  );
}
