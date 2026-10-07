"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { PanelBottomOpen, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentWorkspaceStore, type DocumentKind } from "@/lib/document-workspace-store";

const KIND_LABEL: Record<DocumentKind, string> = {
  SALE: "Sales estimate",
  PURCHASE: "Purchase invoice",
  PO: "Purchase order",
  DO: "Delivery order",
};

export function DocumentWorkspaceDock() {
  const router = useRouter();
  const dock = useDocumentWorkspaceStore((s) => s.dock);
  const clearDock = useDocumentWorkspaceStore((s) => s.clearDock);
  const requestRestore = useDocumentWorkspaceStore((s) => s.requestRestore);

  if (!dock) return null;

  const restore = () => {
    requestRestore();
    router.push(dock.restorePath);
  };

  return (
    <div className="fixed bottom-4 right-4 z-[45] flex items-center gap-2 rounded-lg border border-slate-300 bg-white dark:bg-slate-900 shadow-lg px-3 py-2 print:hidden">
      <PanelBottomOpen className="h-4 w-4 text-emerald-700 shrink-0" />
      <div className="min-w-0">
        <p className="text-[10px] uppercase font-bold text-slate-500">{KIND_LABEL[dock.kind]}</p>
        <p className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate max-w-[200px]">
          {dock.title}
        </p>
      </div>
      <Button type="button" size="sm" className="h-7 text-xs" onClick={restore}>
        Restore
      </Button>
      <button
        type="button"
        onClick={() => clearDock()}
        className="p-1 text-slate-400 hover:text-rose-600"
        title="Discard docked draft"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/** Reopen a docked draft when Restore is clicked, including on the same page. */
export function useDockedDraft<T>(kind: DocumentKind, apply: (snapshot: T) => void) {
  const restoreNonce = useDocumentWorkspaceStore((s) => s.restoreNonce);
  const applied = useRef(0);
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const state = useDocumentWorkspaceStore.getState();
    if (state.restoreNonce === 0 || state.restoreNonce === applied.current) return;
    if (!state.dock || state.dock.kind !== kind) return;
    applied.current = state.restoreNonce;
    applyRef.current(state.dock.snapshot as T);
    useDocumentWorkspaceStore.getState().acknowledgeRestore();
  }, [restoreNonce, kind]);
}
