import { Suspense } from "react";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSession } from "@/lib/auth/session";

interface LoginPageProps {
  searchParams?: {
    reason?: string;
    callbackUrl?: string;
  };
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  // If no reason is present, check existing session.
  // If a reason is provided (sleep, browser_closed, inactive, expired), force credentials entry.
  if (!searchParams?.reason) {
    const session = await getSession();
    if (session?.user) {
      redirect("/dashboard");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#faf8f5] p-4">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
        <LoginForm />
      </Suspense>
    </main>
  );
}
