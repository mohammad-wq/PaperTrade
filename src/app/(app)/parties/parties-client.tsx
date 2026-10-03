"use client";

import { useEffect, useMemo, useState, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Users,
  Plus,
  Search,
  Phone,
  Mail,
  MapPin,
  FileText,
  FileSpreadsheet,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  X,
  Trash2,
  Printer,
  Download,
  LayoutGrid,
  ListFilter,
  AlertCircle,
  Save,
  ShieldAlert,
  ArrowUpRight,
  CreditCard,
} from "lucide-react";
import {
  listPartiesAction,
  upsertPartyAction,
  softDeletePartyAction,
} from "@/actions/parties";
import { PartyType } from "@prisma/client";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";
import { cleanPartyDisplayName } from "@/lib/party-display";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type PartyRecord = {
  id: string;
  name: string;
  type: PartyType;
  phone: string | null;
  email: string | null;
  address: string | null;
  creditLimit: number | null;
  isActive: boolean;
  balance: number;
  isCustomer?: boolean;
  isSupplier?: boolean;
  isPartner?: boolean;
  isBeneficiary?: boolean;
  partnerWarehouseId?: string | null;
};

type PartyFormData = {
  id?: string;
  name: string;
  type: PartyType;
  phone: string;
  email: string;
  address: string;
  creditLimit: string;
  isActive: boolean;
  isCustomer: boolean;
  isSupplier: boolean;
  isPartner: boolean;
  isBeneficiary: boolean;
  partnerWarehouseId: string;
};

const EMPTY_PARTY_FORM: PartyFormData = {
  name: "",
  type: PartyType.CUSTOMER,
  phone: "",
  email: "",
  address: "",
  creditLimit: "",
  isActive: true,
  isCustomer: true,
  isSupplier: true,
  isPartner: false,
  isBeneficiary: false,
  partnerWarehouseId: "",
};

