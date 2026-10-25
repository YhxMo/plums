import { agentExtension } from "@modules/agents/provider";
import { textWorkbench } from "@modules/text-workbench/extension";
import { agentUI } from "./agents/extension";
import { memoryExtensionWithPage } from "./agents/memory/extension";
import { modelConnectorWithPage } from "./models/extension";
import { bootShell, type ShellApplication } from "./shell/runtime";

/** Development and tests also get the text workbench, the upper-case service and the echo model. */
const development = import.meta.env.DEV;

/** Default application composition; the shell does not interpret business state. */
export const defaultApplication: ShellApplication = {
  catalog: [
    { id: "agents.local", url: "内置公开服务", label: "Agent 核心" },
    {
      id: "memory.local",
      url: "内置记忆",
      label: "记忆",
      views: { memory: "记忆" },
    },
    {
      id: "connector.models",
      url: "内置模型连接器",
      label: "模型连接",
      views: { "model-connections": "模型连接" },
    },
    {
      id: "ui.agents",
      url: "内置可替换界面",
      label: "默认 Agent 界面",
      views: { agents: "Agent 界面" },
    },
    ...(development
      ? [
          {
            id: "ui.workbench-board",
            url: "内置公开契约样板",
            label: "文本处理工作台",
            views: { "text-workbench": "文本处理工作台" },
          },
        ]
      : []),
  ],
  restore(state) {
    return {
      ...state,
      // Only the unmarked early-preview layout adopts the Agent start.
      layout:
        state.layout === "default" &&
        state.layoutIntent !== "explicit" &&
        !state.composition
          ? "agents"
          : state.layout.trim()
            ? state.layout
            : "agents",
    };
  },
  extensions: (state, save) => [
    ...(development ? [textWorkbench] : []),
    // Agents moved from the shell snapshot to agents.local's own state.
    agentExtension({
      legacy: state.agents,
      retireLegacy: () => save({ agents: undefined }),
    }),
    memoryExtensionWithPage(),
    agentUI(),
    modelConnectorWithPage(),
  ],
  grants: {
    "agents.local": ["state.read", "state.batch", "records.list"],
    "memory.local": ["state.read", "state.batch", "records.list"],
    "connector.models": [
      "state.read",
      "state.write",
      "credential.request",
      "credential.connect",
      "network.read",
    ],
    "ui.agents": ["link.open"],
  },
  start: [
    // Development Agents answer with the local echo model; the upper-case
    // service feeds the text workbench.
    ...(development ? ["transform.upper", "chat.echo"] : []),
    "connector.models",
    "memory.local",
    "agents.local",
    "ui.agents",
  ],
};

export const boot = () => bootShell(defaultApplication);
