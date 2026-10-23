import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import QRCode from "qrcode";
import { Suspense } from "react";
import { formatAED, formatDateTime } from "@/components/format";
import { PrintButton } from "@/components/print-button";
import { first } from "@/components/search-params";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Container } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Stepper } from "@/components/ui/stepper";
import { getVoucher } from "@/server/account";
import { getReservationForUser } from "@/server/reservations";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Pick-up voucher" };

async function VoucherView({
  params,
  searchParams,
}: {
  params: PageProps<"/my-rentals/[id]/voucher">["params"];
  searchParams: PageProps<"/my-rentals/[id]/voucher">["searchParams"];
}) {
  await connection();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const user = await requireUser(`/my-rentals/${id}/voucher`);
  const v = await getVoucher(user.id, id);
  if (!v) {
    // Owned but without a voucher (pending, cancelled, ...) -> explain; otherwise 404.
    const r = await getReservationForUser(user.id, id);
    if (!r) notFound();
    return (
      <Alert tone="warning" title="No voucher for this booking" testId="no-voucher">
        <p>Vouchers are available for confirmed bookings only.</p>
        <ButtonLink href={`/my-rentals/${r.id}`} size="sm" className="mt-2">
          View booking
        </ButtonLink>
      </Alert>
    );
  }

  const qrSvg = await QRCode.toString(v.qrPayload, { type: "svg", errorCorrectionLevel: "M", margin: 1, width: 220 });
  const name = `${v.vehicle.make} ${v.vehicle.model}`;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {first(sp.paid) === "1" ? (
        <div className="no-print">
          <Stepper current={3} />
          <Alert tone="success" title="Payment successful. Your booking is confirmed." className="mt-4" testId="payment-success">
            We charged {formatAED(v.payment?.amountFils ?? v.quote.totalFils)} and placed a refundable deposit hold of{" "}
            {formatAED(v.deposit?.amountFils ?? v.quote.depositFils)}.
          </Alert>
        </div>
      ) : null}
      <Card className="overflow-hidden" data-testid="voucher">
        <div className="bg-brand-700 px-6 py-4 text-white">
          <p className="text-sm uppercase tracking-wide text-brand-100">DriveEasy pick-up voucher</p>
          <p className="mt-1 text-2xl font-bold">
            Reference <span data-testid="reservation-ref" className="font-mono">{v.reference}</span>
          </p>
        </div>
        <CardBody className="grid gap-6 py-6 sm:grid-cols-[1fr_auto]">
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="font-medium text-muted">Car</dt>
              <dd className="text-base font-semibold">
                {name} <span className="font-normal text-muted">({v.vehicle.categoryName} or similar)</span>
              </dd>
              {v.vehicle.plateNumber ? <dd className="text-muted">Plate {v.vehicle.plateNumber}</dd> : null}
            </div>
            <div>
              <dt className="font-medium text-muted">Pick-up</dt>
              <dd className="font-semibold">{formatDateTime(v.pickupAt, v.pickupBranch.timeZone)}</dd>
              <dd>
                {v.pickupBranch.name}, {v.pickupBranch.address}
              </dd>
              <dd className="text-muted">
                {v.pickupBranch.openingHours}. {v.pickupBranch.phone}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-muted">Return</dt>
              <dd className="font-semibold">{formatDateTime(v.returnAt, v.returnBranch.timeZone)}</dd>
              <dd>
                {v.returnBranch.name}, {v.returnBranch.address}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-muted">Main driver</dt>
              <dd>{v.driver?.fullName ?? "-"}</dd>
            </div>
            {v.extras.length ? (
              <div>
                <dt className="font-medium text-muted">Extras</dt>
                <dd>{v.extras.map((e) => (e.quantity > 1 ? `${e.name} × ${e.quantity}` : e.name)).join(", ")}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium text-muted">Paid</dt>
              <dd>
                {formatAED(v.quote.totalFils)} incl. VAT. Deposit hold {formatAED(v.quote.depositFils)}.
              </dd>
            </div>
          </dl>
          <div className="flex flex-col items-center gap-2">
            <div
              role="img"
              aria-label={`QR code for reservation ${v.reference}`}
              data-testid="voucher-qr"
              className="size-[220px] rounded-lg bg-white p-1 ring-1 ring-line [&>svg]:size-full"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <p className="text-xs text-muted">Show this code at the counter</p>
          </div>
        </CardBody>
        <div className="border-t border-line bg-canvas px-6 py-4 text-sm text-muted">
          Bring the main driver&apos;s driving licence, passport or Emirates ID, and the card used for payment.
        </div>
      </Card>
      <div className="no-print flex flex-wrap gap-2">
        <PrintButton />
        <ButtonLink href={`/my-rentals/${v.id}`} variant="secondary">
          Manage booking
        </ButtonLink>
        <ButtonLink href="/my-rentals" variant="ghost">
          All rentals
        </ButtonLink>
      </div>
    </div>
  );
}

export default function VoucherPage({ params, searchParams }: PageProps<"/my-rentals/[id]/voucher">) {
  return (
    <Container className="py-8">
      <Suspense fallback={<Skeleton className="mx-auto h-[28rem] max-w-3xl" />}>
        <VoucherView params={params} searchParams={searchParams} />
      </Suspense>
    </Container>
  );
}
