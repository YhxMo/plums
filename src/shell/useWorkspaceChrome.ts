import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import type { Workspace } from "./useWorkspace";
import { createChromeStore } from "./workspace-chrome-store";

export function useWorkspaceChrome(workspace: Workspace) {
  const { current, failView } = workspace;
  const chrome = current?.chrome;
  const id = current?.id;
  const generation = current?.generation;
  const fail = useCallback(
    (reason: unknown) => {
      if (id !== undefined && generation !== undefined)
        failView(id, generation, reason);
    },
    [id, generation, failView],
  );
  const invoke = useCallback(
    (action: () => void) => {
      try {
        action();
      } catch (reason) {
        fail(reason);
      }
    },
    [fail],
  );
  const store = useMemo(() => createChromeStore(chrome, fail), [chrome, fail]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const { state } = snapshot;
  useEffect(() => {
    if (snapshot.failure) fail(snapshot.failure.reason);
  }, [snapshot, fail]);
  const [customOpen, setCustomOpen] = useState(false);
  const sidebars = workspace.allViews
    .filter((view) => view.presentation === "sidebar")
    .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  // A workspace with its own details keeps the sidebar button for them.
  const custom = state.sidebar
    ? undefined
    : (sidebars.find((view) => view.owner === state.contextOwner) ??
      sidebars.find((view) => view.owner === workspace.current?.owner));
  useEffect(() => {
    setCustomOpen(false);
  }, [workspace.activeView, custom?.id, custom?.generation]);
  return {
    title: state.title ?? "",
    frame: state.frame === "own" ? ("own" as const) : undefined,
    back: state.back ? () => invoke(() => state.back!()) : undefined,
    drop: state.drop && {
      label: state.drop.label,
      add:
        state.drop.add &&
        ((files: readonly File[]) => invoke(() => state.drop!.add!(files))),
    },
    custom,
    open: custom ? customOpen : (state.sidebar?.open ?? false),
    label: custom?.label ?? state.sidebar?.label,
    toggle(source: HTMLElement) {
      if (custom) setCustomOpen((open) => !open);
      else invoke(() => state.sidebar?.toggle(source));
    },
    closeCustom() {
      setCustomOpen(false);
    },
  };
}

export type WorkspaceChrome = ReturnType<typeof useWorkspaceChrome>;
