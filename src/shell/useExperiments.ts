import { useState } from "react";
import type { Runtime } from "./runtime";
import type { Workspace } from "./useWorkspace";
export function useExperiments(
  runtime: Runtime,
  workspace: Workspace,
  closeManager: () => void,
) {
  const { host } = runtime;
  const [started, setStarted] = useState(false);
  async function start() {
    await host.grant("workbench", ["state.read", "state.write"]);
    await host.start("workbench");
    const defaultView = host.views().find((view) => view.id === "default");
    if (defaultView && workspace.failedViews.default === defaultView.generation)
      await host.stop("ui.default");
    await host.start("ui.default");
    await host.start("ui.board");
    if (host.inspect("transform.reverse").status !== "active")
      await host.start("transform.upper");
    setStarted(true);
    workspace.setSelected(
      runtime.layout === "agents" ? "default" : runtime.layout,
    );
    closeManager();
  }
  return {
    started,
    start,
    writeDenied: host.inspect("workbench").status === "waiting" && started,
  };
}
export type Experiments = ReturnType<typeof useExperiments>;
