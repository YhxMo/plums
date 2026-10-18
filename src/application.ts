import { agentExtension } from "../modules/agents/provider";
import { restoreAgents } from "../modules/agents/store";
import { textWorkbench } from "../modules/text-workbench/extension";
import { agentUI } from "./agent-ui";
import { bootShell, type ShellApplication } from "./shell/runtime";

/** Default application composition; the shell does not interpret business state. */
export const defaultApplication: ShellApplication = {
  catalog: [
    { id: "agents.local", url: "内置公开服务", label: "本地 Agent 提供者" },
    {
      id: "ui.agents",
      url: "内置可替换界面",
      label: "默认 Agent 界面",
      views: { agents: "Agent 界面" },
    },
    {
      id: "ui.workbench-board",
      url: "内置公开契约样板",
      label: "文本处理工作台",
      views: { "text-workbench": "文本处理工作台" },
    },
  ],
  restore(state) {
    return {
      ...state,
      agents: restoreAgents(state.agents),
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
    textWorkbench,
    agentExtension(restoreAgents(state.agents), (agents, options) =>
      save({ agents }, options),
    ),
    agentUI(),
  ],
  start: ["transform.upper", "agents.local", "ui.agents"],
};

export const boot = () => bootShell(defaultApplication);
