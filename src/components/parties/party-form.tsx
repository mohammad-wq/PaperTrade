"use client";

import { useMemo, useState } from "react";
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
  const [serverError, setServerError] = useState<string | null>(null);

  const defaultValues = useMemo(
    () => ({
      ...EMPTY_VALUES,
      ...initialValues,
      creditLimit: initialValues?.creditLimit ?? 0,
      type: initialValues?.type ?? PartyType.CUSTOMER,
    }),
    [initialValues],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<PartyInput>({
    resolver: zodResolver(partySchema),
    defaultValues,
  });

  const type = watch("type");

  async function handleFormSubmit(values: PartyInput) {
    setServerError(null);
    const action = initialValues?.name ? "update this party" : "create this party";
    if (!window.confirm(`Confirm: ${action}?`)) return;
    try {
      await onSubmit(values);
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
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...register("name")} />
              {errors.name ? <p className="text-sm text-destructive">{errors.name.message}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                {...register("type")}
              >
                <option value={PartyType.CUSTOMER}>Customer</option>
                <option value={PartyType.SUPPLIER}>Supplier</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="isActive">Status</Label>
              <select
                id="isActive"
                className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm"
                {...register("isActive", { setValueAs: (value) => value === "true" })}
              >
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" {...register("phone")} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...register("email")} />
              {errors.email ? <p className="text-sm text-destructive">{errors.email.message}</p> : null}
            </div>

            {type === PartyType.CUSTOMER ? (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="creditLimit">Credit limit</Label>
                <Input id="creditLimit" type="number" step="0.01" {...register("creditLimit", { valueAsNumber: true })} />
                {errors.creditLimit ? <p className="text-sm text-destructive">{errors.creditLimit.message}</p> : null}
              </div>
            ) : null}

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="address">Address</Label>
              <Textarea id="address" {...register("address")} />
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
            {onDelete ? (
              <Button type="button" variant="destructive" onClick={() => {
                if (window.confirm("Confirm: deactivate this party?")) void onDelete();
              }} disabled={submitting || isSubmitting}>
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
