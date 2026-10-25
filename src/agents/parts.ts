import type { Named } from "@modules/sdk";
import type {
  AgentModel,
  AgentProvider,
  ExtensionChoice,
} from "@modules/agents/contract";

/** One extension an Agent is composed of. */
export type Part = {
  choice: ExtensionChoice;
  on: boolean;
  /** What switching it off means for this Agent, shown while it is off. */
  note?: string;
  /** Set for a `chat@1` connector, whose switch also picks the model. */
  connector?: true;
  /** Opens the part's own page in place of extension management. */
  open?: () => void;
};
/** A `memory@1` provider as an Agent's part: how much it remembers, and its page. */
export type MemoryPart = { choice: Named; count?: number; open?: () => void };

/**
 * The provider, the interface showing the Agent, its memories and each model
 * connection, all on unless named in `off`; a connection is on when the
 * model is its own.
 */
export function agentParts({
  provider,
  ui,
  api,
  model,
  memories = [],
  off = [],
}: {
  provider: readonly Named[];
  ui?: Named;
  memories?: readonly MemoryPart[];
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
      choice: { ...p, description: "记住角色设定和聊天记录" },
      on: !off.includes(p.id),
      note: "已关闭：它不会回复",
    })),
    ...(ui && !provider.some((p) => p.id === ui.id)
      ? [
          {
            choice: { ...ui, description: "在这里和它对话" },
            on: !off.includes(ui.id),
            note: "已关闭：不能在这里和它对话",
          },
        ]
      : []),
    ...memories.map(({ choice, count, open }) => ({
      choice: {
        ...choice,
        description:
          count === undefined
            ? "记住你说过的事"
            : count
              ? `记得 ${count} 件事`
              : "还没有记下什么",
      },
      on: !off.includes(choice.id),
      note: "已关闭：它不会记得以前会话里的事",
      ...(open && { open }),
    })),
    ...(api.connectors?.() ?? []).map((c) => {
      const own = model?.provider === c.id;
      return {
        choice: {
          ...c,
          description: own
            ? `使用 ${picked?.label ?? model.model}`
            : "提供理解和回复用的 AI 模型",
        },
        on: own && !off.includes(c.id),
        note: own ? "已关闭：它不会回复" : undefined,
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
