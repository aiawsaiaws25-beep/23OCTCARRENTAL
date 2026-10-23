import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { formatDate } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Container, PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { getProfile } from "@/server/account";
import { requireUser } from "@/server/session";
import { updateProfileAction } from "./actions";

export const metadata: Metadata = { title: "Profile" };

async function ProfileView() {
  await connection();
  const user = await requireUser("/profile");
  const profile = await getProfile(user.id);
  if (!profile) notFound();
  const d = profile.driver;

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardBody>
          <ActionForm action={updateProfileAction} submitLabel="Save changes" pendingLabel="Saving…" testId="profile-form">
            <Field id="name" label="Name" required>
              {(p) => <Input {...p} name="name" autoComplete="name" defaultValue={profile.name} />}
            </Field>
            <Field id="email" label="Email" hint="Contact support to change your email address.">
              {(p) => <Input {...p} type="email" value={profile.email} readOnly disabled />}
            </Field>
            <Field id="phone" label="Mobile number">
              {(p) => <Input {...p} name="phone" type="tel" autoComplete="tel" defaultValue={profile.phone ?? ""} />}
            </Field>
            {profile.role === "ADMIN" ? <Badge tone="info">Administrator</Badge> : null}
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Driver and licence</CardTitle>
        </CardHeader>
        <CardBody className="text-sm">
          {d ? (
            <dl className="grid gap-3 sm:grid-cols-2" data-testid="driver-profile">
              <div>
                <dt className="text-muted">Full name</dt>
                <dd>{d.fullName}</dd>
              </div>
              <div>
                <dt className="text-muted">Date of birth</dt>
                <dd>{formatDate(`${d.dateOfBirth}T12:00:00Z`)}</dd>
              </div>
              <div>
                <dt className="text-muted">Licence number</dt>
                <dd>{d.licenceNumber}</dd>
              </div>
              <div>
                <dt className="text-muted">Issued in</dt>
                <dd>{d.licenceCountry}</dd>
              </div>
              <div>
                <dt className="text-muted">Expires</dt>
                <dd>{formatDate(`${d.licenceExpiry}T12:00:00Z`)}</dd>
              </div>
              <div>
                <dt className="text-muted">Licence document</dt>
                <dd>{d.hasLicence ? <Badge tone="success">On file</Badge> : <Badge tone="warning">Missing</Badge>}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-muted">
              No driver details yet. They are saved the first time you book, so future bookings are faster.
            </p>
          )}
          <p className="mt-4 text-muted">You can update driver details and upload a new licence during checkout.</p>
          <ButtonLink href="/my-rentals" variant="secondary" size="sm" className="mt-4">
            My rentals
          </ButtonLink>
        </CardBody>
      </Card>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Container className="py-8">
      <PageHeader title="Your profile" />
      <div className="mt-8">
        <Suspense fallback={<Skeleton className="h-80" />}>
          <ProfileView />
        </Suspense>
      </div>
    </Container>
  );
}
