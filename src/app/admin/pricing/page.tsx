import type { Metadata } from "next";
import { Suspense } from "react";
import { ActionForm } from "@/components/action-form";
import { formatAED, formatDate } from "@/components/format";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ListSkeleton } from "@/components/ui/skeleton";
import { adminListBranches, adminListExtras, listPricingRules, VAT_RATE } from "@/server/admin";
import { listCategories } from "@/server/catalog";
import { adminActor } from "../_lib/data";
import { filsToAedInput } from "../_lib/form";
import { AdminPage } from "../_lib/gate";
import { createRuleAction, deleteRuleAction, toggleRuleAction, updateCategoryAction, updateExtraAction } from "./actions";

export const metadata: Metadata = { title: "Pricing" };

const money = { inputMode: "decimal" as const, pattern: "\\d+(\\.\\d{1,2})?" };

function CategoryOptions({ categories }: { categories: { id: string; name: string }[] }) {
  return (
    <>
      <option value="">All categories</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );
}

async function Pricing() {
  const actor = await adminActor("/admin/pricing");
  const [categories, extras, rules, branches] = await Promise.all([
    listCategories(),
    adminListExtras(actor),
    listPricingRules(actor),
    adminListBranches(actor),
  ]);
  const catName = (id: string | null) => (id ? (categories.find((c) => c.id === id)?.name ?? "?") : "All categories");
  const branchName = (id: string | null) => (id ? (branches.find((b) => b.id === id)?.code ?? "?") : "Any");

  return (
    <div className="space-y-8">
      <Card>
        <CardBody className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            VAT rate: <span className="font-semibold">{VAT_RATE.bps / 100}%</span> (UAE standard rate, applied to rental, extras, fees and
            return charges; not to the deposit).
          </span>
          <Badge>Set by law, not editable</Badge>
        </CardBody>
      </Card>

      <section aria-labelledby="cat-heading" className="space-y-3">
        <h2 id="cat-heading" className="text-lg font-semibold">
          Daily rates and deposits by category
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {categories.map((c) => (
            <Card key={c.id} data-testid="category-pricing">
              <CardBody>
                <ActionForm action={updateCategoryAction.bind(null, c.id)} submitLabel={`Save ${c.name}`} variant="secondary" pendingLabel="Saving…">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={`c-name-${c.id}`} label="Name">
                      {(p) => <Input {...p} name="name" required defaultValue={c.name} />}
                    </Field>
                    <Field id={`c-desc-${c.id}`} label="Description">
                      {(p) => <Input {...p} name="description" defaultValue={c.description ?? ""} />}
                    </Field>
                    <Field id={`c-rate-${c.id}`} label="Daily rate (AED, excl. VAT)">
                      {(p) => <Input {...p} {...money} name="rateAed" required defaultValue={filsToAedInput(c.dailyRateFils)} />}
                    </Field>
                    <Field id={`c-dep-${c.id}`} label="Security deposit (AED)">
                      {(p) => <Input {...p} {...money} name="depositAed" required defaultValue={filsToAedInput(c.depositFils)} />}
                    </Field>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="extras-heading" className="space-y-3">
        <h2 id="extras-heading" className="text-lg font-semibold">
          Extras
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {extras.map((e) => (
            <Card key={e.id} data-testid="extra-pricing">
              <CardBody>
                <ActionForm action={updateExtraAction.bind(null, e.id)} submitLabel={`Save ${e.name}`} variant="secondary" pendingLabel="Saving…">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field id={`e-name-${e.id}`} label="Name">
                      {(p) => <Input {...p} name="name" required defaultValue={e.name} />}
                    </Field>
                    <Field id={`e-pricing-${e.id}`} label="Charged">
                      {(p) => (
                        <Select {...p} name="pricing" defaultValue={e.pricing}>
                          <option value="PER_DAY">Per day</option>
                          <option value="PER_RENTAL">Per rental</option>
                        </Select>
                      )}
                    </Field>
                    <Field id={`e-price-${e.id}`} label="Price (AED, excl. VAT)">
                      {(p) => <Input {...p} {...money} name="priceAed" required defaultValue={filsToAedInput(e.priceFils)} />}
                    </Field>
                    <Field id={`e-max-${e.id}`} label="Cap per rental (AED)" hint="Optional, per-day extras only">
                      {(p) => <Input {...p} {...money} name="maxPriceAed" defaultValue={filsToAedInput(e.maxPriceFils)} />}
                    </Field>
                    <Field id={`e-qty-${e.id}`} label="Max quantity">
                      {(p) => <Input {...p} name="maxQuantity" type="number" min={1} max={10} required defaultValue={e.maxQuantity} />}
                    </Field>
                    <label className="flex items-center gap-2 self-end pb-3 text-sm">
                      <input type="checkbox" name="active" defaultChecked={e.active} className="size-4 rounded accent-brand-600" />
                      Offered to customers
                    </label>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="rules-heading" className="space-y-3">
        <h2 id="rules-heading" className="text-lg font-semibold">
          Pricing rules
        </h2>
        <div className="relative overflow-x-auto rounded-xl border border-line bg-white shadow-sm">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-canvas text-xs uppercase text-muted">
              <tr>
                <th scope="col" className="px-4 py-3">Rule</th>
                <th scope="col" className="px-4 py-3">Applies to</th>
                <th scope="col" className="px-4 py-3">Effect</th>
                <th scope="col" className="px-4 py-3">Status</th>
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rules.map((r) => (
                <tr key={r.id} data-testid="pricing-rule-row">
                  <td className="px-4 py-3">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-muted">{r.type.replaceAll("_", " ").toLowerCase()}</span>
                  </td>
                  <td className="px-4 py-3">
                    {catName(r.categoryId)}
                    {r.type === "ONE_WAY_FEE" ? (
                      <span className="block text-xs text-muted">
                        {branchName(r.pickupBranchId)} to {branchName(r.returnBranchId)}
                      </span>
                    ) : null}
                    {r.type === "SEASONAL" && r.validFrom && r.validTo ? (
                      <span className="block text-xs text-muted">
                        {formatDate(r.validFrom)} to {formatDate(r.validTo)}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    {r.type === "ONE_WAY_FEE"
                      ? formatAED(r.feeFils ?? 0)
                      : `${(r.adjustmentBp ?? 0) > 0 ? "+" : ""}${(r.adjustmentBp ?? 0) / 100}%${r.minDays ? ` from ${r.minDays} days` : ""}`}
                  </td>
                  <td className="px-4 py-3">{r.active ? <Badge tone="success">Active</Badge> : <Badge>Paused</Badge>}</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <form action={toggleRuleAction.bind(null, r.id, !r.active)}>
                        <button type="submit" className={buttonClass("ghost", "sm")} aria-label={`${r.active ? "Pause" : "Activate"} ${r.name}`}>
                          {r.active ? "Pause" : "Activate"}
                        </button>
                      </form>
                      <form action={deleteRuleAction.bind(null, r.id)}>
                        <button type="submit" className={buttonClass("ghost", "sm", "text-red-700 hover:bg-red-50")} aria-label={`Delete ${r.name}`}>
                          Delete
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
              {rules.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    No pricing rules.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New seasonal rule</CardTitle>
            </CardHeader>
            <CardBody>
              <ActionForm action={createRuleAction} submitLabel="Add seasonal rule" variant="secondary" resetOnSuccess>
                <input type="hidden" name="type" value="SEASONAL" />
                <Field id="s-name" label="Name">
                  {(p) => <Input {...p} name="name" required placeholder="e.g. Winter peak" />}
                </Field>
                <Field id="s-cat" label="Category">
                  {(p) => (
                    <Select {...p} name="categoryId">
                      <CategoryOptions categories={categories} />
                    </Select>
                  )}
                </Field>
                <Field id="s-from" label="From (inclusive)">
                  {(p) => <Input {...p} name="validFrom" type="date" required />}
                </Field>
                <Field id="s-to" label="Until (exclusive)">
                  {(p) => <Input {...p} name="validTo" type="date" required />}
                </Field>
                <Field id="s-adj" label="Adjustment (%)" hint="e.g. 20 for +20%, -10 for -10%">
                  {(p) => <Input {...p} name="adjustmentPct" inputMode="decimal" required />}
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New long-rental discount</CardTitle>
            </CardHeader>
            <CardBody>
              <ActionForm action={createRuleAction} submitLabel="Add discount" variant="secondary" resetOnSuccess>
                <input type="hidden" name="type" value="DURATION_DISCOUNT" />
                <Field id="d-name" label="Name">
                  {(p) => <Input {...p} name="name" required placeholder="e.g. Weekly discount" />}
                </Field>
                <Field id="d-cat" label="Category">
                  {(p) => (
                    <Select {...p} name="categoryId">
                      <CategoryOptions categories={categories} />
                    </Select>
                  )}
                </Field>
                <Field id="d-min" label="Minimum rental days">
                  {(p) => <Input {...p} name="minDays" type="number" min={1} max={90} required />}
                </Field>
                <Field id="d-adj" label="Discount (%)" hint="Negative, e.g. -10">
                  {(p) => <Input {...p} name="adjustmentPct" inputMode="decimal" required />}
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">New one-way fee</CardTitle>
            </CardHeader>
            <CardBody>
              <ActionForm action={createRuleAction} submitLabel="Add one-way fee" variant="secondary" resetOnSuccess>
                <input type="hidden" name="type" value="ONE_WAY_FEE" />
                <Field id="o-name" label="Name">
                  {(p) => <Input {...p} name="name" required placeholder="e.g. Dubai to Abu Dhabi" />}
                </Field>
                <Field id="o-cat" label="Category">
                  {(p) => (
                    <Select {...p} name="categoryId">
                      <CategoryOptions categories={categories} />
                    </Select>
                  )}
                </Field>
                <Field id="o-from" label="Pick-up branch">
                  {(p) => (
                    <Select {...p} name="pickupBranchId">
                      <option value="">Any</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="o-to" label="Return branch">
                  {(p) => (
                    <Select {...p} name="returnBranchId">
                      <option value="">Any</option>
                      {branches.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field id="o-fee" label="Fee (AED, excl. VAT)">
                  {(p) => <Input {...p} {...money} name="feeAed" required />}
                </Field>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </section>
    </div>
  );
}

export default function AdminPricingPage() {
  return (
    <AdminPage path="/admin/pricing">
      <PageHeader title="Pricing" description="Changes apply to new quotes. Existing bookings keep the price they were booked at." />
      <div className="mt-6">
        <Suspense fallback={<ListSkeleton label="Loading pricing" rows={6} />}>
          <Pricing />
        </Suspense>
      </div>
    </AdminPage>
  );
}
