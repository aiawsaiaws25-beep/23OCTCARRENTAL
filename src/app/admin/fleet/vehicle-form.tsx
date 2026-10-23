import { ActionForm, type FormAction } from "@/components/action-form";
import { Fieldset, Field, Input, Select, Textarea } from "@/components/ui/field";
import { filsToAedInput } from "../_lib/form";

export type VehicleFormValues = {
  branchId: string;
  categoryId: string;
  slug: string;
  make: string;
  model: string;
  year: number;
  plateNumber: string;
  vin: string;
  color: string | null;
  transmission: string;
  fuelType: string;
  seats: number;
  doors: number;
  luggage: number;
  dailyRateFils: number | null;
  mileageKm: number;
  status: string;
  images: string[];
  featureIds: string[];
};

const STATUSES = ["AVAILABLE", "RESERVED", "ON_RENT", "MAINTENANCE", "RETIRED"];

export function VehicleForm({
  action,
  vehicle,
  branches,
  categories,
  features,
  submitLabel,
}: {
  action: FormAction;
  vehicle?: VehicleFormValues;
  branches: { id: string; name: string }[];
  categories: { id: string; name: string; dailyRateFils: number }[];
  features: { id: string; name: string }[];
  submitLabel: string;
}) {
  const v = vehicle;
  return (
    <ActionForm action={action} submitLabel={submitLabel} pendingLabel="Saving…" testId="vehicle-form">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="v-make" label="Make">
          {(p) => <Input {...p} name="make" required defaultValue={v?.make} />}
        </Field>
        <Field id="v-model" label="Model">
          {(p) => <Input {...p} name="model" required defaultValue={v?.model} />}
        </Field>
        <Field id="v-year" label="Year">
          {(p) => <Input {...p} name="year" type="number" min={1990} max={2100} required defaultValue={v?.year} />}
        </Field>
        <Field id="v-plate" label="Plate number">
          {(p) => <Input {...p} name="plateNumber" required defaultValue={v?.plateNumber} />}
        </Field>
        <Field id="v-vin" label="VIN" hint="17 characters, no I, O or Q">
          {(p) => <Input {...p} name="vin" required minLength={17} maxLength={17} defaultValue={v?.vin} />}
        </Field>
        <Field id="v-color" label="Colour" hint="Optional">
          {(p) => <Input {...p} name="color" defaultValue={v?.color ?? ""} />}
        </Field>
        <Field id="v-branch" label="Branch">
          {(p) => (
            <Select {...p} name="branchId" required defaultValue={v?.branchId ?? branches[0]?.id}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="v-category" label="Category">
          {(p) => (
            <Select {...p} name="categoryId" required defaultValue={v?.categoryId ?? categories[0]?.id}>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} (AED {(c.dailyRateFils / 100).toFixed(2)}/day)
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="v-rate" label="Daily rate override (AED)" hint="Leave empty to use the category rate">
          {(p) => <Input {...p} name="rateAed" inputMode="decimal" pattern="\d+(\.\d{1,2})?" defaultValue={filsToAedInput(v?.dailyRateFils)} />}
        </Field>
        <Field id="v-transmission" label="Transmission">
          {(p) => (
            <Select {...p} name="transmission" defaultValue={v?.transmission ?? "AUTOMATIC"}>
              <option value="AUTOMATIC">Automatic</option>
              <option value="MANUAL">Manual</option>
            </Select>
          )}
        </Field>
        <Field id="v-fuel" label="Fuel type">
          {(p) => (
            <Select {...p} name="fuelType" defaultValue={v?.fuelType ?? "PETROL"}>
              <option value="PETROL">Petrol</option>
              <option value="DIESEL">Diesel</option>
              <option value="HYBRID">Hybrid</option>
              <option value="ELECTRIC">Electric</option>
            </Select>
          )}
        </Field>
        <Field id="v-status" label="Status">
          {(p) => (
            <Select {...p} name="status" defaultValue={v?.status ?? "AVAILABLE"}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s.replace("_", " ").toLowerCase()}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="v-seats" label="Seats">
          {(p) => <Input {...p} name="seats" type="number" min={1} max={15} required defaultValue={v?.seats ?? 5} />}
        </Field>
        <Field id="v-doors" label="Doors">
          {(p) => <Input {...p} name="doors" type="number" min={2} max={6} required defaultValue={v?.doors ?? 4} />}
        </Field>
        <Field id="v-luggage" label="Bags">
          {(p) => <Input {...p} name="luggage" type="number" min={0} max={10} required defaultValue={v?.luggage ?? 2} />}
        </Field>
        <Field id="v-mileage" label="Odometer (km)">
          {(p) => <Input {...p} name="mileageKm" type="number" min={0} required defaultValue={v?.mileageKm ?? 0} />}
        </Field>
        <Field id="v-slug" label="Photo slug" hint="Lowercase, e.g. toyota-yaris">
          {(p) => <Input {...p} name="slug" required pattern="[a-z0-9-]{2,60}" defaultValue={v?.slug} />}
        </Field>
        <Field id="v-images" label="Photo paths" hint="One per line, e.g. /vehicles/toyota-yaris.svg" className="sm:col-span-2 lg:col-span-1">
          {(p) => <Textarea {...p} name="images" rows={2} defaultValue={v?.images.join("\n") ?? ""} />}
        </Field>
      </div>
      {features.length ? (
        <Fieldset legend="Features" className="mt-2">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <label key={f.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="featureIds"
                  value={f.id}
                  defaultChecked={v?.featureIds.includes(f.id)}
                  className="size-4 rounded accent-brand-600"
                />
                {f.name}
              </label>
            ))}
          </div>
        </Fieldset>
      ) : null}
    </ActionForm>
  );
}
