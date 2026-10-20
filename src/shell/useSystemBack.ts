import { useEffect } from "react";
import type { ShellNavigation } from "./useShellNavigation";
import type { WorkspaceChrome } from "./useWorkspaceChrome";

const layerSelector = 'dialog[open], [role="dialog"][aria-modal="true"]';
// Radix keeps a closing layer mounted for its exit animation.
const visible = (element: Element) =>
  element.getClientRects().length > 0 &&
  !element.closest('[inert], [data-state="closed"]');

/** Uses the same cancel/Escape path as keyboard input, preserving local ownership. */
function dismissLayer(event: Event) {
  const focused = document.activeElement?.closest(layerSelector);
  const dialog =
    focused && visible(focused)
      ? focused
      : [...document.querySelectorAll(layerSelector)].filter(visible).at(-1);
  const menu = [
    ...(dialog ?? document).querySelectorAll('[role="menu"], [role="listbox"]'),
  ]
    .filter(visible)
    .at(-1);
  if (menu) {
    event.preventDefault();
    menu.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    return true;
  }
  if (!dialog) return false;
  event.preventDefault();
  // A dialog reached from another step goes back to it, as its own button does.
  const stepBack = dialog.querySelector<HTMLButtonElement>(
    "button[data-dialog-back]:not(:disabled)",
  );
  if (stepBack) stepBack.click();
  else if (dialog instanceof HTMLDialogElement) {
    if (dialog.dispatchEvent(new Event("cancel", { cancelable: true })))
      dialog.close();
  } else {
    dialog.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
  }
  return true;
}

/** Android handles IME first; unconsumed events fall through to system navigation. */
export function useSystemBack(
  navigation: ShellNavigation,
  chrome: WorkspaceChrome,
) {
  useEffect(() => {
    const back = (event: Event) => {
      if (event.defaultPrevented || dismissLayer(event)) return;
      if (navigation.manager.open) {
        event.preventDefault();
        navigation.closeManager();
      } else if (chrome.back) {
        event.preventDefault();
        chrome.back();
      }
    };
    window.addEventListener("plums:back", back);
    return () => window.removeEventListener("plums:back", back);
  }, [navigation, chrome]);
}
