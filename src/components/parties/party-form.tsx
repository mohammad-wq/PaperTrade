"use client";

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PartyType } from "@prisma/client";
import { AlertCircle, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { partySchema, type PartyInput } from "@/schemas/party";
import { useConfirm } from "@/components/providers/confirm-provider";

const EMPTY_VALUES: PartyInput = {
  name: "",
  type: PartyType.CUSTOMER,
  phone: "",
  email: "",
  address: "",
  creditLimit: 0,
  isActive: true,
};

type PartyFormProps = {
  initialValues?: Partial<PartyInput>;
  onSubmit: (values: PartyInput) => Promise<void>;
  onDelete?: () => Promise<void>;
  submitLabel?: string;
  deleteLabel?: string;
  submitting?: boolean;
};

export function PartyForm({
  initialValues,
  onSubmit,
  onDelete,
  submitLabel = "Save party",
  deleteLabel = "Delete",
  submitting = false,
}: PartyFormProps) {
  const confirm = useConfirm();
  const [serverError, setServerError] = useState<string | null>(null);

  const defaultValues = useMemo(
    () => ({
      ...EMPTY_VALUES,
      ...initialValues,
      name: initialValues?.name ?? "",
      phone: initialValues?.phone ?? "",
      email: initialValues?.email ?? "",
      address: initialValues?.address ?? "",
      creditLimit: initialValues?.creditLimit ?? 0,
      type: initialValues?.type ?? PartyType.CUSTOMER,
    }),
    [initialValues],
  );

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<PartyInput>({
    resolver: zodResolver(partySchema),
    defaultValues,
  });

  useEffect(() => {
    reset(defaultValues);
  }, [defaultValues, reset]);

  const type = watch("type");

  async function handleFormSubmit(values: PartyInput) {
    setServerError(null);
    const action = initialValues?.name ? "save changes to this party" : "create this party";
    const ok = await confirm({
      title: initialValues?.name ? "Update Party" : "Create Party",
      description: `Are you sure you want to ${action}?`,
      confirmText: initialValues?.name ? "Save Changes" : "Create Party",
      variant: "primary",
    });
    if (!ok) return;

    try {
      const sanitized: PartyInput = {
        ...values,
        phone: values.phone?.trim() || "",
        email: values.email?.trim() || "",
        address: values.address?.trim() || "",
        creditLimit: values.type === PartyType.CUSTOMER ? (values.creditLimit ?? null) : null,
      };
      await onSubmit(sanitized);
    } catch (error) {
      setServerError(error instanceof Error ? error.message : "Unable to save party.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Party details</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-5" noValidate>
          {serverError ? (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4" />
              <span>{serverError}</span>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name">
                Party Name <span className="text-rose-500">*</span>
              </Label>
              <Input id="name" placeholder="e.g. Al-Madina Paper Mart or Packages Ltd" {...register("name")} />
              {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">
                Party Type <span className="text-rose-500">*</span>
              </Label>
              <select
                id="type"
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                {...register("type")}
              >
                <option value={PartyType.CUSTOMER}>Customer (Buyer)</option>
                <option value={PartyType.SUPPLIER}>Supplier (Paper Mill / Vendor)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="isActive">
                Account Status <span className="text-rose-500">*</span>
              </Label>
              <select
                id="isActive"
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                {...register("isActive", { setValueAs: (value) => value === true || value === "true" })}
              >
                <option value="true">Active (Can trade)</option>
                <option value="false">Inactive (Suspended)</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">
                Phone Number <span className="text-slate-400 font-normal text-xs">(Optional)</span>
              </Label>
              <Input id="phone" placeholder="e.g. 0300-1234567" {...register("phone")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">
                Email Address <span className="text-slate-400 font-normal text-xs">(Optional)</span>
              </Label>
              <Input id="email" type="email" placeholder="name@business.com" {...register("email")} />
              {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
            </div>

            {type === PartyType.CUSTOMER ? (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="creditLimit">
                  Credit Limit in PKR <span className="text-slate-400 font-normal text-xs">(Optional)</span>
                </Label>
                <Input id="creditLimit" type="number" step="0.01" placeholder="e.g. 500000 (leave empty for unlimited)" {...register("creditLimit", { valueAsNumber: true })} />
                {errors.creditLimit ? <p className="text-sm text-destructive">{errors.creditLimit.message}</p> : null}
              </div>
            ) : null}

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">
                Address & City <span className="text-slate-400 font-normal text-xs">(Optional)</span>
              </Label>
              <Textarea id="address" placeholder="e.g. Shop # 14, Circular Road, Lahore" {...register("address")} />
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
            {onDelete ? (
              <Button
                type="button"
                variant="destructive"
                onClick={async () => {
                  const ok = await confirm({
                    title: "Delete Party",
                    description: "Are you sure you want to delete this party? It will be removed from your contact directory.",
                    confirmText: "Delete Party",
                    variant: "destructive",
                  });
                  if (ok) void onDelete();
                }}
                disabled={submitting || isSubmitting}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {deleteLabel}
              </Button>
            ) : null}
            <Button type="submit" disabled={submitting || isSubmitting}>
              <Save className="mr-2 h-4 w-4" />
              {isSubmitting || submitting ? "Saving…" : submitLabel}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
