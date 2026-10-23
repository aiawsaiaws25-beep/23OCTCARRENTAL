import { ActionForm } from "@/components/action-form";
import { formatAED, formatDateTime } from "@/components/format";
import { StatusBadge } from "@/components/status-badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { createDamageAction, updateDamageAction } from "../damage/actions";

const photoInputClass =
  "h-auto py-2 file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-brand-800";

export function DamageForm({
  vehicleId,
  reservationId,
  vehicles,
  defaultStage = "OTHER",
}: {
  vehicleId?: string;
  reservationId?: string;
  vehicles?: { id: string; label: string }[];
  defaultStage?: "PICKUP" | "RETURN" | "OTHER";
}) {
  return (
    <ActionForm action={createDamageAction} submitLabel="Save damage report" pendingLabel="Uploading…" resetOnSuccess testId="damage-form">
      {reservationId ? <input type="hidden" name="reservationId" value={reservationId} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {vehicleId ? (
          <input type="hidden" name="vehicleId" value={vehicleId} />
        ) : (
          <Field id="damage-vehicle" label="Vehicle" className="sm:col-span-2">
            {(p) => (
              <Select {...p} name="vehicleId" required defaultValue="">
                <option value="" disabled>
                  Choose a vehicle
                </option>
                {vehicles?.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field id="damage-stage" label="Found at">
          {(p) => (
            <Select {...p} name="stage" defaultValue={defaultStage}>
              <option value="PICKUP">Pick-up inspection</option>
              <option value="RETURN">Return inspection</option>
              <option value="OTHER">Other</option>
            </Select>
          )}
        </Field>
        <Field id="damage-severity" label="Severity">
          {(p) => (
            <Select {...p} name="severity" required defaultValue="MINOR">
              <option value="MINOR">Minor</option>
              <option value="MODERATE">Moderate</option>
              <option value="MAJOR">Major</option>
            </Select>
          )}
        </Field>
        <Field id="damage-description" label="Description" className="sm:col-span-2">
          {(p) => <Textarea {...p} name="description" required minLength={3} placeholder="e.g. 10 cm scratch on rear left door" />}
        </Field>
        <Field id="damage-estimate" label="Estimated repair cost (AED)" hint="Optional">
          {(p) => <Input {...p} name="estimatedAed" inputMode="decimal" pattern="\d+(\.\d{1,2})?" />}
        </Field>
        <Field
          id="damage-charge"
          label="Charge to customer (AED, excl. VAT)"
          hint={reservationId ? "Charged from the deposit at check-in. Leave empty for no charge." : "Optional"}
        >
          {(p) => <Input {...p} name="chargedAed" inputMode="decimal" pattern="\d+(\.\d{1,2})?" />}
        </Field>
        <Field id="damage-photos" label="Photos" hint="Up to 10 JPEG, PNG or WebP images, 5 MB each. Stored privately." className="sm:col-span-2">
          {(p) => <Input {...p} name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className={photoInputClass} />}
        </Field>
      </div>
    </ActionForm>
  );
}

export type DamageRowView = {
  id: string;
  severity: string;
  status: string;
  description: string;
  chargedFils: number;
  imageUrls: string[];
  stage?: string;
  createdAt?: Date;
  vehicleName?: string;
  plateNumber?: string;
  reservationReference?: string | null;
  reservationId?: string | null;
  estimatedCostFils?: number | null;
};

export function DamageReportCard({ d }: { d: DamageRowView }) {
  return (
    <article data-testid="damage-report" className="space-y-3 rounded-xl border border-line bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={d.severity} />
          <StatusBadge status={d.status} />
          {d.stage ? <span className="text-xs text-muted">{d.stage.toLowerCase()}</span> : null}
        </div>
        {d.createdAt ? <span className="text-xs text-muted">{formatDateTime(d.createdAt)}</span> : null}
      </div>
      {d.vehicleName ? (
        <p className="text-sm font-medium">
          {d.vehicleName} <span className="text-muted">({d.plateNumber})</span>
          {d.reservationReference ? (
            <>
              {" "}
              ·{" "}
              <a href={`/admin/reservations/${d.reservationId}`} className="font-mono text-brand-700 underline">
                {d.reservationReference}
              </a>
            </>
          ) : null}
        </p>
      ) : null}
      <p className="text-sm">{d.description}</p>
      <p className="text-sm text-muted">
        Charge: <span className="font-medium text-ink">{formatAED(d.chargedFils)}</span>
        {d.estimatedCostFils != null ? ` · Estimate ${formatAED(d.estimatedCostFils)}` : ""}
      </p>
      {d.imageUrls.length ? (
        <ul className="flex flex-wrap gap-2" aria-label="Damage photos">
          {d.imageUrls.map((url, i) => (
            <li key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer" className="block">
                {/* Private, authorised file route: next/image would bypass the session check. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Damage photo ${i + 1}`} className="size-24 rounded-lg object-cover ring-1 ring-line" />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      <details>
        <summary className="cursor-pointer text-sm font-medium text-brand-700">Update report</summary>
        <div className="mt-3">
          <ActionForm action={updateDamageAction.bind(null, d.id)} submitLabel="Update" variant="secondary" pendingLabel="Saving…">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id={`status-${d.id}`} label="Status">
                {(p) => (
                  <Select {...p} name="status" defaultValue={d.status}>
                    <option value="OPEN">Open</option>
                    <option value="CHARGED">Charged</option>
                    <option value="RESOLVED">Resolved</option>
                  </Select>
                )}
              </Field>
              <Field id={`charge-${d.id}`} label="Charge (AED, excl. VAT)">
                {(p) => (
                  <Input
                    {...p}
                    name="chargedAed"
                    inputMode="decimal"
                    pattern="\d+(\.\d{1,2})?"
                    defaultValue={(d.chargedFils / 100).toFixed(2)}
                  />
                )}
              </Field>
              <Field id={`photos-${d.id}`} label="Add photos">
                {(p) => <Input {...p} name="photos" type="file" multiple accept="image/jpeg,image/png,image/webp" className={photoInputClass} />}
              </Field>
            </div>
          </ActionForm>
        </div>
      </details>
    </article>
  );
}
