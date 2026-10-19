import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import {
  createWorkspaceChrome,
  type ExtensionDefinition,
} from "../../modules/sdk";
import type { AgentProvider } from "../../modules/agents/contract";
import { RoleCardSettings } from "./RoleCardSettings";
import { AgentWorkspace } from "./AgentWorkspace";

function mountReactView(
  container: HTMLElement,
  content: ReactNode,
  fillHeight = false,
) {
  // Each mount owns its node, so a pending release cannot clear a replacement.
  const element = document.createElement("div");
  if (fillHeight) element.style.height = "100%";
  container.append(element);
  const root = createRoot(element);
  root.render(content);
  return async () => {
    element.remove();
    // A shell effect may be cleaning up during React's commit.
    await Promise.resolve();
    root.unmount();
  };
}

export function agentUI(): ExtensionDefinition {
  return {
    manifest: {
      id: "ui.agents",
      version: "0.0.4",
      apiVersion: 1,
      requires: { agents: 1 },
    },
    activate(ctx) {
      const agents = ctx.use<AgentProvider>("agents");
      const chrome = createWorkspaceChrome("agents.agent");
      ctx.view({
        id: "role-settings",
        label: "角色卡设置",
        presentation: "dialog",
        mount(container) {
          return mountReactView(container, <RoleCardSettings api={agents} />);
        },
      });
      ctx.view({
        id: "agents",
        label: "Agent 界面",
        priority: 100,
        chrome,
        mount(container) {
          return mountReactView(
            container,
            <AgentWorkspace
              api={agents}
              chrome={chrome}
              onExtensions={(id) => {
                void (id
                  ? ctx.shell.open("extensions", id)
                  : ctx.shell.open("extensions"));
              }}
              onModels={() => void ctx.shell.open("view", "model-connections")}
            />,
            true,
          );
        },
      });
    },
  };
}
