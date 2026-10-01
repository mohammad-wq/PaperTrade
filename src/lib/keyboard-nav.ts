/**
 * Universal Keyboard Navigation Utility for PaperTrade ERP
 *
 * Module 2 Requirements:
 * 1. Enter Key:
 *    - Moves focus sequentially to the next focusable form input.
 *    - If pressed on the final field of the form, triggers form submission.
 *    - Exception: Allow regular newline entry inside <textarea> fields.
 *    - Skip disabled, hidden, or readonly inputs in the navigation sequence.
 * 2. Tab and Shift+Tab:
 *    - Maintain native browser tab-index order. Remove any existing custom event overrides.
 * 3. Arrow Keys:
 *    - Standard text cursor movement inside inputs. Never bind arrow keys to field-level focus jumping.
 */

export { handleFormEnterKeyDown, useFormEnterNavigation, isFocusableVisible } from "@/hooks/use-form-enter-navigation";

import { handleFormEnterKeyDown } from "@/hooks/use-form-enter-navigation";

export function handleFormKeyDown(
  e: React.KeyboardEvent<HTMLElement>,
  containerRef?: React.RefObject<HTMLElement | null>,
  options?: {
    onSubmit?: () => void;
  }
) {
  handleFormEnterKeyDown(e, containerRef?.current, options?.onSubmit);
}
