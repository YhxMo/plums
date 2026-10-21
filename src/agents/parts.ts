import type { Named } from "../../modules/sdk";
import type {
  AgentModel,
  AgentProvider,
  ExtensionChoice,
} from "../../modules/agents/contract";

/** One extension an Agent is assembled from besides its text extensions. */
export type Part = {
  choice: ExtensionChoice;
  on: boolean;
  /** What switching it off means for this Agent, shown while it is off. */
  note?: string;
  /** Set for a `chat@1` connector, whose switch also picks the model. */
  connector?: true;
};

/**
 * The provider, the interface showing the Agent and each model connection,
 * all on unless named in `off`; a connection is on when the model is its own.
 */
export function agentParts({
  provider,
  ui,
  api,
  model,
  off = [],
}: {
  provider: readonly Named[];
  ui?: Named;
  api: Pick<AgentProvider, "connectors" | "modelChoices">;
  model?: AgentModel | null;
  off?: readonly string[];
}): Part[] {
  const models = api.modelChoices?.() ?? [];
  const picked = model
    ? models.find((m) => m.provider === model.provider && m.id === model.model)
    : undefined;
  return [
    ...provider.map((p) => ({
      choice: { ...p, description: "保存角色与会话，把消息交给模型和文本扩展" },
      on: !off.includes(p.id),
      note: "已关闭：此 Agent 不会回复",
    })),
    ...(ui && !provider.some((p) => p.id === ui.id)
      ? [
          {
            choice: { ...ui, description: "显示此 Agent，并在这里与它对话" },
            on: !off.includes(ui.id),
            note: "已关闭：不能在此界面与它对话",
          },
        ]
      : []),
    ...(api.connectors?.() ?? []).map((c) => {
      const own = model?.provider === c.id;
      return {
        choice: {
          ...c,
          description: own
            ? `使用 ${picked?.label ?? model.model}`
            : "为此 Agent 提供模型",
        },
        on: own && !off.includes(c.id),
        note: own ? "已关闭：回复不经过模型" : undefined,
        connector: true as const,
      };
    }),
  ];
}

/**
 * What switching `part` on or off changes: a connection switched on takes
 * its first model unless the Agent already uses one of its own.
 */
export function switchPart(
  part: Part,
  on: boolean,
  api: Pick<AgentProvider, "modelChoices">,
  model?: AgentModel | null,
): { off: boolean; model?: AgentModel } {
  if (!on || !part.connector || model?.provider === part.choice.id)
    return { off: !on };
  const first = api.modelChoices?.().find((m) => m.provider === part.choice.id);
  if (!first)
    throw new Error(
      `「${part.choice.label}」还没有可用的模型，请先在模型连接中添加。`,
    );
  return { off: false, model: { provider: first.provider, model: first.id } };
}
