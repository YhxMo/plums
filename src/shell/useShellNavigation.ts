import { useEffect, useRef, useState } from "react";
import type { Runtime } from "./runtime";

export type ShellDialog =
  "settings" | "about" | { id: string; label: string } | null;

export function useShellNavigation(runtime: Runtime) {
  const [manager, setManager] = useState({
    open: false,
    diagnostics: false,
    targetId: undefined as string | undefined,
  });
  const [dialog, setDialog] = useState<ShellDialog>(null);
  const managerTrigger = useRef<HTMLElement | null>(null);
  function openManager(diagnostics = false, targetId?: string) {
    managerTrigger.current = document.activeElement as HTMLElement | null;
    setDialog(null);
    setManager({ open: true, diagnostics, targetId });
  }
  function closeManager() {
    setManager((previous) => ({ ...previous, open: false }));
  }
  useEffect(() => {
    if (manager.open || !managerTrigger.current) return;
    const target = managerTrigger.current;
    if (target.isConnected) target.focus();
    else
      document.querySelector<HTMLElement>('[aria-label="应用菜单"]')?.focus();
  }, [manager.open]);
  useEffect(() => {
    const open = (event: Event) => {
      const action = (event as CustomEvent<string>).detail;
      if (action === "settings") setDialog("settings");
      else openManager(action === "diagnostics");
    };
    runtime.events.addEventListener("shell", open);
    return () => runtime.events.removeEventListener("shell", open);
  }, [runtime]);
  return {
    manager,
    dialog,
    setDialog,
    openManager,
    closeManager,
    setDiagnostics(open: boolean) {
      setManager((previous) =>
        previous.diagnostics === open
          ? previous
          : { ...previous, diagnostics: open },
      );
    },
  };
}

export type ShellNavigation = ReturnType<typeof useShellNavigation>;
