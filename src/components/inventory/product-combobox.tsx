"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, X, AlertCircle } from "lucide-react";

export interface ProductItemOption {
  id: string;
  productNo: string;
  name: string;
  unit?: string;
  gsm?: number | null;
  length?: number | null;
  breadth?: number | null;
  category?: { id?: string; name: string } | null;
  retailPrice?: number | null;
  costPrice?: number | null;
}

interface ProductComboboxProps {
  products: ProductItemOption[];
  value: string; // selected product ID
  onChange: (productId: string, product?: ProductItemOption) => void;
  locationId?: string;
  locationName?: string;
  lotId?: string;
  getStock: (productId: string, locationId?: string, lotId?: string) => number;
  getTotalStock?: (productId: string) => number;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  onEnterPress?: (product?: ProductItemOption) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  required?: boolean;
}

export function ProductCombobox({
  products,
  value,
  onChange,
  locationId,
  locationName,
  lotId,
  getStock,
  getTotalStock,
  placeholder = "Type product no or name...",
  className = "",
  inputClassName = "",
  onEnterPress,
  autoFocus = false,
  disabled = false,
  id,
  required = false,
}: ProductComboboxProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === value),
    [products, value]
  );

  // Synchronize text when value changes
  useEffect(() => {
    if (selectedProduct) {
      setSearchQuery(`${selectedProduct.productNo} - ${selectedProduct.name}`);
    } else if (!value) {
      setSearchQuery("");
    }
  }, [selectedProduct, value]);

  const isQueryMatchingSelection = useMemo(() => {
    if (!selectedProduct) return false;
    const full = `${selectedProduct.productNo} - ${selectedProduct.name}`.toLowerCase();
    const q = searchQuery.trim().toLowerCase();
    return q === full || q === selectedProduct.productNo.toLowerCase() || q === selectedProduct.name.toLowerCase();
  }, [selectedProduct, searchQuery]);

  // Filter options based on user typing (matches productNo, name, category, or dimensions)
  const filteredProducts = useMemo(() => {
    if (isQueryMatchingSelection) {
      return products;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return products;

    return products.filter((p) => {
      const matchNo = p.productNo.toLowerCase().includes(q);
      const matchName = p.name.toLowerCase().includes(q);
      const matchCategory = p.category?.name ? p.category.name.toLowerCase().includes(q) : false;
      const matchDimensions = p.gsm ? String(p.gsm).includes(q) : false;
      return matchNo || matchName || matchCategory || matchDimensions;
    });
  }, [products, searchQuery, isQueryMatchingSelection]);

  // Positioning
  const [coords, setCoords] = useState<{
    top: number;
    bottom: number;
    left: number;
    width: number;
    placeAbove: boolean;
  }>({
    top: 0,
    bottom: 0,
    left: 0,
    width: 0,
    placeAbove: false,
  });

  const updatePosition = () => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const dropdownHeight = 240;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placeAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      const calculatedWidth = Math.max(rect.width, 320);

      const maxLeft = Math.max(8, window.innerWidth - calculatedWidth - 8);
      const left = Math.max(8, Math.min(rect.left, maxLeft));

      setCoords({
        top: rect.bottom + 4,
        bottom: window.innerHeight - rect.top + 4,
        left,
        width: calculatedWidth,
        placeAbove,
      });
    }
  };

  useEffect(() => {
    if (isOpen) {
      updatePosition();
      const onScrollOrResize = () => updatePosition();
      window.addEventListener("scroll", onScrollOrResize, true);
      window.addEventListener("resize", onScrollOrResize);
      return () => {
        window.removeEventListener("scroll", onScrollOrResize, true);
        window.removeEventListener("resize", onScrollOrResize);
      };
    }
  }, [isOpen]);

  // Click outside handling with auto-commit if user typed something valid
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setIsOpen(false);
        // If nothing was selected yet, but user typed something that matches
        if (!value && searchQuery.trim()) {
          const q = searchQuery.trim().toLowerCase();
          const match =
            filteredProducts.find((p) => p.productNo.toLowerCase() === q || p.name.toLowerCase() === q) ||
            filteredProducts.find((p) => p.productNo.toLowerCase().startsWith(q) || p.name.toLowerCase().includes(q)) ||
            filteredProducts[0];

          if (match) {
            handleSelect(match);
            return;
          }
        }

        if (selectedProduct) {
          setSearchQuery(`${selectedProduct.productNo} - ${selectedProduct.name}`);
        } else if (!value) {
          setSearchQuery("");
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedProduct, value, searchQuery, filteredProducts]);

  // Scroll highlighted item
  useEffect(() => {
    if (isOpen && listRef.current) {
      const items = listRef.current.querySelectorAll("[data-product-option]");
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  function handleSelect(p: ProductItemOption) {
    onChange(p.id, p);
    setSearchQuery(`${p.productNo} - ${p.name}`);
    setIsOpen(false);

    if (onEnterPress) {
      onEnterPress(p);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightedIndex((prev) => (prev < filteredProducts.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredProducts.length - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && filteredProducts.length > 0) {
        const p = filteredProducts[highlightedIndex] || filteredProducts[0];
        if (p) {
          handleSelect(p);
        }
      } else if (!isOpen && selectedProduct) {
        if (onEnterPress) onEnterPress(selectedProduct);
      } else if (filteredProducts.length > 0) {
        const q = searchQuery.trim().toLowerCase();
        const exact = filteredProducts.find(
          (p) => p.productNo.toLowerCase() === q || p.name.toLowerCase() === q
        );
        handleSelect(exact || filteredProducts[0]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      if (selectedProduct) {
        setSearchQuery(`${selectedProduct.productNo} - ${selectedProduct.name}`);
      }
    } else if (e.key === "Tab") {
      if (isOpen && filteredProducts.length > 0) {
        const p = filteredProducts[highlightedIndex] || filteredProducts[0];
        if (p) {
          onChange(p.id, p);
          setSearchQuery(`${p.productNo} - ${p.name}`);
        }
      }
      setIsOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={`relative w-full ${className}`}>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (!isOpen) setIsOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => {
            setIsOpen(true);
            inputRef.current?.select();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          autoComplete="off"
          className={`w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-emerald-600 focus:border-emerald-600 disabled:opacity-50 ${
            searchQuery && !disabled ? "pr-12" : "pr-7"
          } ${inputClassName}`}
        />

        {searchQuery && !disabled && (
          <button
            type="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              setSearchQuery("");
              onChange("", undefined);
              setIsOpen(true);
              inputRef.current?.focus();
            }}
            className="absolute right-6 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
            title="Clear product"
          >
            <X className="h-3 w-3" />
          </button>
        )}

        <button
          type="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            if (!disabled) {
              setIsOpen((prev) => !prev);
              inputRef.current?.focus();
            }
          }}
          className="absolute right-1 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {isOpen && mounted && typeof document !== "undefined" && createPortal(
        <div
          ref={listRef}
          style={{
            position: "fixed",
            top: coords.placeAbove ? undefined : `${coords.top}px`,
            bottom: coords.placeAbove ? `${coords.bottom}px` : undefined,
            left: `${coords.left}px`,
            width: `${coords.width}px`,
            maxWidth: "96vw",
            zIndex: 99999,
          }}
          className="max-h-60 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-2xl text-xs ring-1 ring-black/5 dark:ring-white/10"
        >
          {filteredProducts.length === 0 ? (
            <div className="px-3 py-2 text-slate-400 dark:text-slate-500 italic">No matching products found</div>
          ) : (
            filteredProducts.map((p, index) => {
              const isSelected = p.id === value;
              const isHighlighted = index === highlightedIndex;

              const locStock = locationId ? getStock(p.id, locationId, lotId) : null;
              const totalStock = getTotalStock ? getTotalStock(p.id) : getStock(p.id);
              const displayStock = locStock !== null ? locStock : totalStock;
              const hasStock = displayStock > 0;

              return (
                <div
                  key={p.id}
                  data-product-option
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelect(p);
                  }}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex items-center justify-between px-3 py-2 cursor-pointer select-none transition-colors border-b border-slate-100 dark:border-slate-800 last:border-b-0 ${
                    isSelected
                      ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-950 dark:text-emerald-100 font-semibold"
                      : isHighlighted
                      ? "bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-100"
                      : "text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <strong className="font-mono text-emerald-700 dark:text-emerald-400 font-bold">{p.productNo}</strong>
                      <span className="truncate">{p.name}</span>
                    </div>
                    {(p.category?.name || p.gsm) && (
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {p.category?.name ? p.category.name : ""}
                        {p.category?.name && p.gsm ? " • " : ""}
                        {p.gsm ? `${p.gsm} GSM` : ""}
                        {p.length && p.breadth ? ` (${p.length}x${p.breadth})` : ""}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${
                        hasStock
                          ? "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800"
                          : "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800"
                      }`}
                    >
                      Stock: {displayStock} {p.unit || "pkts"}
                      {locStock !== null && totalStock !== locStock ? ` (Tot: ${totalStock})` : ""}
                    </span>

                    {isSelected && <Check className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />}
                  </div>
                </div>
              );
            })
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
