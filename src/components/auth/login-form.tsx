"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { loginSchema, type LoginInput } from "@/schemas/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Lock, Mail, AlertCircle, ArrowRight, ShieldCheck } from "lucide-react";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginInput) {
    setFormError(null);
    const result = await signIn("credentials", {
      email: values.email,
      password: values.password,
      redirect: false,
    });

    if (!result || result.error) {
      setFormError("Invalid email or password, or your account has been deactivated.");
      return;
    }

    const targetUrl = searchParams.get("callbackUrl") || "/dashboard";
    window.location.href = targetUrl;
  }

  return (
    <Card className="w-full max-w-md border-slate-200/80 bg-white/95 shadow-xl backdrop-blur-xs">
      <CardHeader className="space-y-3 text-center pb-4">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-800 text-amber-200 shadow-md font-bold text-lg tracking-tight">
          PT
        </div>
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/60 bg-emerald-50/80 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Paper Trade ERP
          </div>
          <CardTitle className="mt-2 text-xl font-bold tracking-tight text-slate-900">
            Welcome back
          </CardTitle>
          <CardDescription className="text-xs text-slate-500 mt-1">
            Sign in to access shop inventory, sales invoices, and ledger accounts.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-6">
        <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
          {formError && (
            <div className="rounded-lg border border-rose-200 bg-rose-50/80 p-3 text-xs text-rose-800 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-xs font-semibold text-slate-700">
              Email Address
            </Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="email"
                type="email"
                placeholder="name@business.com"
                autoComplete="email"
                className="pl-9 text-xs h-9 border-slate-200 focus-visible:ring-emerald-700"
                {...register("email")}
              />
            </div>
            {errors.email && (
              <p className="text-[11px] font-medium text-rose-600">{errors.email.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="text-xs font-semibold text-slate-700">
              Password
            </Label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                autoComplete="current-password"
                className="pl-9 text-xs h-9 border-slate-200 focus-visible:ring-emerald-700"
                {...register("password")}
              />
            </div>
            {errors.password && (
              <p className="text-[11px] font-medium text-rose-600">{errors.password.message}</p>
            )}
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="mt-1 w-full bg-emerald-800 hover:bg-emerald-700 text-white text-xs font-semibold h-9 shadow-sm"
          >
            {isSubmitting ? "Signing in..." : "Sign in to Dashboard"}
            <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>

          <p className="text-center text-[11px] text-slate-600 pt-2 border-t border-slate-100">
            For local setup support or new staff access, contact your system administrator.
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
