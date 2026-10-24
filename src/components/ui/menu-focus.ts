import { useCallback, useRef, type FocusEvent } from "react";

/**
 * Opening a menu puts focus on its first enabled item, whether a press or a
 * key opened it, as in the WAI-ARIA menu button pattern. Radix focuses the
 * menu itself on a press; its first focus is passed on to the first item,
 * or to a filter field marked `data-menu-filter` that comes before it.
 */
export function useFirstItemFocus(
  onFocus?: (event: FocusEvent<HTMLDivElement>) => void,
) {
  const opened = useRef(false);
  // A stable ref: Radix re-measures the menu whenever its ref changes.
  const ref = useCallback((element: HTMLDivElement | null) => {
    opened.current = !!element;
  }, []);
  return {
    ref,
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      onFocus?.(event);
      if (!opened.current) return;
      opened.current = false;
      if (event.target === event.currentTarget)
        event.currentTarget
          .querySelector<HTMLElement>(
            "[data-menu-filter], [role^=menuitem]:not([data-disabled])",
          )
          ?.focus({ preventScroll: true });
    },
  };
}
