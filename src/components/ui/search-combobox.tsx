"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, X } from "lucide-react";

export interface ComboboxOption {
  id: string;
  label: string;
  sublabel?: string;
  badge?: string;
  badgeColor?: "green" | "sky" | "amber" | "rose" | "slate";
  disabled?: boolean;
  data?: any;
}

interface SearchComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string, selectedOption?: ComboboxOption) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  nextRef?: React.RefObject<any>;
  onEnterPress?: (selectedOption?: ComboboxOption) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  id?: string;
  required?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
}

export function SearchCombobox({
  options,
  value,
  onChange,
  placeholder = "Search or select...",
  className = "",
  inputClassName = "",
  nextRef,
  onEnterPress,
  autoFocus = false,
  disabled = false,
  id,
  required = false,
  inputRef: externalInputRef,
}: SearchComboboxProps) {
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || internalInputRef;
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Find currently selected option
  const selectedOption = useMemo(
    () => options.find((opt) => opt.id === value),
    [options, value]
  );

  // Sync search query when value changes
  useEffect(() => {
    if (selectedOption) {
      setSearchQuery(selectedOption.label);
    } else if (!value) {
      setSearchQuery("");
    }
  }, [selectedOption, value]);

  // Check if current search query simply reflects the currently selected option
  const isQueryMatchingSelection = useMemo(() => {
    if (!selectedOption) return false;
    return searchQuery.trim().toLowerCase() === selectedOption.label.trim().toLowerCase();
  }, [selectedOption, searchQuery]);

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    // When the input has not been modified by the user (matches current selection),
    // show ALL available options so the user can see everything (e.g. Shop AND Main Warehouse).
    if (isQueryMatchingSelection) {
      return options;
    }
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(q) ||
        (opt.sublabel && opt.sublabel.toLowerCase().includes(q)) ||
        (opt.badge && opt.badge.toLowerCase().includes(q))
    );
  }, [options, searchQuery, isQueryMatchingSelection]);

  // Sync highlighted item to selected value when opened
  useEffect(() => {
    if (isOpen) {
      const idx = filteredOptions.findIndex((opt) => opt.id === value);
      setHighlightedIndex(idx >= 0 ? idx : 0);
    }
  }, [isOpen, value, filteredOptions]);

  // Float positioning state for portal
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
      const dropdownHeight = 224;
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const placeAbove = spaceBelow < dropdownHeight && spaceAbove > spaceBelow;
      const calculatedWidth = Math.max(rect.width, 200);

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

  // Click outside listener that checks both container and portalled list
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
        if (selectedOption) {
          setSearchQuery(selectedOption.label);
        } else if (!value) {
          setSearchQuery("");
        }
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [selectedOption, value]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (isOpen && listRef.current) {
      const items = listRef.current.querySelectorAll("li");
      if (items[highlightedIndex]) {
        items[highlightedIndex].scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex, isOpen]);

  function handleSelect(option: ComboboxOption) {
    if (option.disabled) return;
    onChange(option.id, option);
    setSearchQuery(option.label);
    setIsOpen(false);

    if (onEnterPress) {
      onEnterPress(option);
    } else if (nextRef?.current) {
      setTimeout(() => {
        nextRef.current?.focus();
        if (nextRef.current?.select) nextRef.current.select();
      }, 10);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightedIndex((prev) => (prev < filteredOptions.length - 1 ? prev + 1 : 0));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : filteredOptions.length - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (isOpen && filteredOptions.length > 0) {
        const option = filteredOptions[highlightedIndex];
        if (option && !option.disabled) {
          handleSelect(option);
        }
      } else if (!isOpen && selectedOption) {
        if (onEnterPress) {
          onEnterPress(selectedOption);
        } else if (nextRef?.current) {
          nextRef.current?.focus();
          if (nextRef.current?.select) nextRef.current.select();
        }
      } else if (!isOpen && filteredOptions.length > 0) {
        handleSelect(filteredOptions[0]);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      setIsOpen(false);
      if (selectedOption) {
        setSearchQuery(selectedOption.label);
      }
    } else if (e.key === "Tab") {
      if (isOpen && filteredOptions.length > 0) {
        const option = filteredOptions[highlightedIndex];
        if (option && !option.disabled) {
          onChange(option.id, option);
          setSearchQuery(option.label);
        }
      }
      setIsOpen(false);
    }
  }

  function getBadgeClasses(color?: string) {
    switch (color) {
      case "green":
        return "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300";
      case "sky":
        return "bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300";
      case "amber":
        return "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300";
      case "rose":
        return "bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300";
      default:
        return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300";
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
          }}
          onFocus={() => {
            setIsOpen(true);
            inputRef.current?.select();
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          required={required && !value}
          autoFocus={autoFocus}
          autoComplete="off"
          className={`w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1.5 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-hidden focus:ring-1 focus:ring-sky-600 focus:border-sky-600 disabled:opacity-50 ${
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
            title="Clear selection"
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
        <ul
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
          className="max-h-56 overflow-auto rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 py-1 shadow-2xl text-xs ring-1 ring-black/5 dark:ring-white/10"
        >
          {filteredOptions.length === 0 ? (
            <li className="px-3 py-2 text-slate-400 dark:text-slate-500 italic">No matches found</li>
          ) : (
            filteredOptions.map((option, index) => {
              const isSelected = option.id === value;
              const isHighlighted = index === highlightedIndex;

              return (
                <li
                  key={option.id}
                  onClick={() => handleSelect(option)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`flex items-center justify-between px-2.5 py-1.5 cursor-pointer select-none transition-colors ${
                    option.disabled
                      ? "opacity-40 cursor-not-allowed"
                      : isHighlighted
                      ? "bg-sky-50 dark:bg-sky-950/60 text-sky-900 dark:text-sky-100 font-semibold"
                      : "text-slate-800 dark:text-slate-200"
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 pr-2">
                    <span className="truncate">{option.label}</span>
                    {option.sublabel && (
                      <span className="text-[10px] text-slate-400 truncate">({option.sublabel})</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {option.badge && (
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${getBadgeClasses(
                          option.badgeColor
                        )}`}
                      >
                        {option.badge}
                      </span>
                    )}
                    {isSelected && <Check className="h-3.5 w-3.5 text-sky-700 dark:text-sky-400 shrink-0" />}
                  </div>
                </li>
              );
            })
          )}
        </ul>,
        document.body
      )}
    </div>
  );
}
