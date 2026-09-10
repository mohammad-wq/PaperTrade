"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { listPartiesAction, softDeletePartyAction, upsertPartyAction } from "@/actions/parties";
import { PartyForm } from "@/components/parties/party-form";
import { Button } from "@/components/ui/button";
import { type PartyInput } from "@/schemas/party";

const EMPTY_FORM: PartyInput = { name: "", type: "CUSTOMER", phone: "", email: "", address: "", creditLimit: 0, isActive: true };

type PartyRecord = PartyInput & { id: string; balance: number };

export function PartyEditor({ partyId }: { partyId?: string }) {
  const router = useRouter();
  const [party, setParty] = useState<PartyRecord | null>(null);
  const [loading, setLoading] = useState(Boolean(partyId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadParty = useCallback(async () => {
    const result = await listPartiesAction();
    if (result.success) {
      const found = (result.data as PartyRecord[]).find((item) => item.id === partyId);
      if (found) setParty(found);
      else setError("Party not found.");
    } else setError(result.error);
    setLoading(false);
  }, [partyId]);

  useEffect(() => {
    if (partyId) void loadParty();
  }, [loadParty, partyId]);

  async function handleSubmit(values: PartyInput) {
    setSaving(true);
    try {
      const result = await upsertPartyAction({ ...values, id: partyId });
      if (!result.success) throw new Error(result.error);
      router.push("/parties");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!partyId) return;
    const result = await softDeletePartyAction({ id: partyId });
    if (!result.success) throw new Error(result.error);
    router.push("/parties");
    router.refresh();
  }

  if (loading) return <p className="text-sm text-muted-foreground">Loading party…</p>;
  if (error) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{error}</p>;

  return (
    <div className="space-y-6">
      <Button variant="ghost" className="-ml-3 text-slate-600" onClick={() => router.push("/parties")}>
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to party directory
      </Button>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-emerald-600">Contacts</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-800">{partyId ? "Edit party" : "Create party"}</h1>
      </div>

      {party && (
        <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 shadow-xs">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Current Ledger Balance</p>
            <p className={`mt-1 text-xl font-bold ${party.balance > 0 ? "text-amber-800" : party.balance < 0 ? "text-rose-700" : "text-slate-800"}`}>
              PKR {Math.abs(party.balance).toLocaleString()} {party.balance > 0 ? "Dr (Receivable)" : party.balance < 0 ? "Cr (Payable)" : "(Settled)"}
            </p>
          </div>
          {party.type === "CUSTOMER" && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Credit Limit & Exposure</p>
              <p className="mt-1 text-base font-semibold text-slate-800">
                {party.creditLimit ? `PKR ${party.creditLimit.toLocaleString()}` : "No Limit Enforced"}
              </p>
              {party.creditLimit ? (
                <p className="text-xs text-slate-600 mt-0.5">
                  Remaining Credit: PKR {Math.max(0, party.creditLimit - party.balance).toLocaleString()}
                </p>
              ) : null}
            </div>
          )}
        </div>
      )}

      <PartyForm
        initialValues={party ?? EMPTY_FORM}
        onSubmit={handleSubmit}
        onDelete={partyId ? handleDelete : undefined}
        submitting={saving}
        submitLabel={partyId ? "Update party" : "Create party"}
        deleteLabel="Deactivate party"
      />
    </div>
  );
}
