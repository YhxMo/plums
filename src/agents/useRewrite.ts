import { useRef, useState } from "react";
import type { Agent, AgentProvider, Message } from "@modules/agents/contract";
import type { AgentModals } from "./useAgentModals";
import type { Editing } from "./Composer";
import { summary } from "./summary";

/** Messages a rewrite from `index` drops besides the one reply it replaces. */
function later(messages: readonly Message[], index: number) {
  const replaced = messages[index + 1]?.role === "agent" ? 1 : 0;
  return messages.length - index - 1 - replaced;
}

type Edit = {
  key: string;
  agentId: string;
  sessionId: string;
  message: Message;
  /** The message box's text from before, given back on leaving. */
  draft: string;
};

/**
 * Editing an own message in the message box, and regenerating a reply.
 * Either one asks first when later turns would go, and offers 撤销 after.
 */
export function useRewrite({
  api,
  modals,
  drafts,
  setDrafts,
  offerUndo,
}: {
  api: AgentProvider;
  modals: Pick<AgentModals, "open" | "report">;
  drafts: Record<string, string>;
  setDrafts: (
    update: (d: Record<string, string>) => Record<string, string>,
  ) => void;
  offerUndo: (agentId: string, notice: string) => void;
}) {
  const [edit, setEdit] = useState<Edit | null>(null);
  const draftsNow = useRef(drafts);
  draftsNow.current = drafts;
  const restore = (from: Edit) =>
    setDrafts((d) => ({ ...d, [from.key]: from.draft }));
  /** Runs `ask` after confirming any loss; `done` names the undoable result. */
  function rewrite(
    agent: Agent,
    index: number,
    ask: () => Promise<void>,
    done: string,
    onFail?: () => void,
  ) {
    const session = agent.sessions.find(
      (s) => s.id === agent.currentSessionId,
    )!;
    const run = () =>
      void modals.report(async () => {
        try {
          await ask();
        } catch (error) {
          onFail?.();
          throw error;
        }
        offerUndo(agent.id, done);
      });
    const count = later(session.messages, index);
    if (count > 0) modals.open({ action: "truncate", agent, count, run });
    else run();
  }
  return {
    editing(key: string): Editing | undefined {
      if (edit?.key !== key) return undefined;
      return {
        original: summary(edit.message),
        hasFiles: !!edit.message.attachments?.length,
        onCancel: () => {
          restore(edit);
          setEdit(null);
        },
      };
    },
    start: api.edit
      ? (agent: Agent, key: string, message: Message) => {
          setEdit({
            key,
            agentId: agent.id,
            sessionId: agent.currentSessionId,
            message,
            // Editing another message keeps the draft from before the first.
            draft: edit?.key === key ? edit.draft : (drafts[key] ?? ""),
          });
          setDrafts((d) => ({ ...d, [key]: message.text }));
        }
      : undefined,
    /** Sends the edit open in `key`'s message box; false when none is. */
    send(agent: Agent, key: string) {
      if (edit?.key !== key) return false;
      const current = edit;
      const text = drafts[key] ?? "";
      const session = agent.sessions.find((s) => s.id === current.sessionId);
      const index =
        session?.messages.findIndex((m) => m.id === current.message.id) ?? -1;
      rewrite(
        agent,
        index,
        async () => {
          restore(current);
          setEdit(null);
          await api.edit!(
            current.agentId,
            current.sessionId,
            current.message.id,
            text,
          );
        },
        "已按修改重新发送",
        // The edit comes back to the box, keeping what was typed since.
        () => {
          setEdit({ ...current, draft: draftsNow.current[key] ?? "" });
          setDrafts((d) => ({ ...d, [key]: text }));
        },
      );
      return true;
    },
    regenerate: api.regenerate
      ? (agent: Agent, message: Message) => {
          const session = agent.sessions.find(
            (s) => s.id === agent.currentSessionId,
          )!;
          rewrite(
            agent,
            session.messages.findIndex((m) => m.id === message.id) - 1,
            () => api.regenerate!(agent.id, agent.currentSessionId, message.id),
            "已重新生成",
          );
        }
      : undefined,
  };
}
