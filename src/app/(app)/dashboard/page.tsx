import { getCachedDashboardMetrics } from "@/actions/dashboard";
import DashboardClient from "./dashboard-client";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const data = await getCachedDashboardMetrics();
  return <DashboardClient initialData={data} />;
}
