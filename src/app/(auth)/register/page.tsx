import type { Metadata } from "next";
import { Suspense } from "react";
import { RegisterForm } from "@/components/auth-forms";
import { first } from "@/components/search-params";
import { Card, CardBody } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { registerAction } from "../actions";

export const metadata: Metadata = { title: "Create an account" };

async function Form({ searchParams }: { searchParams: PageProps<"/register">["searchParams"] }) {
  const next = first((await searchParams).next);
  return <RegisterForm action={registerAction} next={next} />;
}

export default function RegisterPage({ searchParams }: PageProps<"/register">) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-12">
      <h1 className="text-center text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-2 text-center text-sm text-muted">Book faster and keep all your rentals in one place.</p>
      <Card className="mt-8">
        <CardBody className="py-6">
          <Suspense fallback={<Skeleton className="h-96" />}>
            <Form searchParams={searchParams} />
          </Suspense>
        </CardBody>
      </Card>
    </div>
  );
}
