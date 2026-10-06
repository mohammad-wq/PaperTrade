import { create } from "zustand";

export type SaleDraftLine = {
  productId: string;
  quantity: number;
  unitPrice: number;
  ownershipType?: string | null;
  ownershipKey?: string | null;
  warehouseLotId?: string | null;
  lotId?: string | null;
};

type SaleDraftState = {
  minimized: boolean;
  customerId: string | null;
  lines: SaleDraftLine[];
  setMinimized: (value: boolean) => void;
  setCustomerId: (id: string | null) => void;
  setLines: (lines: SaleDraftLine[]) => void;
  reset: () => void;
};

export const useSaleDraftStore = create<SaleDraftState>((set) => ({
  minimized: false,
  customerId: null,
  lines: [],
  setMinimized: (value) => set({ minimized: value }),
  setCustomerId: (customerId) => set({ customerId }),
  setLines: (lines) => set({ lines }),
  reset: () => set({ minimized: false, customerId: null, lines: [] }),
}));
