/**
 * Universal Keyboard Navigation Utility for PaperTrade ERP
 * Enables rapid, mouse-free data entry across all forms, dialogs, and tables.
 *
 * Behaviors:
 * - Enter: Advance to next input/select/field and select its contents for quick editing.
 * - Enter on last field: Submits the form or triggers the primary action button.
 * - Shift+Enter / ArrowUp (on text/number inputs): Navigate to previous field.
 * - ArrowDown (on text/number inputs without open dropdowns): Navigate to next field.
 */

const FOCUSABLE_SELECTOR = [
  'input:not([type="hidden"]):not([disabled]):not([readonly])',
  'select:not([disabled])',
  'textarea:not([disabled]):not([readonly])',
  'button[data-nav-item="true"]:not([disabled])',
  'button[type="submit"]:not([disabled])',
].join(", ");

export function handleFormKeyDown(
  e: React.KeyboardEvent,
  containerRef?: React.RefObject<HTMLElement | null>,
  options?: {
    onSubmit?: () => void;
    allowArrowUpDown?: boolean;
  }
) {
  // If event was already handled (e.g. inside combobox typeahead), do not interfere
  if (e.defaultPrevented) return;

  const target = e.target as HTMLElement;
  if (!target) return;

  const tagName = target.tagName.toLowerCase();
  const inputType = (target as HTMLInputElement).type?.toLowerCase();

  // Allow multiline typing in textarea unless Ctrl+Enter or Cmd+Enter is pressed
  if (tagName === "textarea" && e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
    return;
  }

  const isEnter = e.key === "Enter";
  const isDown = options?.allowArrowUpDown && e.key === "ArrowDown" && tagName !== "select";
  const isUp = (options?.allowArrowUpDown && e.key === "ArrowUp" && tagName !== "select") || (e.shiftKey && e.key === "Enter");

  if (!isEnter && !isDown && !isUp) {
    return;
  }

  // Find container: either containerRef, closest form, closest modal/dialog, or document body
  const container =
    containerRef?.current ||
    target.closest<HTMLElement>("form") ||
    target.closest<HTMLElement>('[role="dialog"]') ||
    target.closest<HTMLElement>("[data-keyboard-nav]") ||
    document.body;

  if (!container) return;

  // Query all eligible focusable elements
  const allElements = Array.from(
    container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
  ).filter((el) => {
    // Filter out hidden elements
    return el.offsetParent !== null && window.getComputedStyle(el).visibility !== "hidden";
  });

  if (allElements.length === 0) return;

  // Check if explicit `data-nav-index` ordering is used
  const hasNavIndex = allElements.some((el) => el.hasAttribute("data-nav-index"));
  let sortedElements = allElements;
  if (hasNavIndex) {
    sortedElements = [...allElements].sort((a, b) => {
      const idxA = parseInt(a.getAttribute("data-nav-index") || "999", 10);
      const idxB = parseInt(b.getAttribute("data-nav-index") || "999", 10);
      return idxA - idxB;
    });
  }

  const currentIndex = sortedElements.indexOf(target);

  if (isUp) {
    e.preventDefault();
    if (currentIndex > 0) {
      const prev = sortedElements[currentIndex - 1];
      prev.focus();
      if (prev instanceof HTMLInputElement && (prev.type === "text" || prev.type === "number")) {
        prev.select();
      }
    }
    return;
  }

  if (isEnter || isDown) {
    // If target is submit button and user presses enter, allow native click
    if (isEnter && target.getAttribute("type") === "submit") {
      return;
    }

    e.preventDefault();

    if (currentIndex >= 0 && currentIndex < sortedElements.length - 1) {
      const next = sortedElements[currentIndex + 1];
      next.focus();
      if (next instanceof HTMLInputElement && (next.type === "text" || next.type === "number")) {
        next.select();
      }
    } else {
      // Reached the last field or no next field found
      if (options?.onSubmit) {
        options.onSubmit();
      } else {
        // Trigger submit button if found
        const submitBtn = sortedElements.find(
          (el) => el.getAttribute("type") === "submit" && !el.hasAttribute("disabled")
        );
        if (submitBtn) {
          submitBtn.click();
        } else if (container instanceof HTMLFormElement) {
          container.requestSubmit?.();
        }
      }
    }
  }
}
