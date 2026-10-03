import { redirect } from "next/navigation";
import { assertPageAccess } from "@/lib/auth/session";

export default async function FinancialReportsPage() {
  await assertPageAccess("/reports");
  redirect("/reports");
}
