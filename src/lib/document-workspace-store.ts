import { create } from "zustand";

export type DocumentKind = "SALE" | "PURCHASE" | "PO" | "DO";

export type DocumentDockEntry = {
  kind: DocumentKind;
  title: string;
  restorePath: string;
  snapshot: unknown;
};

type DocumentWorkspaceState = {
  dock: DocumentDockEntry | null;
  restoreNonce: number;
  setDock: (entry: DocumentDockEntry) => void;
  requestRestore: () => void;
  acknowledgeRestore: () => void;
  clearDock: () => void;
};

export const useDocumentWorkspaceStore = create<DocumentWorkspaceState>((set, get) => ({
  dock: null,
  restoreNonce: 0,
  setDock: (entry) => set({ dock: entry }),
  requestRestore: () => {
    if (!get().dock) return;
    set((s) => ({ restoreNonce: s.restoreNonce + 1 }));
  },
  acknowledgeRestore: () => set({ dock: null }),
  clearDock: () => set({ dock: null }),
}));
