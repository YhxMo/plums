/** The first visible enabled button in the innermost open dialog, else in `root`. */
export function fallbackFocus(root: HTMLElement | null) {
  const scope =
    Array.from(
      document.querySelectorAll<HTMLElement>(
        '[role="dialog"][data-state="open"]',
      ),
    ).at(-1) ?? root;
  return (
    Array.from(
      scope?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    ).find((button) => button.getClientRects().length > 0) ?? null
  );
}
