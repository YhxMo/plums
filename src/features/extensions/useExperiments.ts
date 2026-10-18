import { useState } from "react";
import type { Runtime } from "../../shell/runtime";
import type { Workspace } from "../../shell/useWorkspace";
export function useExperiments(
  runtime: Runtime,
  workspace: Workspace,
  closeManager: () => void,
) {
  const { host } = runtime;
  const owners = [
    "workbench",
    "transform.upper",
    "transform.reverse",
    "ui.default",
    "ui.board",
  ];
  const available = owners.every((id) => host.ids().includes(id));
  const [started, setStarted] = useState(false);
  async function start() {
    if (!available) throw Error("当前组合未安装文本工作台实验");
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
      runtime.initial.layout === "agents" ? "default" : runtime.initial.layout,
    );
    closeManager();
  }
  return {
    available,
    authorizationOwners: ["workbench"],
    started,
    start,
    writeDenied:
      available && host.inspect("workbench").status === "waiting" && started,
  };
}
export type Experiments = ReturnType<typeof useExperiments>;
