"use client";

import { useEffect, useMemo, useState, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Save,
  RotateCcw,
  Trash2,
  Filter,
  Layers,
  Scale,
  Settings2,
  CheckCircle2,
  Pencil,
  AlertCircle,
  Hash,
  Sparkles,
  SlidersHorizontal,
  X,
  Boxes,
  Maximize2,
  ChevronDown,
  ChevronUp,
  Download,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Unit } from "@prisma/client";
import {
  listProductsAction,
  listCategoriesAction,
  listQualitiesAction,
  createCategoryAction,
  createQualityAction,
  upsertProductAction,
  softDeleteProductAction,
} from "@/actions/products";
import { calculateWeights } from "@/lib/weights";
import { useRealtimeListener } from "@/hooks/use-realtime";
import { useConfirm } from "@/components/providers/confirm-provider";

type ProductRecord = {
  id: string;
  productNo: string;
  name: string;
  categoryId: string;
  qualityId: string;
  unit: Unit;
  length: number;
  breadth: number;
  gsm: number;
  packetWeight: number;
  reamWeight: number;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
  labourCharges: number;
  reorderLevel: number | null;
  currentStock: number;
  serialNo: string | null;
  remarks: string | null;
  isActive: boolean;
  category: { id: string; name: string } | null;
  quality: { id: string; name: string } | null;
};

type ProductFormData = {
  id: string;
  productNo: string;
  name: string;
  categoryId: string;
  qualityId: string;
  unit: Unit;
  length: string;
  breadth: string;
  gsm: string;
  costPrice: string;
  retailPrice: string;
  wholesalePrice: string;
  labourCharges: string;
  reorderLevel: string;
  serialNo: string;
  remarks: string;
  isActive: boolean;
};

const EMPTY_FORM: ProductFormData = {
  id: "",
  productNo: "",
  name: "",
  categoryId: "",
  qualityId: "",
  unit: Unit.PACKET,
  length: "23",
  breadth: "36",
  gsm: "70",
  costPrice: "0",
  retailPrice: "0",
  wholesalePrice: "0",
  labourCharges: "0",
  reorderLevel: "10",
  serialNo: "",
  remarks: "",
  isActive: true,
};

// Auto-detect next product code sequence based on Category (Paper Type) and GSM
function detectProductSequence(
  categoryName: string,
  gsm: number | string,
  existingProducts: ProductRecord[]
) {
  const cleanCategory = (categoryName || "").trim();
  const numGsm = Number(gsm) || 0;

  // Standard abbreviation lookup
  let catAbbr = "P";
  if (cleanCategory) {
    const words = cleanCategory.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      catAbbr = words.map((w) => w[0].toUpperCase()).join("");
    } else if (words.length === 1) {
      const w = words[0].toUpperCase();
      if (w.length <= 3) catAbbr = w;
      else if (w === "BOARD") catAbbr = "BRD";
      else if (w === "COPIER") catAbbr = "CP";
      else if (w === "NEWSPRINT") catAbbr = "NP";
      else if (w === "OFFSET") catAbbr = "OFF";
      else if (w === "KRAFT") catAbbr = "KP";
      else catAbbr = w.slice(0, 3);
    }
  }

  const allCodesUpper = new Set(existingProducts.map((p) => p.productNo.toUpperCase()));

  // 1. Find matches with exact same category AND exact same GSM
  const exactMatches = existingProducts.filter(
    (p) =>
      p.category?.name?.toLowerCase() === cleanCategory.toLowerCase() &&
      Number(p.gsm) === numGsm
  );

  let suggestedCode = "";
  let patternInfo = "";
  const alternatives: string[] = [];

  if (exactMatches.length > 0) {
    let highestNum = 0;
    let detectedPrefix = numGsm > 0 ? `${catAbbr}-${numGsm}-` : `${catAbbr}-`;
    let padding = 3;

    for (const match of exactMatches) {
      const m = match.productNo.match(/^(.*?)(\d+)$/);
      if (m) {
        const prefix = m[1];
        const numStr = m[2];
        const numVal = parseInt(numStr, 10);
        if (!isNaN(numVal) && numVal > highestNum) {
          highestNum = numVal;
          detectedPrefix = prefix;
          padding = Math.max(numStr.length, 2);
        }
      }
    }

    let nextNum = highestNum + 1;
    suggestedCode = `${detectedPrefix}${String(nextNum).padStart(padding, "0")}`;
    while (allCodesUpper.has(suggestedCode.toUpperCase())) {
      nextNum++;
      suggestedCode = `${detectedPrefix}${String(nextNum).padStart(padding, "0")}`;
    }
    patternInfo = `Detected from ${exactMatches.length} existing ${cleanCategory} (${numGsm} GSM) products`;
  } else {
    // 2. Generate standard paper trade sequence code
    const prefix = numGsm > 0 ? `${catAbbr}-${numGsm}-` : `${catAbbr}-`;
    let seq = 1;
    suggestedCode = `${prefix}${String(seq).padStart(3, "0")}`;
    while (allCodesUpper.has(suggestedCode.toUpperCase())) {
      seq++;
      suggestedCode = `${prefix}${String(seq).padStart(3, "0")}`;
    }
    patternInfo = numGsm > 0
      ? `Sequence for ${cleanCategory} (${numGsm} GSM)`
      : `Standard code for ${cleanCategory || "Product"}`;
  }

  // Generate alternative suggestion formats
  if (numGsm > 0) {
    const compact = `${catAbbr}${numGsm}-01`;
    if (compact !== suggestedCode && !allCodesUpper.has(compact.toUpperCase())) {
      alternatives.push(compact);
    }
  }

  // Global P-XXXX sequential alternative
  let globalMax = 0;
  for (const p of existingProducts) {
    const m = p.productNo.match(/^P-(\d+)$/i);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > globalMax) globalMax = n;
    }
  }
  const nextGlobal = `P-${String(globalMax + 1).padStart(4, "0")}`;
  if (nextGlobal !== suggestedCode && !allCodesUpper.has(nextGlobal.toUpperCase())) {
    alternatives.push(nextGlobal);
  }

  return { suggestedCode, alternatives, patternInfo };
}

