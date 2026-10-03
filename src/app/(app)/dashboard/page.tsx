import { getCachedDashboardMetrics } from "@/actions/dashboard";
import DashboardClient from "./dashboard-client";
import { assertPageAccess } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await assertPageAccess("/dashboard");
  const data = await getCachedDashboardMetrics();
  return <DashboardClient initialData={data} />;
}
