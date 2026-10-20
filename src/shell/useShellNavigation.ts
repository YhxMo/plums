import { useEffect, useRef, useState } from "react";
import type { Runtime } from "./runtime";

export type ShellDialog =
  "settings" | "about" | { id: string; label: string } | null;
type Step = Exclude<ShellDialog, null>;

const stepLabel = (step: Step) =>
  step === "settings"
    ? "应用设置"
    : step === "about"
      ? "关于 Plums"
      : step.label;

export function useShellNavigation(runtime: Runtime) {
  const [manager, setManager] = useState({
    open: false,
    diagnostics: false,
    targetId: undefined as string | undefined,
  });
  // Dialogs opened from another dialog stack up so Back returns to it.
  const [steps, setSteps] = useState<Step[]>([]);
  const stepsNow = useRef(steps);
  stepsNow.current = steps;
  const managerTrigger = useRef<HTMLElement | null>(null);
  // The dialogs extension management was opened from, restored on return.
  const managerFrom = useRef<Step[]>([]);
  function setDialog(next: ShellDialog) {
    setSteps(next ? [next] : []);
  }
  function pushDialog(next: Step) {
    setSteps((previous) => {
      const top = previous.at(-1);
      const same =
        top === next ||
        (typeof top === "object" &&
          typeof next === "object" &&
          top.id === next.id);
      return same ? previous : [...previous, next];
    });
  }
  function openManager(diagnostics = false, targetId?: string) {
    managerFrom.current = stepsNow.current;
    managerTrigger.current = managerFrom.current.length
      ? null
      : (document.activeElement as HTMLElement | null);
    setSteps([]);
    setManager({ open: true, diagnostics, targetId });
  }
  function closeManager() {
    setManager((previous) => ({ ...previous, open: false }));
    setSteps(managerFrom.current);
    managerFrom.current = [];
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
      const { action, target } = (
        event as CustomEvent<{ action: string; target?: string }>
      ).detail;
      if (action === "settings") pushDialog("settings");
      else if (action === "view" && target)
        // The catalog names the view even while its extension is waiting.
        pushDialog({
          id: target,
          label:
            runtime.catalog.find((entry) => entry.views?.[target])?.views?.[
              target
            ] ?? "",
        });
      else openManager(action === "diagnostics", target);
    };
    runtime.events.addEventListener("shell", open);
    return () => runtime.events.removeEventListener("shell", open);
  }, [runtime]);
  const from = managerFrom.current.at(-1);
  return {
    manager: {
      ...manager,
      backLabel: from ? `返回${stepLabel(from)}` : "返回工作区",
    },
    dialog: steps.at(-1) ?? null,
    setDialog,
    /** Returns to the dialog this one was opened from, when there is one. */
    back:
      steps.length > 1
        ? () => setSteps((previous) => previous.slice(0, -1))
        : undefined,
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
