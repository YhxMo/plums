import { createRoot } from "react-dom/client";
import type { ExtensionDefinition } from "../modules/sdk";
import { withAgents } from "../modules/sdk/agents";
import { RoleCardSettings } from "./components/RoleCardSettings";
import { AgentWorkspace } from "./components/AgentWorkspace";

export function agentUI(onExtensions: () => void): ExtensionDefinition {
  return {
    manifest: {
      id: "ui.agents",
      version: "0.0.4",
      apiVersion: 1,
      requires: { agents: 1 },
    },
    activate(context) {
      const ctx = withAgents(context);
      ctx.view({
        id: "role-settings",
        label: "角色卡设置",
        mount(container) {
          const root = createRoot(container);
          root.render(<RoleCardSettings api={ctx.agents} />);
          return () => root.unmount();
        },
      });
      ctx.view({
        id: "agents",
        label: "Agent 界面",
        mount(container) {
          const root = createRoot(container);
          root.render(
            <AgentWorkspace api={ctx.agents} onExtensions={onExtensions} />,
          );
          return () => root.unmount();
        },
      });
    },
  };
}
