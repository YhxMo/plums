import { agentExtension } from "../modules/agents/provider";
import { textWorkbench } from "../modules/text-workbench/extension";
import { agentUI } from "./agents/extension";
import { bootShell, type ShellApplication } from "./shell/runtime";

/** Development and tests also get the text workbench and the upper-case service. */
const development = import.meta.env.DEV;

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
    agentUI(),
  ],
  grants: { "agents.local": ["state.read", "state.write"] },
  start: [
    ...(development ? ["transform.upper"] : []),
    "agents.local",
    "ui.agents",
  ],
};

export const boot = () => bootShell(defaultApplication);
