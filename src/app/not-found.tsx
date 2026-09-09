import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AlertCircle, Home, ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#faf8f5] p-6 text-center">
      <div className="w-full max-w-md rounded-2xl border border-amber-950/10 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-800 border border-amber-200 mb-4">
          <AlertCircle className="h-7 w-7" />
        </div>
        <h1 className="text-3xl font-extrabold text-slate-900">404</h1>
        <h2 className="text-lg font-bold text-slate-800 mt-1">Page Not Found</h2>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          The requested page could not be located. You may have an expired session or the URL was relocated.
        </p>

        <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
          <Button asChild variant="outline" size="sm" className="text-xs border-slate-200">
            <a href="/dashboard">
              <Home className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
              Go to Dashboard
            </a>
          </Button>
          <Button asChild size="sm" className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs">
            <a href="/login">
              Sign In
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
