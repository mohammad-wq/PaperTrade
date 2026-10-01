"use client";

import { useEffect, useRef, useCallback } from "react";

const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not([disabled]):not([readonly])',
  'select:not([disabled]):not([readonly])',
  'textarea:not([disabled]):not([readonly])',
].join(", ");

export function isFocusableVisible(el: HTMLElement): boolean {
  return (
    el.offsetParent !== null &&
    window.getComputedStyle(el).visibility !== "hidden" &&
    window.getComputedStyle(el).display !== "none"
  );
}

/**
 * Global Form Enter Navigation
 * 1. Enter key:
 *    - Moves focus sequentially to next focusable input.
 *    - If pressed on the final field, triggers form submission.
 *    - Allows regular newline entry inside <textarea> fields.
 *    - Skips disabled, hidden, or readonly inputs.
 * 2. Tab and Shift+Tab:
 *    - Native browser tab-index order is preserved.
 * 3. Arrow keys:
 *    - Standard text cursor movement inside inputs (never jump focus).
 */
export function handleFormEnterKeyDown(
  e: React.KeyboardEvent<HTMLElement> | KeyboardEvent,
  container?: HTMLElement | null,
  onSubmit?: () => void
) {
  // If event default was already prevented (e.g., inside an open typeahead/combobox dropdown), do not interfere
  if (e.defaultPrevented) return;

  const target = e.target as HTMLElement;
  if (!target) return;

  const tagName = target.tagName.toLowerCase();

  // 1. Textarea: allow regular newline entry inside <textarea> fields unless Ctrl/Cmd+Enter is pressed
  if (tagName === "textarea" && e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
    return;
  }

  // 2. Buttons: allow default click/submit behavior
  if (tagName === "button") {
    return;
  }

  // Only handle Enter
  if (e.key !== "Enter") {
    return;
  }

  // Find container form or dialog
  const activeContainer =
    container ||
    target.closest<HTMLElement>("form") ||
    target.closest<HTMLElement>('[role="dialog"]') ||
    target.closest<HTMLElement>("[data-form-container]") ||
    document.body;

  if (!activeContainer) return;

  const focusables = Array.from(
    activeContainer.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter(isFocusableVisible);

  if (focusables.length === 0) return;

  const currentIndex = focusables.indexOf(target);

  if (currentIndex === -1) {
    return;
  }

  e.preventDefault();

  // If pressed on the final field of the form, trigger form submission
  if (currentIndex === focusables.length - 1) {
    if (onSubmit) {
      onSubmit();
    } else {
      const submitBtn = activeContainer.querySelector<HTMLButtonElement>(
        'button[type="submit"]:not([disabled])'
      );
      if (submitBtn) {
        submitBtn.click();
      }
    }
    return;
  }

  // Move focus sequentially to next focusable input
  const nextElement = focusables[currentIndex + 1];
  if (nextElement) {
    nextElement.focus();
    if (
      nextElement instanceof HTMLInputElement &&
      (nextElement.type === "text" || nextElement.type === "number")
    ) {
      nextElement.select();
    }
  }
}

export function useFormEnterNavigation(options?: {
  onSubmit?: () => void;
  formRef?: React.RefObject<HTMLElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement | HTMLFormElement | null>(null);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLElement>) => {
      const ref = options?.formRef?.current || containerRef.current;
      handleFormEnterKeyDown(e, ref, options?.onSubmit);
    },
    [options?.formRef, options?.onSubmit]
  );

  return {
    formRef: containerRef,
    onKeyDown,
    handleKeyDown: onKeyDown,
  };
}
