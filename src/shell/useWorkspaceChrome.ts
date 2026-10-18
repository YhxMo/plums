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
  const custom =
    sidebars.find((view) => view.owner === state.contextOwner) ??
    sidebars.find((view) => view.owner === workspace.current?.owner);
  useEffect(() => {
    setCustomOpen(false);
  }, [workspace.activeView, custom?.id, custom?.generation]);
  useEffect(() => {
    if (
      custom &&
      state.sidebar?.open &&
      state.sidebar.presentation !== "dialog"
    )
      invoke(() => state.sidebar!.close());
  }, [custom?.id, custom?.generation, state.sidebar, invoke]);
  return {
    title: state.title ?? "",
    back: state.back ? () => invoke(() => state.back!()) : undefined,
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
    navigation: chrome?.navigation
      ? {
          entityType: chrome.navigation.entityType,
          reveal(id: string) {
            invoke(() => chrome.navigation!.reveal(id));
          },
        }
      : undefined,
  };
}

export type WorkspaceChrome = ReturnType<typeof useWorkspaceChrome>;