function ProductsPageContent() {
  const router = useRouter();
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const editIdParam = searchParams.get("id") || searchParams.get("edit");
  const actionParam = searchParams.get("action");

  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [qualities, setQualities] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Separate Window (Modal) State
  const [isWindowOpen, setIsWindowOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [formData, setFormData] = useState<ProductFormData>(EMPTY_FORM);
  const [userEditedProductNo, setUserEditedProductNo] = useState(false);

  // Filter State
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [filterCategory, setFilterCategory] = useState<string>("ALL");
  const [filterQuality, setFilterQuality] = useState<string>("ALL");
  const [filterStatus, setFilterStatus] = useState<"ALL" | "ACTIVE" | "INACTIVE">("ALL");

  // Inline Quick Add Modals
  const [showAddCategoryModal, setShowAddCategoryModal] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [categorySaving, setCategorySaving] = useState(false);

  const [showAddQualityModal, setShowAddQualityModal] = useState(false);
  const [newQualityName, setNewQualityName] = useState("");
  const [qualitySaving, setQualitySaving] = useState(false);

  // References
  const searchInputRef = useRef<HTMLInputElement>(null);
  const formModalRef = useRef<HTMLDivElement>(null);

  // Fetch initial data
  async function loadInitialData(isBackground = false) {
    if (!isBackground) setLoading(true);
    try {
      const [prodRes, catRes, qualRes] = await Promise.all([
        listProductsAction(),
        listCategoriesAction(),
        listQualitiesAction(),
      ]);

      if (prodRes.success && prodRes.data) {
        setProducts(prodRes.data as ProductRecord[]);
      }
      if (catRes.success && catRes.data) {
        setCategories(catRes.data);
      }
      if (qualRes.success && qualRes.data) {
        setQualities(qualRes.data);
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }

  useEffect(() => {
    void loadInitialData();
  }, []);

  useRealtimeListener(["products", "inventory", "stock-movements"], () => {
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
    if (editIdParam && products.length > 0) {
      const found = products.find((p) => p.id === editIdParam);
      if (found) {
        openEditWindowRef.current(found);
      }
    } else if (actionParam === "new") {
      openNewWindowRef.current();
    }
  }, [editIdParam, actionParam, products]);

  // Global keyboard shortcuts
  useEffect(() => {
    function handleGlobalKeyDown(e: KeyboardEvent) {
      // F2 or Insert opens New Product window
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

  // Current category object for sequence detection
  const selectedCategoryObj = useMemo(
    () => categories.find((c) => c.id === formData.categoryId),
    [categories, formData.categoryId]
  );

  // Sequence detection calculation
  const sequenceDetection = useMemo(() => {
    if (!selectedCategoryObj) return { suggestedCode: "", alternatives: [], patternInfo: "" };
    return detectProductSequence(selectedCategoryObj.name, formData.gsm, products);
  }, [selectedCategoryObj, formData.gsm, products]);

  // Auto-apply suggested sequence code when Category or GSM changes (if adding new and not manually edited)
  useEffect(() => {
    if (!selectedProductId && !userEditedProductNo && sequenceDetection.suggestedCode) {
      setFormData((prev) => ({
        ...prev,
        productNo: sequenceDetection.suggestedCode,
      }));
    }
  }, [selectedProductId, userEditedProductNo, sequenceDetection.suggestedCode]);

  // Live calculated weights
  const liveWeights = useMemo(() => {
    const l = parseFloat(formData.length) || 0;
    const b = parseFloat(formData.breadth) || 0;
    const g = parseFloat(formData.gsm) || 0;
    if (l > 0 && b > 0 && g > 0) {
      return calculateWeights(l, b, g);
    }
    return { packetWeight: 0, reamWeight: 0 };
  }, [formData.length, formData.breadth, formData.gsm]);

  // Open New Product Window
  function openNewWindow() {
    const defaultCat = categories.length > 0 ? categories[0].id : "";
    const defaultQual = qualities.length > 0 ? qualities[0].id : "";
    setSelectedProductId(null);
    setUserEditedProductNo(false);
    setFormError(null);

    const initial = {
      ...EMPTY_FORM,
      categoryId: defaultCat,
      qualityId: defaultQual,
    };

    // Calculate initial code suggestion
    const catName = categories.find((c) => c.id === defaultCat)?.name || "";
    const initialSeq = detectProductSequence(catName, initial.gsm, products);
    if (initialSeq.suggestedCode) {
      initial.productNo = initialSeq.suggestedCode;
    }

    setFormData(initial);
    setIsWindowOpen(true);

    // Auto-focus first field after opening
    setTimeout(() => {
      const firstField = formModalRef.current?.querySelector<HTMLElement>('[data-nav-index="0"]');
      firstField?.focus();
      if (firstField instanceof HTMLInputElement) firstField.select();
    }, 50);
  }

  // Open Edit Product Window
  function openEditWindow(product: ProductRecord) {
    setSelectedProductId(product.id);
    setUserEditedProductNo(true);
    setFormError(null);
    setFormData({
      id: product.id,
      productNo: product.productNo,
      name: product.name,
      categoryId: product.categoryId,
      qualityId: product.qualityId,
      unit: product.unit,
      length: String(product.length),
      breadth: String(product.breadth),
      gsm: String(product.gsm),
      costPrice: String(product.costPrice),
      retailPrice: String(product.retailPrice),
      wholesalePrice: String(product.wholesalePrice),
      labourCharges: String(product.labourCharges),
      reorderLevel: product.reorderLevel !== null ? String(product.reorderLevel) : "",
      serialNo: product.serialNo || "",
      remarks: product.remarks || "",
      isActive: product.isActive,
    });
    setIsWindowOpen(true);

    // Auto-focus first field after opening
    setTimeout(() => {
      const firstField = formModalRef.current?.querySelector<HTMLElement>('[data-nav-index="0"]');
      firstField?.focus();
      if (firstField instanceof HTMLInputElement) firstField.select();
    }, 50);
  }

  function closeWindow() {
    setIsWindowOpen(false);
    setSelectedProductId(null);
    setFormError(null);
  }

  // Vertical Sequential Enter & Arrow Navigation Engine
  function handleNavKeyDown(e: React.KeyboardEvent<HTMLElement>, currentIndex: number) {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      if (e.key === "ArrowDown" && e.currentTarget.tagName === "SELECT" && !e.altKey) {
        return; // Allow native select option navigation
      }
      e.preventDefault();
      // Final field is Remarks (index 14) -> Enter saves immediately!
      if (currentIndex === 14 && e.key === "Enter") {
        void handleSaveProduct();
        return;
      }

      // Move to next field
      let nextIndex = currentIndex + 1;
      let nextEl = formModalRef.current?.querySelector<HTMLElement>(`[data-nav-index="${nextIndex}"]`);
      while (!nextEl && nextIndex <= 20) {
        nextIndex++;
        nextEl = formModalRef.current?.querySelector<HTMLElement>(`[data-nav-index="${nextIndex}"]`);
      }
      if (nextEl) {
        nextEl.focus();
        if (nextEl instanceof HTMLInputElement) {
          nextEl.select();
        }
      }
    } else if (e.key === "ArrowUp" || (e.shiftKey && e.key === "Enter")) {
      if (e.currentTarget.tagName === "SELECT" && !e.altKey && e.key === "ArrowUp") {
        return; // Allow native select option navigation
      }
      e.preventDefault();
      let prevIndex = currentIndex - 1;
      let prevEl = formModalRef.current?.querySelector<HTMLElement>(`[data-nav-index="${prevIndex}"]`);
      while (!prevEl && prevIndex >= 0) {
        prevIndex--;
        prevEl = formModalRef.current?.querySelector<HTMLElement>(`[data-nav-index="${prevIndex}"]`);
      }
      if (prevEl) {
        prevEl.focus();
        if (prevEl instanceof HTMLInputElement) {
          prevEl.select();
        }
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeWindow();
    }
  }

  // Save Product Handler
  async function handleSaveProduct() {
    setFormError(null);

    // Basic Validation
    if (!formData.productNo.trim()) {
      setFormError("Product No is required.");
      const el = formModalRef.current?.querySelector<HTMLElement>('[data-nav-index="2"]');
      el?.focus();
      return;
    }
    if (!formData.name.trim()) {
      setFormError("Product Name is required.");
      const el = formModalRef.current?.querySelector<HTMLElement>('[data-nav-index="3"]');
      el?.focus();
      return;
    }
    if (!formData.categoryId) {
      setFormError("Please select a Category.");
      return;
    }
    if (!formData.qualityId) {
      setFormError("Please select a Quality.");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        id: selectedProductId || undefined,
        productNo: formData.productNo.trim(),
        name: formData.name.trim(),
        categoryId: formData.categoryId,
        qualityId: formData.qualityId,
        unit: formData.unit,
        length: parseFloat(formData.length) || 0,
        breadth: parseFloat(formData.breadth) || 0,
        gsm: parseFloat(formData.gsm) || 0,
        costPrice: parseFloat(formData.costPrice) || 0,
        retailPrice: parseFloat(formData.retailPrice) || 0,
        wholesalePrice: parseFloat(formData.wholesalePrice) || 0,
        labourCharges: parseFloat(formData.labourCharges) || 0,
        reorderLevel: formData.reorderLevel ? parseFloat(formData.reorderLevel) : null,
        serialNo: formData.serialNo.trim() || undefined,
        remarks: formData.remarks.trim() || undefined,
        isActive: formData.isActive,
      };

      const res = await upsertProductAction(payload);
      if (res.success) {
        await loadInitialData(true);
        closeWindow();
      } else {
        setFormError(res.error || "Failed to save product.");
      }
    } catch (err: any) {
      setFormError(err?.message || "An unexpected error occurred.");
    } finally {
      setSaving(false);
    }
  }

  // Delete Product Handler (Supports both modal and row action)
  async function handleDeleteProduct(targetId?: string, targetName?: string, e?: React.MouseEvent) {
    e?.stopPropagation();
    const idToDelete = targetId || selectedProductId;
    if (!idToDelete) return;
    const prodName = targetName || (products.find((p) => p.id === idToDelete)?.name ?? "this product");

    const ok = await confirm({
      title: "Delete Product",
      description: `Are you sure you want to delete "${prodName}"? It will be removed from your catalog.`,
      confirmText: "Delete Product",
      variant: "destructive",
    });
    if (!ok) {
      return;
    }

    setSaving(true);
    try {
      const res = await softDeleteProductAction({ id: idToDelete });
      if (res.success) {
        setProducts((prev) => prev.filter((p) => p.id !== idToDelete));
        if (selectedProductId === idToDelete) {
          closeWindow();
        }
        await loadInitialData(true);
      } else {
        await confirm.alert(res.error || "Failed to delete product.", { variant: "destructive" });
      }
    } catch (err: any) {
      await confirm.alert(err?.message || "Failed to delete product.", { variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // Inline Category Creator
  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;
    setCategorySaving(true);
    try {
      const res = await createCategoryAction(newCategoryName.trim());
      if (res.success) {
        setCategories((prev) => [...prev, res.data]);
        setFormData((prev) => ({ ...prev, categoryId: res.data.id }));
        setNewCategoryName("");
        setShowAddCategoryModal(false);
      } else {
        await confirm.alert(res.error || "Failed to create category", { variant: "destructive" });
      }
    } finally {
      setCategorySaving(false);
    }
  }

  // Inline Quality Creator
  async function handleCreateQuality() {
    if (!newQualityName.trim()) return;
    setQualitySaving(true);
    try {
      const res = await createQualityAction(newQualityName.trim());
      if (res.success) {
        setQualities((prev) => [...prev, res.data]);
        setFormData((prev) => ({ ...prev, qualityId: res.data.id }));
        setNewQualityName("");
        setShowAddQualityModal(false);
      } else {
        await confirm.alert(res.error || "Failed to create quality", { variant: "destructive" });
      }
    } finally {
      setQualitySaving(false);
    }
  }

  function handleExportCsv() {
    const headers = [
      "Code",
      "Name",
      "Category",
      "Quality",
      "Size (L x B)",
      "GSM",
      "Unit",
      "Cost Price",
      "Retail Price",
      "Wholesale Price",
      "Current Stock",
      "Reorder Level",
      "Status",
    ];

    const rows = filteredProducts.map((p) => [
      p.productNo,
      p.name,
      p.category?.name || "",
      p.quality?.name || "",
      `${p.length} x ${p.breadth}`,
      String(p.gsm),
      p.unit,
      String(p.costPrice),
      String(p.retailPrice),
      String(p.wholesalePrice),
      String(p.currentStock),
      p.reorderLevel == null ? "" : String(p.reorderLevel),
      p.isActive ? "Active" : "Inactive",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))].join("\n");

    const link = document.createElement("a");
    link.setAttribute("href", encodeURI(csvContent));
    link.setAttribute("download", `product_directory_${new Date().toISOString().split("T")[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  function handlePrint() {
    window.print();
  }

  // Pattern 1: Universal Omni-Search across ALL visible fields simultaneously
  const filteredProducts = useMemo(() => {
    let result = products;

    // 1. Secondary dropdown filters (if selected)
    if (filterCategory !== "ALL") {
      result = result.filter((p) => p.categoryId === filterCategory);
    }
    if (filterQuality !== "ALL") {
      result = result.filter((p) => p.qualityId === filterQuality);
    }
    if (filterStatus === "ACTIVE") {
      result = result.filter((p) => p.isActive);
    } else if (filterStatus === "INACTIVE") {
      result = result.filter((p) => !p.isActive);
    }

    // 2. Primary Universal Search across ALL visible fields
    const q = searchQuery.trim().toLowerCase();
    if (!q) return result;

    return result.filter((p) => {
      const pNo = p.productNo.toLowerCase();
      const pName = p.name.toLowerCase();
      const cat = p.category?.name?.toLowerCase() || "";
      const qual = p.quality?.name?.toLowerCase() || "";
      const gsm = String(p.gsm);
      const dims = `${p.length}x${p.breadth}`;
      const serial = p.serialNo ? p.serialNo.toLowerCase() : "";
      const remarks = p.remarks ? p.remarks.toLowerCase() : "";
      const unit = p.unit.toLowerCase();

      return (
        pNo.includes(q) ||
        pName.includes(q) ||
        cat.includes(q) ||
        qual.includes(q) ||
        gsm.includes(q) ||
        dims.includes(q) ||
        serial.includes(q) ||
        remarks.includes(q) ||
        unit.includes(q)
      );
    });
  }, [products, searchQuery, filterCategory, filterQuality, filterStatus]);

  // Active / Inactive stats
  const activeCount = useMemo(() => products.filter((p) => p.isActive).length, [products]);
  const inactiveCount = products.length - activeCount;

  return (
    <div className="flex flex-col gap-3 p-4">
      {/* Top Banner: Title, Counters, and Action Button */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-4 py-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 rounded-md">
            <Boxes className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Product Directory
            </h1>
            <p className="text-[11px] text-slate-500">
              High-density catalog with live physical stock, weights, and commercial pricing
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Counters */}
          <div className="hidden sm:flex items-center gap-2 text-xs mr-2 font-mono">
            <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 px-2 py-1 rounded">
              Active: <strong>{activeCount}</strong>
            </span>
            <span className="bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 px-2 py-1 rounded">
              Inactive: <strong>{inactiveCount}</strong>
            </span>
            <span className="bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-300 px-2 py-1 rounded">
              Total: <strong>{products.length}</strong>
            </span>
          </div>

          {/* Primary Action Button: Open Entry Window */}
          <Button
            onClick={openNewWindow}
            className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs px-3"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Product <span className="ml-1.5 text-[10px] opacity-75 font-mono">[F2]</span>
          </Button>
        </div>
      </div>

      {/* Pattern 1: Universal Search Bar & Collapsible Detailed Filters */}
      <div className="space-y-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-md shadow-xs">
        <div className="flex items-center gap-2">
          {/* Single Universal Search Bar */}
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search across all fields: Product No, Name, Category, Quality, Size, GSM, Serial... (Press / to focus)"
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

          {/* Detailed Filters Toggle */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className={`h-8 text-xs gap-1.5 ${
              showAdvancedFilters || filterCategory !== "ALL" || filterQuality !== "ALL" || filterStatus !== "ALL"
                ? "border-emerald-500 text-emerald-700 bg-emerald-50/50 dark:bg-emerald-950/20"
                : "border-slate-300 dark:border-slate-700 text-slate-600"
            }`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filters</span>
            {showAdvancedFilters ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            className="h-8 text-xs gap-1 border-slate-300 dark:border-slate-700 text-slate-600"
            title="Export Product Directory to CSV"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Export</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handlePrint}
            className="h-8 text-xs gap-1 border-slate-300 dark:border-slate-700 text-slate-600"
            title="Print Product Directory"
          >
            <Printer className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Print</span>
          </Button>
        </div>

        {/* Collapsible Secondary Filters Section */}
        {showAdvancedFilters && (
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div>
              <Label className="text-[10px] uppercase font-bold text-slate-500">Category Filter</Label>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className="w-full mt-1 h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs font-medium"
              >
                <option value="ALL">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-[10px] uppercase font-bold text-slate-500">Quality Filter</Label>
              <select
                value={filterQuality}
                onChange={(e) => setFilterQuality(e.target.value)}
                className="w-full mt-1 h-7 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 text-xs font-medium"
              >
                <option value="ALL">All Qualities</option>
                {qualities.map((q) => (
                  <option key={q.id} value={q.id}>
                    {q.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <Label className="text-[10px] uppercase font-bold text-slate-500">Status Filter</Label>
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
                  setFilterCategory("ALL");
                  setFilterQuality("ALL");
                  setFilterStatus("ALL");
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

      {/* Pattern 1: High-Density Tabular List View */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-md shadow-xs overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-230px)]">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="sticky top-0 z-10 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-b border-slate-200 dark:border-slate-700 text-[11px] font-bold uppercase tracking-wider">
              <tr>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Code</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 min-w-[180px]">Product Name</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Category</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Quality</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 whitespace-nowrap">Size (L×B)</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">GSM</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Unit</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Cost (PKR)</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Retail (PKR)</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Wholesale</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap font-bold">Current Stock</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-right whitespace-nowrap">Reorder</th>
                <th className="py-2 px-2.5 border-r border-slate-200 dark:border-slate-700 text-center whitespace-nowrap">Status</th>
                <th className="py-2 px-2 text-center whitespace-nowrap">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-slate-500 font-medium">
                    Loading product directory...
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={14} className="py-12 text-center text-slate-500 font-medium">
                    No products found matching your search. Press <kbd className="px-1.5 py-0.5 bg-slate-100 border rounded text-[10px]">F2</kbd> to add a new product.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((p) => {
                  const isLowStock = p.reorderLevel !== null && p.currentStock <= p.reorderLevel;
                  const isOutOfStock = p.currentStock <= 0;

                  return (
                    <tr
                      key={p.id}
                      onClick={() => openEditWindow(p)}
                      className="hover:bg-amber-50/60 dark:hover:bg-slate-800/60 cursor-pointer transition-colors even:bg-slate-50/40 dark:even:bg-slate-900/40"
                    >
                      {/* Product No */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span>{p.productNo}</span>
                          {!p.isActive && (
                            <span className="rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 text-[9px] px-1 font-sans">
                              Inactive
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Product Name */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-medium text-slate-800 dark:text-slate-200">
                        {p.name}
                      </td>

                      {/* Category */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {p.category?.name || "—"}
                      </td>

                      {/* Quality */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {p.quality?.name || "—"}
                      </td>

                      {/* Size */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {p.length}&quot; × {p.breadth}&quot;
                      </td>

                      {/* GSM */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {p.gsm}
                      </td>

                      {/* Unit */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center whitespace-nowrap font-medium text-[10px]">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {p.unit}
                        </span>
                      </td>

                      {/* Cost Price */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap text-slate-600 dark:text-slate-400">
                        {p.costPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>

                      {/* Retail Price */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-semibold text-emerald-700 dark:text-emerald-400">
                        {p.retailPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>

                      {/* Wholesale Price */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap text-slate-700 dark:text-slate-300">
                        {p.wholesalePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>

                      {/* Live Current Stock */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap font-bold">
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            isOutOfStock
                              ? "bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300"
                              : isLowStock
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300"
                              : "text-slate-800 dark:text-slate-200"
                          }`}
                        >
                          {p.currentStock.toLocaleString()}
                        </span>
                      </td>

                      {/* Reorder Level */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 font-mono text-right whitespace-nowrap text-slate-500">
                        {p.reorderLevel !== null ? p.reorderLevel.toLocaleString() : "—"}
                      </td>

                      {/* Active Status */}
                      <td className="py-1.5 px-2.5 border-r border-slate-200/60 dark:border-slate-800 text-center whitespace-nowrap">
                        <span
                          className={`inline-block h-2 w-2 rounded-full ${
                            p.isActive ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                          title={p.isActive ? "Active" : "Inactive"}
                        />
                      </td>

                      {/* Actions */}
                      <td className="py-1 px-2 text-center whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => openEditWindow(p)}
                            className="h-6 px-2 text-[11px] text-slate-600 hover:text-slate-900"
                            title="Edit Product"
                          >
                            <Pencil className="h-3 w-3 mr-1 text-slate-400" />
                            Edit
                          </Button>
                          <button
                            type="button"
                            onClick={(e) => handleDeleteProduct(p.id, p.name, e)}
                            className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded transition-colors"
                            title="Delete Product"
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

      {/* Pattern 2: Dedicated Separate Window for Product Entry (Windows Forms Style Dialog) */}
      {isWindowOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div
            ref={formModalRef}
            className="w-full max-w-2xl bg-white dark:bg-slate-900 border-2 border-slate-300 dark:border-slate-700 rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Window Title Bar (Windows Desktop Style) */}
            <div className="bg-slate-900 text-slate-100 px-4 py-2 flex items-center justify-between border-b border-slate-800 select-none">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4 text-emerald-400" />
                <span className="font-bold text-xs">
                  {selectedProductId ? `Edit Product Form - [${formData.productNo}]` : "Product Entry Form - [New Product]"}
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
              <span>↵ Enter: Next Field / Save  •  Esc: Close  •  Tab: Jump</span>
              {sequenceDetection.patternInfo && !selectedProductId && (
                <span className="text-emerald-700 dark:text-emerald-400 font-sans text-[10px] font-semibold flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> {sequenceDetection.patternInfo}
                </span>
              )}
            </div>

            {/* Form Validation Error Banner */}
            {formError && (
              <div className="bg-rose-50 dark:bg-rose-950/50 border-b border-rose-200 dark:border-rose-800 px-4 py-2 flex items-center gap-2 text-xs text-rose-700 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            {/* Window Form Body: Strictly Vertical Row-by-Row Sequence */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs bg-slate-50/50 dark:bg-slate-950/40">
              {/* Row 0: Category (Paper Type) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Paper Category <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8 flex items-center gap-2">
                  <select
                    data-nav-index="0"
                    value={formData.categoryId}
                    onChange={(e) => setFormData((prev) => ({ ...prev, categoryId: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 0)}
                    className="flex-1 h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-semibold focus:ring-1 focus:ring-emerald-500"
                    required
                  >
                    <option value="">Select Category...</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddCategoryModal(true)}
                    className="h-8 px-2 text-xs text-slate-600"
                    title="Add New Category"
                  >
                    + New
                  </Button>
                </div>
              </div>

              {/* Row 1: GSM (Grammage) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  GSM (g/m²) <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8 flex items-center gap-2">
                  <Input
                    data-nav-index="1"
                    type="number"
                    step="1"
                    value={formData.gsm}
                    onChange={(e) => setFormData((prev) => ({ ...prev, gsm: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 1)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono font-semibold"
                    placeholder="e.g. 70"
                    required
                  />
                  <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap">g/m²</span>
                </div>
              </div>

              {/* Row 2: Product No / Code (With Paper Type & GSM Sequence Suggestions) */}
              <div className="grid grid-cols-12 gap-3 items-start py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2 pt-2">
                  Product No / Code <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8 space-y-1">
                  <Input
                    data-nav-index="2"
                    value={formData.productNo}
                    onChange={(e) => {
                      setUserEditedProductNo(true);
                      setFormData((prev) => ({ ...prev, productNo: e.target.value }));
                    }}
                    onKeyDown={(e) => handleNavKeyDown(e, 2)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono font-bold text-slate-900 dark:text-slate-100"
                    placeholder="e.g. WP-70-001 or P-0001"
                    required
                  />
                  {/* Clickable Sequence Suggestions */}
                  {sequenceDetection.suggestedCode && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5 text-[10px]">
                      <span className="text-slate-500 font-medium">Suggested sequence:</span>
                      <button
                        type="button"
                        onClick={() => {
                          setUserEditedProductNo(false);
                          setFormData((prev) => ({ ...prev, productNo: sequenceDetection.suggestedCode }));
                        }}
                        className={`font-mono px-1.5 py-0.5 rounded border transition-colors ${
                          formData.productNo === sequenceDetection.suggestedCode
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold"
                            : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
                        }`}
                      >
                        {sequenceDetection.suggestedCode}
                      </button>
                      {sequenceDetection.alternatives.map((alt) => (
                        <button
                          key={alt}
                          type="button"
                          onClick={() => {
                            setUserEditedProductNo(true);
                            setFormData((prev) => ({ ...prev, productNo: alt }));
                          }}
                          className={`font-mono px-1.5 py-0.5 rounded border transition-colors ${
                            formData.productNo === alt
                              ? "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold"
                              : "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200"
                          }`}
                        >
                          {alt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Product Name */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Product Name <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="3"
                    value={formData.name}
                    onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 3)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-medium"
                    placeholder="e.g. Writing Paper 23x36 70 GSM"
                    required
                  />
                </div>
              </div>

              {/* Row 4: Quality */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Paper Quality <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8 flex items-center gap-2">
                  <select
                    data-nav-index="4"
                    value={formData.qualityId}
                    onChange={(e) => setFormData((prev) => ({ ...prev, qualityId: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 4)}
                    className="flex-1 h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-semibold focus:ring-1 focus:ring-emerald-500"
                    required
                  >
                    <option value="">Select Quality...</option>
                    {qualities.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAddQualityModal(true)}
                    className="h-8 px-2 text-xs text-slate-600"
                    title="Add New Quality"
                  >
                    + New
                  </Button>
                </div>
              </div>

              {/* Row 5: Unit of Measure */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Unit of Measure <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8">
                  <select
                    data-nav-index="5"
                    value={formData.unit}
                    onChange={(e) => setFormData((prev) => ({ ...prev, unit: e.target.value as Unit }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 5)}
                    className="w-full h-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 text-xs font-semibold"
                  >
                    <option value={Unit.PACKET}>PACKET (100 sheets)</option>
                    <option value={Unit.REAM}>REAM (500 sheets)</option>
                  </select>
                </div>
              </div>

              {/* Row 6: Length (inches) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Length (inches) <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8 flex items-center gap-2">
                  <Input
                    data-nav-index="6"
                    type="number"
                    step="0.1"
                    value={formData.length}
                    onChange={(e) => setFormData((prev) => ({ ...prev, length: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 6)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                    placeholder="23"
                    required
                  />
                  <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap">inches</span>
                </div>
              </div>

              {/* Row 7: Breadth (inches) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Breadth (inches) <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8 flex items-center gap-2">
                  <Input
                    data-nav-index="7"
                    type="number"
                    step="0.1"
                    value={formData.breadth}
                    onChange={(e) => setFormData((prev) => ({ ...prev, breadth: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 7)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                    placeholder="36"
                    required
                  />
                  <span className="text-[11px] text-slate-400 font-mono whitespace-nowrap">inches</span>
                </div>
              </div>

              {/* Row: Calculated Weights Readout (Read-Only) */}
              <div className="grid grid-cols-12 gap-3 items-center py-2 bg-slate-100 dark:bg-slate-800/80 px-2 rounded border border-slate-200 dark:border-slate-700">
                <div className="col-span-4 text-right font-bold text-slate-600 dark:text-slate-400 pr-2 flex items-center justify-end gap-1">
                  <Scale className="h-3.5 w-3.5 text-slate-500" />
                  Calculated Weights:
                </div>
                <div className="col-span-8 flex flex-wrap items-center gap-4 text-xs font-mono">
                  <div>
                    <span className="text-slate-500 text-[10px]">Packet Weight:</span>{" "}
                    <strong className="text-slate-900 dark:text-slate-100">
                      {liveWeights.packetWeight.toFixed(3)} kg
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-500 text-[10px]">Ream Weight (500s):</span>{" "}
                    <strong className="text-emerald-700 dark:text-emerald-400">
                      {liveWeights.reamWeight.toFixed(3)} kg
                    </strong>
                  </div>
                </div>
              </div>

              {/* Row 8: Cost Price (PKR) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Cost Price (PKR) <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="8"
                    type="number"
                    step="0.01"
                    value={formData.costPrice}
                    onChange={(e) => setFormData((prev) => ({ ...prev, costPrice: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 8)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {/* Row 9: Retail Price (PKR) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Retail Price (PKR) <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="9"
                    type="number"
                    step="0.01"
                    value={formData.retailPrice}
                    onChange={(e) => setFormData((prev) => ({ ...prev, retailPrice: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 9)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono font-bold text-emerald-700 dark:text-emerald-400"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {/* Row 10: Wholesale Price (PKR) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Wholesale Price (PKR) <span className="text-rose-500">*</span>:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="10"
                    type="number"
                    step="0.01"
                    value={formData.wholesalePrice}
                    onChange={(e) => setFormData((prev) => ({ ...prev, wholesalePrice: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 10)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                    placeholder="0.00"
                    required
                  />
                </div>
              </div>

              {/* Row 11: Labour Charges (PKR) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Labour Charges (PKR):
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="11"
                    type="number"
                    step="0.01"
                    value={formData.labourCharges}
                    onChange={(e) => setFormData((prev) => ({ ...prev, labourCharges: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 11)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                    placeholder="0.00"
                  />
                </div>
              </div>

              {/* Row 12: Reorder Level (Units) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Reorder Alert Level:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="12"
                    type="number"
                    step="1"
                    value={formData.reorderLevel}
                    onChange={(e) => setFormData((prev) => ({ ...prev, reorderLevel: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 12)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                    placeholder="10"
                  />
                </div>
              </div>

              {/* Row 13: Mill Serial / Code No */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Mill / Serial Code:
                </label>
                <div className="col-span-8">
                  <Input
                    data-nav-index="13"
                    value={formData.serialNo}
                    onChange={(e) => setFormData((prev) => ({ ...prev, serialNo: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 13)}
                    className="h-8 text-xs bg-white dark:bg-slate-900 font-mono"
                    placeholder="e.g. ML-9921 or Lot identifier"
                  />
                </div>
              </div>

              {/* Row 14: Remarks (Final Field - Pressing Enter saves!) */}
              <div className="grid grid-cols-12 gap-3 items-center py-1 border-b border-slate-200/60 dark:border-slate-800">
                <label className="col-span-4 text-right font-bold text-slate-700 dark:text-slate-300 pr-2">
                  Remarks / Notes:
                </label>
                <div className="col-span-8 space-y-1">
                  <Input
                    data-nav-index="14"
                    value={formData.remarks}
                    onChange={(e) => setFormData((prev) => ({ ...prev, remarks: e.target.value }))}
                    onKeyDown={(e) => handleNavKeyDown(e, 14)}
                    className="h-8 text-xs bg-white dark:bg-slate-900"
                    placeholder="Press [Enter] here to save product"
                  />
                  <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-medium">
                    ↵ Pressing [Enter] on this field saves the product immediately.
                  </p>
                </div>
              </div>

              {/* Row 15: Catalog Status */}
              <div className="grid grid-cols-12 gap-3 items-center py-1">
                <div className="col-span-4 text-right pr-2">
                  <span className="font-bold text-slate-700 dark:text-slate-300">Catalog Status:</span>
                </div>
                <div className="col-span-8 flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isActive"
                    checked={formData.isActive}
                    onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <label htmlFor="isActive" className="text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                    Active Catalog Product (available for sales and purchasing)
                  </label>
                </div>
              </div>
            </div>

            {/* Window Footer Action Bar */}
            <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
              <div>
                {selectedProductId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteProduct()}
                    disabled={saving}
                    className="h-8 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete Product
                  </Button>
                ) : (
                  <span className="text-[11px] text-slate-500 font-mono">[Esc] to Cancel</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={closeWindow}
                  disabled={saving}
                  className="h-8 text-xs border-slate-300 dark:border-slate-700"
                >
                  Cancel (Esc)
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveProduct}
                  disabled={saving}
                  className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs px-4"
                >
                  <Save className="h-3.5 w-3.5 mr-1.5" />
                  {saving ? "Saving..." : selectedProductId ? "Update Product (Enter)" : "Save Product (Enter)"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Inline Quick Add Category Modal */}
      {showAddCategoryModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 shadow-xl space-y-3">
            <h3 className="font-bold text-xs text-slate-900 dark:text-slate-100">Add New Category</h3>
            <Input
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="e.g. Art Card or Kraft Paper"
              className="h-8 text-xs bg-white dark:bg-slate-950"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateCategory();
                } else if (e.key === "Escape") {
                  setShowAddCategoryModal(false);
                }
              }}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddCategoryModal(false)}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateCategory}
                disabled={categorySaving || !newCategoryName.trim()}
                className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
              >
                {categorySaving ? "Saving..." : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Inline Quick Add Quality Modal */}
      {showAddQualityModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4 shadow-xl space-y-3">
            <h3 className="font-bold text-xs text-slate-900 dark:text-slate-100">Add New Quality</h3>
            <Input
              value={newQualityName}
              onChange={(e) => setNewQualityName(e.target.value)}
              placeholder="e.g. Super Prime or Premium"
              className="h-8 text-xs bg-white dark:bg-slate-950"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleCreateQuality();
                } else if (e.key === "Escape") {
                  setShowAddQualityModal(false);
                }
              }}
            />
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAddQualityModal(false)}
                className="h-7 text-xs"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleCreateQuality}
                disabled={qualitySaving || !newQualityName.trim()}
                className="h-7 bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
              >
                {qualitySaving ? "Saving..." : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-xs text-slate-500 font-mono">Loading Products Catalog...</div>}>
      <ProductsPageContent />
    </Suspense>
  );
}
