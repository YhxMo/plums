import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createViewSlot } from "@modules/shell/view-slot";
import type { Runtime } from "./runtime";
import type { ShellOperations } from "./useOperations";
import { errorMessage } from "./messages";
import { selectionAfterFailure } from "./selection";

export function useWorkspace(
  runtime: Runtime,
  operations: ShellOperations,
  visible = true,
) {
  const { host } = runtime;
  const { setError } = operations;
  const [selected, setSelected] = useState(runtime.initial.layout);
  const [failedViews, setFailedViews] = useState<Record<string, number>>({});
  const slot = useRef<HTMLDivElement>(null);
  const [outlet] = useState(() => createViewSlot(host));
  const recovering = useRef<string | null>(null);
  const lastWorking = useRef<string | undefined>(undefined);
  const allViews = host.views();
  const views = allViews.filter(
    (view) =>
      view.presentation === "workspace" &&
      failedViews[view.id] !== view.generation,
  );
  const current =
    views.find((view) => view.id === selected) ??
    [...views].sort(
      (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
    )[0];
  const activeView = current?.id;
  const generation = current?.generation;
  const visibility = current?.chrome?.visibility;
  const failView = useCallback(
    (id: string, failedGeneration: number, reason: unknown) => {
      if (
        !host
          .views()
          .some(
            (view) => view.id === id && view.generation === failedGeneration,
          )
      )
        return;
      recovering.current = errorMessage(reason);
      setError(
        `布局不可用；将使用可用布局或宿主恢复入口：${errorMessage(reason)}`,
      );
      setFailedViews((previous) => ({ ...previous, [id]: failedGeneration }));
      setSelected((previous) =>
        selectionAfterFailure(previous, id, lastWorking.current),
      );
    },
    [host, setError],
  );
  useLayoutEffect(() => {
    if (!visibility || !activeView) return;
    const publish = (visible: boolean) => {
      try {
        visibility.set(visible);
      } catch (reason) {
        failView(activeView, generation!, reason);
      }
    };
    publish(visible);
    return () => publish(false);
  }, [visibility, visible, activeView, generation, failView]);
  useEffect(() => {
    const root = slot.current;
    if (!root || !activeView) return;
    let active = true;
    const container = document.createElement("div");
    root.replaceChildren(container);
    void outlet
      .show(activeView, container)
      .then(() => {
        if (active) lastWorking.current = activeView;
        if (active && recovering.current) {
          setError(`布局不可用，已恢复可用界面：${recovering.current}`);
          recovering.current = null;
        }
      })
      .catch((reason) => {
        if (!active) return;
        container.remove();
        failView(activeView, generation!, reason);
      });
    return () => {
      active = false;
      void outlet.clear().catch((reason) => setError(errorMessage(reason)));
    };
  }, [activeView, generation, outlet, setError, failView]);
  async function selectLayout(layout: string) {
    if (activeView) await host.leaveView(activeView);
    await runtime.save({ layout });
    setSelected(layout);
  }
  async function enableExtension(id: string) {
    await host.start(id);
    const contributed = host
      .views()
      .find((view) => view.owner === id && view.presentation === "workspace");
    if (contributed) {
      await runtime.save({ layout: contributed.id });
      setSelected(contributed.id);
    }
  }
  return {
    selected,
    setSelected,
    failedViews,
    slot,
    current,
    activeView,
    views,
    allViews,
    selectLayout,
    enableExtension,
    failView,
  };
}

export type Workspace = ReturnType<typeof useWorkspace>;
