export function fallbackFocus(root: HTMLElement | null) {
  const scope =
    Array.from(
      root?.querySelectorAll<HTMLDialogElement>("dialog[open]") ?? [],
    ).at(-1) ?? root;
  return (
    Array.from(
      scope?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? [],
    ).find(
      (button) =>
        button.getClientRects().length > 0 &&
        !button.closest("dialog:not([open])"),
    ) ?? null
  );
}
