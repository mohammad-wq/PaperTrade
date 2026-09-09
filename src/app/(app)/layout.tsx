import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SectionErrorBoundary } from "@/components/error-boundary";
import { getSession } from "@/lib/auth/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session?.user) {
    redirect("/login");
  }

  return (
    <AppShell user={session.user}>
      <SectionErrorBoundary>{children}</SectionErrorBoundary>
    </AppShell>
  );
}
