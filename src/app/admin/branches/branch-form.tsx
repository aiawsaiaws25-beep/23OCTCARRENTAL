import { ActionForm, type FormAction } from "@/components/action-form";
import { Field, Input } from "@/components/ui/field";
import type { BranchSummary } from "@/server/catalog";

const checkbox = "size-4 rounded accent-brand-600";

export function BranchForm({ action, branch, submitLabel }: { action: FormAction; branch?: BranchSummary; submitLabel: string }) {
  return (
    <ActionForm action={action} submitLabel={submitLabel} pendingLabel="Saving…" testId="branch-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="b-code" label="Code" hint="2-10 letters or digits, e.g. DXB">
          {(p) => <Input {...p} name="code" required pattern="[A-Za-z0-9]{2,10}" defaultValue={branch?.code} />}
        </Field>
        <Field id="b-name" label="Name">
          {(p) => <Input {...p} name="name" required defaultValue={branch?.name} />}
        </Field>
        <Field id="b-city" label="City">
          {(p) => <Input {...p} name="city" required defaultValue={branch?.city} />}
        </Field>
        <Field id="b-emirate" label="Emirate">
          {(p) => <Input {...p} name="emirate" required defaultValue={branch?.emirate} />}
        </Field>
        <Field id="b-address" label="Address" className="sm:col-span-2">
          {(p) => <Input {...p} name="address" required defaultValue={branch?.address} />}
        </Field>
        <Field id="b-phone" label="Phone">
          {(p) => <Input {...p} name="phone" type="tel" required defaultValue={branch?.phone} />}
        </Field>
        <Field id="b-email" label="Email" hint="Optional">
          {(p) => <Input {...p} name="email" type="email" defaultValue={branch?.email ?? ""} />}
        </Field>
        <Field id="b-hours" label="Opening hours" hint="Shown to customers, e.g. Daily 08:00-22:00">
          {(p) => <Input {...p} name="openingHours" required defaultValue={branch?.openingHours} />}
        </Field>
        <Field id="b-tz" label="Time zone" hint="IANA name">
          {(p) => <Input {...p} name="timeZone" required defaultValue={branch?.timeZone ?? "Asia/Dubai"} />}
        </Field>
        <Field id="b-lat" label="Latitude" hint="Optional">
          {(p) => <Input {...p} name="latitude" inputMode="decimal" defaultValue={branch?.latitude ?? ""} />}
        </Field>
        <Field id="b-lng" label="Longitude" hint="Optional">
          {(p) => <Input {...p} name="longitude" inputMode="decimal" defaultValue={branch?.longitude ?? ""} />}
        </Field>
        <Field id="b-image" label="Image path" hint="Optional, e.g. /branches/dxb.svg" className="sm:col-span-2">
          {(p) => <Input {...p} name="imageUrl" defaultValue={branch?.imageUrl ?? ""} />}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isAirport" className={checkbox} defaultChecked={branch?.isAirport ?? false} />
          Airport branch
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="active" className={checkbox} defaultChecked={branch?.active ?? true} />
          Open for bookings
        </label>
      </div>
    </ActionForm>
  );
}
