import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import {
  createWorkspaceChrome,
  type ExtensionDefinition,
  type FileSaveResult,
} from "@modules/sdk";
import type { AgentProvider } from "@modules/agents/contract";
import type { MemoryService } from "@modules/agents/memory/contract";
import { AgentWorkspace } from "./AgentWorkspace";
import type { Memories } from "./useMemories";

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

/** A speech bubble with three dots cut out, for the shell's rail. */
const icon =
  '<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="M12 3.5c5 0 9 3.4 9 7.6s-4 7.6-9 7.6c-1 0-2-.13-2.9-.38L4.6 20.4l1.3-3.6C4.1 15.4 3 13.4 3 11.1 3 6.9 7 3.5 12 3.5ZM7.35 11.1a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0-2.3 0ZM10.85 11.1a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0-2.3 0ZM14.35 11.1a1.15 1.15 0 1 0 2.3 0a1.15 1.15 0 1 0-2.3 0Z"/></svg>';

export function agentUI(): ExtensionDefinition {
  return {
    manifest: {
      id: "ui.agents",
      version: "0.0.4",
      apiVersion: 1,
      description:
        "提供 Agent 列表、对话和详情界面，支持切换会话、选择模型与发送附件。",
      requires: { agents: 1 },
      // Shows what each Agent remembers and opens its memory page.
      optional: { memory: 1 },
      capabilities: ["link.open", "file.save"],
    },
    activate(ctx) {
      const agents = ctx.use<AgentProvider>("agents");
      const listeners = new Set<() => void>();
      let found = ctx.providers<MemoryService>("memory", (next) => {
        found = next;
        listeners.forEach((listener) => listener());
      });
      const memories: Memories = {
        list: () => found,
        subscribe(listener) {
          listeners.add(listener);
          return () => void listeners.delete(listener);
        },
      };
      const chrome = createWorkspaceChrome("agents.agent");
      // This interface first, then the provider it is built on.
      const [ui] = ctx.shell.dependencies();
      ctx.view({
        id: "agents",
        label: "Agent 界面",
        icon,
        priority: 100,
        chrome,
        mount(container) {
          return mountReactView(
            container,
            <AgentWorkspace
              api={agents}
              chrome={chrome}
              ui={ui}
              memories={memories}
              onExtensions={(id) => {
                void (id
                  ? ctx.shell.open("extensions", id)
                  : ctx.shell.open("extensions"));
              }}
              onModels={() => void ctx.shell.open("view", "model-connections")}
              onOpenLink={(url) =>
                ctx.platform("link.open", { version: 1, url })
              }
              onSaveFile={(name, data) =>
                ctx.platform("file.save", {
                  version: 1,
                  name,
                  data,
                }) as Promise<FileSaveResult>
              }
            />,
            true,
          );
        },
      });
    },
  };
}
