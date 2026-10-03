import { listPartiesAction } from "@/actions/parties";
import PartiesClient from "./parties-client";
import { Suspense } from "react";
import { assertPageAccess } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function PartiesPage() {
  await assertPageAccess("/parties");
  const res = await listPartiesAction();
  const parties = res.success && res.data ? res.data : [];

  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500 font-mono">Loading Party Directory...</div>}>
      <PartiesClient initialParties={parties as any} />
    </Suspense>
  );
}