export default function PartiesClient({
  initialParties,
}: {
  initialParties?: PartyRecord[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const editIdParam = searchParams.get("id") || searchParams.get("edit");
  const actionParam = searchParams.get("action");

  // Main Data States
  const [parties, setParties] = useState<PartyRecord[]>(initialParties || []);
  const [loading, setLoading] = useState(!initialParties);
  const [saving, setSaving] = useState(false);

  // Dedicated Separate Window Dialog State (Pattern 2 - Windows Forms Style)
  const [isWindowOpen, setIsWindowOpen] = useState(false);
  const [selectedPartyId, setSelectedPartyId] = useState<string | null>(null);
  const [formData, setFormData] = useState<PartyFormData>(EMPTY_PARTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // Search & Filtering State (Pattern 1)
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
      setCurrentPage(1);
    }, 250);
    return () => clearTimeout(handler);
  }, [searchQuery]);

  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterType, setFilterType] = useState<"ALL" | PartyType | "PARTNER">("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");
  const [filterBalance, setFilterBalance] = useState<"ALL" | "RECEIVABLE" | "PAYABLE" | "ZERO">("ALL");
  const [viewMode, setViewMode] = useState<"table" | "cards">("table");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // References
  const searchInputRef = useRef<HTMLInputElement>(null);
  const formModalRef = useRef<HTMLDivElement>(null);

  // Fetch initial data
  async function loadInitialData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const res = await listPartiesAction();
      if (res.success && res.data) {
        setParties(res.data as PartyRecord[]);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialParties) {
      void loadInitialData();
    }
  }, [initialParties]);

  useRealtimeListener(["parties", "sales", "purchases", "payments", "ledger"], () => {
    void loadInitialData(true);
  });

  // Window action refs for effects
  const openNewWindowRef = useRef(openNewWindow);
  openNewWindowRef.current = openNewWindow;
  const openEditWindowRef = useRef(openEditWindow);
  openEditWindowRef.current = openEditWindow;
  const closeWindowRef = useRef(closeWindow);
  closeWindowRef.current = closeWindow;

  // Handle URL query parameters to open window
  useEffect(() => {
    if (editIdParam && parties.length > 0) {
      const found = parties.find((p) => p.id === editIdParam);
      if (found) {
        openEditWindowRef.current(found);
      }
    } else if (actionParam === "new") {
      openNewWindowRef.current();
    }
  }, [editIdParam, actionParam, parties]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // F2 or Insert opens New Party window
      if (e.key === "F2" || e.key === "Insert") {
        e.preventDefault();
        openNewWindowRef.current();
        return;
      }
      // Pressing "/" focuses the universal search bar if not in an input
      if (
        e.key === "/" &&
        !isWindowOpen &&
        !(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }
      // Escape closes window if open
      if (e.key === "Escape" && isWindowOpen) {
        e.preventDefault();
        closeWindowRef.current();
      }
    }
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isWindowOpen]);

  // Open New Party Window
  function openNewWindow() {
    setSelectedPartyId(null);
    setFormError(null);
    setFormData({
      ...EMPTY_PARTY_FORM,
    });
    setIsWindowOpen(true);

    setTimeout(() => {
      const firstField = formModalRef.current?.querySelector<HTMLElement>('[data-nav-index="0"]');
      firstField?.focus();
      if (firstField instanceof HTMLInputElement) firstField.select();
    }, 50);
  }

  // Open Edit Party Window
  function openEditWindow(party: PartyRecord) {
    setSelectedPartyId(party.id);
    setFormError(null);
    setFormData({
      id: party.id,
      name: cleanPartyDisplayName(party.name),
      type: party.type,
      phone: party.phone || "",
      email: party.email || "",
      address: party.address || "",
      creditLimit: party.creditLimit !== null ? String(party.creditLimit) : "",
      isActive: party.isActive,
      isCustomer: true,
      isSupplier: true,
      isPartner: Boolean(party.isPartner || party.isBeneficiary),
      isBeneficiary: Boolean(party.isPartner || party.isBeneficiary),
      partnerWarehouseId: party.partnerWarehouseId || "",
    });
    setIsWindowOpen(true);

    setTimeout(() => {
      const firstField = formModalRef.current?.querySelector<HTMLElement>('[data-nav-index="0"]');
      firstField?.focus();
      if (firstField instanceof HTMLInputElement) firstField.select();
    }, 50);
  }

  function closeWindow() {
    setIsWindowOpen(false);
    setSelectedPartyId(null);
    setFormError(null);
    // Remove query params if present without reloading
    if (editIdParam || actionParam) {
      router.replace("/parties");
    }
  }

  // Keyboard navigation within the Party Entry Form
  function handleNavKeyDown(e: React.KeyboardEvent, currentIndex: number) {
    if ((e.target as HTMLElement)?.tagName?.toLowerCase() === "textarea" && e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      return; // Allow regular newline entry inside <textarea> fields
    }
    if (e.key === "Enter") {
      e.preventDefault();
      let nextIndex = currentIndex + 1;
      let next = formModalRef.current?.querySelector<HTMLElement>(`[data-nav-index="${nextIndex}"]`);
      while (!next && nextIndex <= 12) {
        nextIndex++;
        next = formModalRef.current?.querySelector<HTMLElement>(`[data-nav-index="${nextIndex}"]`);
      }
      if (next) {
        next.focus();
        if (next instanceof HTMLInputElement) next.select();
      } else {
        void handleSaveParty();
      }
    }
  }

  // Save Party Handler (Create or Update)
  async function handleSaveParty() {
    if (!formData.name.trim()) {
      setFormError("Party Name is required.");
      const nameInput = formModalRef.current?.querySelector<HTMLInputElement>('[data-nav-index="1"]');
      nameInput?.focus();
      return;
    }

    setSaving(true);
    setFormError(null);

    try {
      const isPartnerRole = Boolean(formData.isPartner || formData.isBeneficiary);
      const payload = {
        id: selectedPartyId || undefined,
        name: formData.name.trim(),
        type: formData.type,
        phone: formData.phone.trim() || null,
        email: formData.email.trim() || null,
        address: formData.address.trim() || null,
        creditLimit: formData.creditLimit ? parseFloat(formData.creditLimit) || 0 : null,
        isActive: formData.isActive,
        isCustomer: true,
        isSupplier: true,
        isPartner: isPartnerRole,
        isBeneficiary: isPartnerRole,
        partnerWarehouseId: isPartnerRole && formData.partnerWarehouseId ? formData.partnerWarehouseId : null,
      };

      const res = await upsertPartyAction(payload);
      if (res.success) {
        await loadInitialData(true);
        closeWindow();
      } else {
        setFormError(res.error || "Failed to save party. Please check input values.");
      }
    } catch (err: any) {
      setFormError(err.message || "An unexpected error occurred while saving.");
    } finally {
      setSaving(false);
    }
  }

  // Delete Party Handler
  async function handleDeleteParty(party: PartyRecord, e?: React.MouseEvent) {
    e?.stopPropagation();
    const ok = await confirm({
      title: "Delete Party",
      description: `Are you sure you want to delete "${cleanPartyDisplayName(party.name)}"? It will be removed from your active directory.`,
      confirmText: "Delete Party",
      variant: "destructive",
    });
    if (!ok) return;

    try {
      const res = await softDeletePartyAction({ id: party.id });
      if (res.success) {
        setParties((prev) => prev.filter((p) => p.id !== party.id));
        if (selectedPartyId === party.id) {
          closeWindow();
        }
        await loadInitialData(true);
      } else {
        await confirm.alert(res.error || "Failed to delete party.", { variant: "destructive" });
      }
    } catch (err: any) {
      await confirm.alert(err?.message || "Failed to delete party.", { variant: "destructive" });
    }
  }

  // Client-Side CSV Export
  function handleExportCsv() {
    const headers = ["Name", "Type", "Phone", "Email", "Address", "Credit Limit", "Ledger Balance", "Status"];
    const rows = filteredParties.map((p) => [
      `"${p.name.replace(/"/g, '""')}"`,
      p.type,
      `"${p.phone || ""}"`,
      `"${p.email || ""}"`,
      `"${(p.address || "").replace(/"/g, '""')}"`,
      p.creditLimit ?? "",
      p.balance,
      p.isActive ? "Active" : "Inactive",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `party_directory_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Comprehensive Search & Filter Calculation
  const filteredParties = useMemo(() => {
    let result = parties;

    if (filterType !== "ALL") {
      if (filterType === "PARTNER") {
        result = result.filter((p) => p.isPartner || p.isBeneficiary);
      } else if (filterType === PartyType.CUSTOMER) {
        result = result.filter((p) => p.type === PartyType.CUSTOMER || p.isCustomer);
      } else if (filterType === PartyType.SUPPLIER) {
        result = result.filter((p) => p.type === PartyType.SUPPLIER || p.isSupplier);
      }
    }
    if (filterStatus === "ACTIVE") {
      result = result.filter((p) => p.isActive);
    } else if (filterStatus === "INACTIVE") {
      result = result.filter((p) => !p.isActive);
    }

    if (filterBalance === "RECEIVABLE") {
      result = result.filter((p) => p.balance > 0 && (p.type === PartyType.CUSTOMER || p.isCustomer));
    } else if (filterBalance === "PAYABLE") {
      result = result.filter((p) => p.balance > 0 && (p.type === PartyType.SUPPLIER || p.isSupplier));
    } else if (filterBalance === "ZERO") {
      result = result.filter((p) => p.balance === 0);
    }

    const q = debouncedSearchQuery.trim().toLowerCase();
    if (!q) return result;

    return result.filter((p) => {
      const name = p.name.toLowerCase();
      const phone = (p.phone || "").toLowerCase();
      const email = (p.email || "").toLowerCase();
      const address = (p.address || "").toLowerCase();
      const type = p.type.toLowerCase();

      return (
        name.includes(q) ||
        phone.includes(q) ||
        email.includes(q) ||
        address.includes(q) ||
        type.includes(q) ||
        ((p.isPartner || p.isBeneficiary) && "partner person b equity".includes(q))
      );
    });
  }, [parties, debouncedSearchQuery, filterType, filterStatus, filterBalance]);

  const totalPages = Math.max(1, Math.ceil(filteredParties.length / pageSize));
  const paginatedParties = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredParties.slice(start, start + pageSize);
  }, [filteredParties, currentPage, pageSize]);

  // Aggregate stats
  const customerCount = useMemo(() => parties.filter((p) => p.type === PartyType.CUSTOMER).length, [parties]);
  const supplierCount = useMemo(() => parties.filter((p) => p.type === PartyType.SUPPLIER).length, [parties]);
  const activeCount = useMemo(() => parties.filter((p) => p.isActive).length, [parties]);
  const totalReceivable = useMemo(
    () => parties.filter((p) => p.type === PartyType.CUSTOMER && p.balance > 0).reduce((sum, p) => sum + p.balance, 0),
    [parties],
  );
  const totalPayable = useMemo(
    () => parties.filter((p) => p.type === PartyType.SUPPLIER && p.balance > 0).reduce((sum, p) => sum + p.balance, 0),
    [parties],
  );

  const selectedParty = useMemo(
    () => (selectedPartyId ? parties.find((p) => p.id === selectedPartyId) : null),
    [parties, selectedPartyId]
  );

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Printable Black & White Header (Only visible when printing) */}
      <div className="hidden print:block mb-4 border-b-2 border-black pb-2 text-black">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-xl font-bold uppercase tracking-tight">Paper Trade Management</h1>
            <p className="text-xs font-semibold uppercase">Parties & Accounts Directory Statement</p>
          </div>
          <div className="text-right text-[10px] space-y-0.5">
            <p suppressHydrationWarning>Printed: {mounted ? new Date().toLocaleString() : ""}</p>
            <p>Type Filter: {filterType === "ALL" ? "All Parties" : filterType}</p>
            <p>Status: {filterStatus === "ALL" ? "All Accounts" : filterStatus}</p>
          </div>
        </div>
        <div className="mt-2 flex gap-4 text-xs font-mono border-t border-black pt-1">
          <span>Total Records: <strong>{filteredParties.length}</strong></span>
          <span>Customers: <strong>{customerCount}</strong></span>
          <span>Suppliers: <strong>{supplierCount}</strong></span>
          <span>Receivables: <strong>PKR {totalReceivable.toLocaleString()}</strong></span>
          <span>Payables: <strong>PKR {totalPayable.toLocaleString()}</strong></span>
        </div>
      </div>

      {/* Top Banner: Title, Counters, and Primary Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs print:hidden">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-md">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Party Directory
            </h1>
            <p className="text-[11px] text-slate-500">
              Customers and suppliers directory, credit limit enforcement, running balances, and statements
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Metrics Bar */}
          <div className="hidden sm:flex items-center gap-2 text-xs mr-2 font-mono">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Receivables: <strong>PKR {totalReceivable.toLocaleString()}</strong>
            </span>
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Payables: <strong>PKR {totalPayable.toLocaleString()}</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Customers: <strong>{customerCount}</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Suppliers: <strong>{supplierCount}</strong>
            </span>
          </div>

          {/* Primary Action Button: Open Party Window */}
          <Button
            onClick={openNewWindow}
            className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Party <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
          </Button>
        </div>
      </div>

      {/* Universal Search Bar & Collapsible Detailed Filters */}
      <div className="space-y-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs print:hidden">
        <div className="flex items-center gap-2">
          {/* Single Universal Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search across all fields: Name, Phone, Email, Address, City... (Press / to focus)"
              className="h-8 pl-8 pr-8 text-xs bg-slate-50 dark:bg-slate-950/50 border-slate-300 dark:border-slate-700 font-medium"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Quick Party Type Pills */}
          <div className="hidden sm:inline-flex rounded-md border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setFilterType("ALL")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                filterType === "ALL"
                  ? "bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              All ({parties.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterType(PartyType.CUSTOMER)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                filterType === PartyType.CUSTOMER
                  ? "bg-white dark:bg-slate-900 text-emerald-800 dark:text-emerald-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Customers ({customerCount})
            </button>
            <button
              type="button"
              onClick={() => setFilterType(PartyType.SUPPLIER)}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-all ${
                filterType === PartyType.SUPPLIER
                  ? "bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-400 shadow-xs"
                  : "text-slate-600 dark:text-slate-400 hover:text-slate-900"
              }`}
            >
              Suppliers ({supplierCount})
            </button>
          </div>

          {/* Detailed Filters Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`h-8 text-xs gap-1.5 ${
              showAdvancedFilters || filterStatus !== "ALL" || filterBalance !== "ALL"
                ? "border-emerald-500 text-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-slate-300 dark:border-slate-700 text-slate-600"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filters</span>
            {showAdvancedFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>

          {/* View Toggle */}
          <div className="inline-flex rounded-md border border-slate-300 dark:border-slate-700 p-0.5 bg-slate-100 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => setViewMode("table")}
              className={`p-1 rounded transition-colors ${
                viewMode === "table" ? "bg-white dark:bg-slate-900 shadow-xs text-slate-900 dark:text-slate-100" : "text-slate-400 hover:text-slate-700"
              }`}
              title="Table View"
            >
              <ListFilter className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode("cards")}
              className={`p-1 rounded transition-colors ${
                viewMode === "cards" ? "bg-white dark:bg-slate-900 shadow-xs text-slate-900 dark:text-slate-100" : "text-slate-400 hover:text-slate-700"
              }`}
              title="Cards View"
            >
              <LayoutGrid className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Export CSV */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-8 text-xs gap-1 border-slate-300 dark:border-slate-700 text-slate-600"
            title="Export Directory to CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Export</span>
          </Button>

          {/* Print */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.print()}
            className="h-8 text-xs gap-1 border-slate-300 dark:border-slate-700 text-slate-600"
            title="Print Directory"
          >
            <Printer className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Print</span>
          </Button>
        </div>

        {/* Collapsible Secondary Filters Section */}
        {showAdvancedFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <Label className="text-[10px] uppercase font-bold text-slate-500">Party Type / Role</Label>
              <select
                value={filterType}
                onChange={(e) => setFilterType(e.target.value as any)}
                className="w-full mt-1 h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs font-medium"
              >
                <option value="ALL">All Types & Roles</option>
                <option value={PartyType.CUSTOMER}>Customers (Buyers)</option>
                <option value={PartyType.SUPPLIER}>Suppliers (Vendors)</option>
                <option value="PARTNER">Equity Partners (Person B)</option>
              </select>
            </div>

            <div>
              <Label className="text-[10px] uppercase font-bold text-slate-500">Balance Status</Label>
              <select
                value={filterBalance}
                onChange={(e) => setFilterBalance(e.target.value as any)}
                className="w-full mt-1 h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs font-medium"
              >
                <option value="ALL">All Balances</option>
                <option value="RECEIVABLE">Receivables (Debit &gt; 0)</option>
                <option value="PAYABLE">Payables (Credit &gt; 0)</option>
                <option value="ZERO">Zero Balance</option>
              </select>
            </div>

            <div>
              <Label className="text-[10px] uppercase font-bold text-slate-500">Directory Status</Label>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as any)}
                className="w-full mt-1 h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs font-medium"
              >
                <option value="ALL">All Statuses</option>
                <option value="ACTIVE">Active Only</option>
                <option value="INACTIVE">Inactive Only</option>
              </select>
            </div>

            <div className="flex items-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFilterType("ALL");
                  setFilterStatus("ALL");
                  setFilterBalance("ALL");
                  setSearchQuery("");
                }}
                className="h-7 text-xs text-slate-500 hover:text-slate-800"
              >
                Reset All Filters
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Main Content: High-Density Table or Card Grid */}
      {viewMode === "table" ? (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden print:border-none print:shadow-none print:overflow-visible print:w-full">
          <div className="overflow-x-auto max-h-[calc(100vh-230px)] print:overflow-visible print:max-h-none print:w-full">
            <table className="w-full text-left text-xs border-collapse print:text-[8pt] print:table-auto">
              <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider print:static print:bg-slate-200 print:text-black">
                <tr>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap print:border-black print:px-1.5">Roles</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[180px] print:min-w-0 print:border-black print:px-1.5">Party Name</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap print:border-black print:px-1.5">Phone / Contact</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap print:border-black print:px-1.5">Email</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[160px] print:min-w-0 print:border-black print:px-1.5">Address</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap print:border-black print:px-1.5">Credit Limit</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold print:border-black print:px-1.5">Ledger Balance</th>
                  <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap print:border-black print:px-1.5">Status</th>
                  <th className="py-2 px-2 text-center whitespace-nowrap print:hidden">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loading ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500 font-medium">
                      Loading party directory...
                    </td>
                  </tr>
                ) : filteredParties.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-12 text-center text-slate-500 font-medium">
                      No parties found matching your search. Press <kbd className="px-1.5 py-0.5 bg-slate-100 border rounded text-[10px]">F2</kbd> to add a new party.
                    </td>
                  </tr>
                ) : (
                  paginatedParties.map((p) => {
                    const isReceivable = (p.type === PartyType.CUSTOMER || p.isCustomer) && p.balance > 0;
                    const isPayable = (p.type === PartyType.SUPPLIER || p.isSupplier) && p.balance > 0;

                    return (
                      <tr
                        key={p.id}
                        onClick={() => openEditWindow(p)}
                        className="hover:bg-amber-50/60 dark:hover:bg-slate-800/60 cursor-pointer transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40"
                      >
                        {/* Type & Role Badges */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap">
                          <div className="flex flex-wrap gap-1 items-center">
                            {(p.isPartner || p.isBeneficiary) ? (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                                Partner B
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                Party
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Name */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-900 dark:text-slate-100">
                          <div className="flex items-center gap-1.5">
                            <span>{cleanPartyDisplayName(p.name)}</span>
                            {!p.isActive && (
                              <span className="rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 text-[9px] px-1 font-sans">
                                Inactive
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Phone */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {p.phone || "—"}
                        </td>

                        {/* Email */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {p.email || "—"}
                        </td>

                        {/* Address */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-slate-600 dark:text-slate-400 truncate max-w-[220px]">
                          {p.address || "—"}
                        </td>

                        {/* Credit Limit */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                          {p.creditLimit ? `PKR ${p.creditLimit.toLocaleString()}` : "No Limit"}
                        </td>

                        {/* Ledger Balance */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-right font-mono font-bold whitespace-nowrap">
                          <span
                            className={
                              isReceivable
                                ? "text-emerald-700 dark:text-emerald-400"
                                : isPayable
                                ? "text-rose-700 dark:text-rose-400"
                                : "text-slate-500"
                            }
                          >
                            PKR {p.balance.toLocaleString()}
                          </span>
                        </td>

                        {/* Active Status */}
                        <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center whitespace-nowrap print:border-black print:px-1">
                          <span
                            className={`inline-block h-2 w-2 rounded-full print:hidden ${
                              p.isActive ? "bg-emerald-500" : "bg-slate-300 dark:bg-slate-600"
                            }`}
                            title={p.isActive ? "Active in Directory" : "Inactive"}
                          />
                          <span className="hidden print:inline text-[7.5pt] font-mono">
                            {p.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className="py-1 px-2 text-center whitespace-nowrap print:hidden">
                          <div className="flex items-center justify-center gap-1" onClick={(e) => e.stopPropagation()}>
                            {/* Statement PDF */}
                            <a
                              href={`/api/pdf/reports/party-statement?partyId=${p.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors"
                              title="Download Statement PDF"
                            >
                              <FileText className="h-3.5 w-3.5" />
                            </a>

                            {/* Statement Excel */}
                            <a
                              href={`/api/excel/reports/party-statement?partyId=${p.id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="p-1 text-slate-500 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 rounded transition-colors"
                              title="Download Statement Excel"
                            >
                              <FileSpreadsheet className="h-3.5 w-3.5" />
                            </a>

                            {/* Delete */}
                            <button
                              type="button"
                              onClick={(e) => handleDeleteParty(p, e)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                              title="Delete Party"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Card Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 print:hidden">
          {paginatedParties.map((p) => (
            <div
              key={p.id}
              onClick={() => openEditWindow(p)}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-3 hover:border-emerald-500 cursor-pointer shadow-xs transition-all space-y-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <div className="flex flex-wrap gap-1 items-center">
                      {(p.isPartner || p.isBeneficiary) ? (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                          Partner B
                        </span>
                      ) : (
                        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          Party
                        </span>
                      )}
                    </div>
                    <h3 className="font-bold text-xs text-slate-900 dark:text-slate-100">{cleanPartyDisplayName(p.name)}</h3>
                  </div>
                  {p.address && <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">{p.address}</p>}
                </div>
                <span
                  className={`text-xs font-mono font-bold ${
                    p.balance > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-slate-600"
                  }`}
                >
                  PKR {p.balance.toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800 pt-2 font-mono">
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans uppercase">Phone:</span>
                  {p.phone || "—"}
                </div>
                <div>
                  <span className="text-[10px] text-slate-400 block font-sans uppercase">Credit Limit:</span>
                  {p.creditLimit ? `PKR ${p.creditLimit.toLocaleString()}` : "No Limit"}
                </div>
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-slate-800" onClick={(e) => e.stopPropagation()}>
                <span className="text-[10px] text-slate-400 font-sans">
                  Status: <strong className={p.isActive ? "text-emerald-600" : "text-rose-600"}>{p.isActive ? "Active" : "Inactive"}</strong>
                </span>
                <div className="flex items-center gap-1">
                  <a
                    href={`/api/pdf/reports/party-statement?partyId=${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-slate-500 hover:text-emerald-700 rounded"
                    title="PDF Statement"
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </a>
                  <a
                    href={`/api/excel/reports/party-statement?partyId=${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="p-1 text-slate-500 hover:text-emerald-700 rounded"
                    title="Excel Statement"
                  >
                    <FileSpreadsheet className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteParty(p, e)}
                    className="p-1 text-slate-400 hover:text-rose-600 rounded"
                    title="Delete Party"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border border-slate-200 dark:border-slate-800 rounded-md px-4 py-2 text-xs bg-slate-50 dark:bg-slate-950/50 print:hidden">
          <span className="text-slate-500 font-medium">
            Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, filteredParties.length)} of {filteredParties.length} parties
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="h-7 text-xs px-2.5"
            >
              Previous
            </Button>
            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-400">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="h-7 text-xs px-2.5"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Pattern 2: Dedicated Separate Window for Party Entry (Windows Forms Style Dialog) */}
      {isWindowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div
            ref={formModalRef}
            className="w-full max-w-xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Window Title Bar (Windows Desktop Style) */}
            <div className="bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-800 select-none">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-xs">
                  {selectedPartyId ? `Edit Party Form - [${formData.name}]` : "Party Entry Form - [New Party]"}
                </span>
              </div>
              <button
                onClick={closeWindow}
                className="rounded text-slate-400 hover:text-white hover:bg-slate-800 p-1 transition-colors"
                title="Close Window (Esc)"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Keyboard Shortcut Banner */}
            <div className="bg-slate-100 dark:bg-slate-800 px-4 py-1.5 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 font-mono">
              <span>↵ Enter / Tab: Next Field  •  Ctrl+Enter: Save  •  Esc: Close</span>
              <span className="text-emerald-700 dark:text-emerald-400 font-sans font-bold text-[10px]">
                ⚡ Rapid Keyboard Data Entry Mode
              </span>
            </div>

            {/* Form Body with High-Density Windows Controls */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs bg-slate-50/50 dark:bg-slate-950/40">
              {/* Error Alert Box */}
              {formError && (
                <div className="bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 p-2.5 rounded text-rose-700 dark:text-rose-300 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Row 1: Party Name */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Party / Company Name <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="0"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 0)}
                    placeholder="e.g. Al-Madina Packages or Bilal Traders"
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-medium"
                    required
                  />
                </div>
              </div>

              {/* Partner Option: One clear checkbox */}
              <div className="py-2 border-b border-slate-200/60 dark:border-slate-800">
                <label className={`flex items-center gap-2.5 p-2.5 rounded-md border cursor-pointer transition-colors ${formData.isPartner ? 'bg-indigo-50/70 border-indigo-300 text-indigo-950 dark:bg-indigo-950/40 dark:border-indigo-700 dark:text-indigo-200' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'}`}>
                  <input
                    type="checkbox"
                    checked={formData.isPartner}
                    onChange={(e) => setFormData((prev) => ({
                      ...prev,
                      isPartner: e.target.checked,
                      isBeneficiary: e.target.checked,
                    }))}
                    className="h-4 w-4 rounded border-indigo-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div>
                    <span className="text-xs font-bold text-indigo-900 dark:text-indigo-300 block">
                      Acts as Partner (Person B / Equity Partner)
                    </span>
                    <span className="text-[10px] text-slate-500 block leading-tight">
                      Check if this party is an equity partner for shared warehouse lots and capital tracking
                    </span>
                  </div>
                </label>
              </div>

              {/* Row 2: Phone */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Phone / Mobile:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="2"
                    value={formData.phone}
                    onChange={(e) => setFormData((prev) => ({ ...prev, phone: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 2)}
                    placeholder="0300-1234567"
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                  />
                </div>
              </div>

              {/* Row 3: Email */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Email Address:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="3"
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 3)}
                    placeholder="info@example.com (Optional)"
                    className="h-8 text-xs bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {/* Row 4: Address */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Street Address & City:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="4"
                    value={formData.address}
                    onChange={(e) => setFormData((prev) => ({ ...prev, address: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 4)}
                    placeholder="Shop # 12, Urdu Bazar, Lahore"
                    className="h-8 text-xs bg-white dark:bg-slate-900"
                  />
                </div>
              </div>

              {/* Row 5: Credit Limit */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Credit Limit (PKR):
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="5"
                    type="number"
                    step="1000"
                    value={formData.creditLimit}
                    onChange={(e) => setFormData((prev) => ({ ...prev, creditLimit: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 5)}
                    placeholder="e.g. 500000 (Leave empty for unrestricted)"
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                  />
                </div>
              </div>

              {/* Row 6: Equity Partner Info Notice */}
              {(formData.isPartner || formData.isBeneficiary) && (
                <div className="grid grid-cols-12 gap-3 items-center py-2 border-b border-slate-200/60 dark:border-slate-800 bg-indigo-50/40 dark:bg-indigo-950/20 px-2 rounded-md">
                  <label className="col-span-4 text-right font-bold text-indigo-900 dark:text-indigo-200 pr-2">
                    Partnership Mode:
                  </label>
                  <div className="col-span-8 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200">
                        Equity Partner (Person B) Active
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Standard purchases/sales are ledger-isolated. Dedicated intakes create shared warehouse lots with capital split tracking.
                    </p>
                  </div>
                </div>
              )}

              {/* Row 7: Active Status Toggle */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Directory Status:
                </label>
                <div className="col-span-8 flex items-center gap-3">
                  <select
                    data-nav-index="6"
                    value={formData.isActive ? "true" : "false"}
                    onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.value === "true" }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 6)}
                    className="h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-semibold"
                  >
                    <option value="true">Active (Visible across Sales & Purchases)</option>
                    <option value="false">Inactive / Archived</option>
                  </select>
                </div>
              </div>

              {/* Current Ledger Balance Display (If editing existing party) */}
              {selectedParty && (
                <div className="mt-3 p-3 rounded-md bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] uppercase font-bold text-emerald-800 dark:text-emerald-300 block">
                      Running Ledger Balance
                    </span>
                    <span className="text-base font-bold font-mono text-emerald-900 dark:text-emerald-100">
                      PKR {selectedParty.balance.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <a
                      href={`/api/pdf/reports/party-statement?partyId=${selectedParty.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 px-2 py-1 rounded hover:bg-emerald-50"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      PDF Statement
                    </a>
                    <a
                      href={`/api/excel/reports/party-statement?partyId=${selectedParty.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 px-2 py-1 rounded hover:bg-emerald-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5" />
                      Excel Statement
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* Window Footer Action Bar */}
            <div className="bg-slate-100 dark:bg-slate-800 px-4 py-2.5 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                {selectedPartyId ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => selectedParty && handleDeleteParty(selectedParty)}
                    disabled={saving}
                    className="h-8 text-xs border-rose-300 text-rose-600 hover:bg-rose-50 hover:text-rose-700 gap-1.5"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete Party
                  </Button>
                ) : (
                  <span className="text-[11px] text-slate-500 font-mono">Creating New Contact Entry</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeWindow}
                  disabled={saving}
                  className="h-8 text-xs"
                >
                  Cancel (Esc)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveParty}
                  disabled={saving}
                  className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs px-4"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {saving ? "Saving..." : selectedPartyId ? "Update Party (Enter)" : "Save Party (Enter)"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
