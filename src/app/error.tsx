"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RotateCcw, Home } from "lucide-react";

export default function GlobalErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Route level unhandled error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#faf8f5] p-6 text-center">
      <div className="w-full max-w-md rounded-2xl border border-amber-950/10 bg-white p-8 shadow-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-50 text-rose-800 border border-rose-200 mb-4">
          <AlertTriangle className="h-7 w-7" />
        </div>
        <h1 className="text-xl font-bold text-slate-900">Application Error</h1>
        <p className="text-xs text-slate-600 mt-2 leading-relaxed">
          An unexpected problem occurred while loading this page. The system is protected and your underlying database records remain safe.
        </p>

        {error.message && (
          <div className="mt-4 max-h-24 overflow-y-auto rounded-lg bg-slate-50 p-2.5 text-left text-[11px] font-mono text-slate-700 border border-slate-200">
            {error.message}
          </div>
        )}

        <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => reset()}
            className="text-xs border-slate-200"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
            Try Again
          </Button>
          <Button asChild size="sm" className="bg-emerald-800 text-white hover:bg-emerald-700 text-xs">
            <a href="/dashboard">
              <Home className="mr-1.5 h-3.5 w-3.5 text-emerald-200" />
              Return to Dashboard
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

