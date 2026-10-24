import type { Agent, Message, Session } from "./contract";

/** What one removal took away, kept in memory so it can be put back. */
export type Removal =
  | {
      kind: "messages";
      sessionId: string;
      /** The session's messages before the removal. */
      before: Message[];
      /** Message ids right after it; undo applies only while they stay so. */
      after: string[];
    }
  | {
      kind: "session";
      session: Session;
      index: number;
      current: boolean;
      /** The empty session added when the last one went. */
      placeholder?: string;
    };

const ids = (messages: Message[]) => messages.map((m) => m.id).join();

/** Restores `removal` in a draft Agent, or explains why it no longer can. */
export function putBack(a: Agent, removal: Removal) {
  if (removal.kind === "messages") {
    const s = a.sessions.find((s) => s.id === removal.sessionId);
    if (!s || ids(s.messages) !== removal.after.join())
      throw new Error("会话已有新的变化，无法撤销删除。");
    s.messages = removal.before;
    return;
  }
  const { session, placeholder } = removal;
  if (a.sessions.some((s) => s.id === session.id))
    throw new Error("会话已恢复。");
  // An untouched placeholder gives way; one the user wrote in stays.
  a.sessions = a.sessions.filter(
    (s) => s.id !== placeholder || s.messages.length,
  );
  a.sessions.splice(Math.min(removal.index, a.sessions.length), 0, session);
  if (removal.current || !a.sessions.some((s) => s.id === a.currentSessionId))
    a.currentSessionId = session.id;
}
