import type { Session } from "./contract";

/** Replies in a session newer than its `lastReadAt`; none without one. */
export const unreadReplies = (session: Session) =>
  session.lastReadAt === undefined
    ? 0
    : session.messages.filter(
        (m) =>
          m.role === "agent" &&
          m.at !== undefined &&
          m.at > session.lastReadAt!,
      ).length;
