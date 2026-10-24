import { ContractError } from "@modules/sdk/errors";
import { isRecordName } from "@modules/sdk";
import { attachmentProblem } from "./attachments";
import type { Agent, AgentConfig, Session } from "./contract";

export const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
export const text = (value: unknown, max = 4000): value is string =>
  typeof value === "string" && value.length <= max;
export const EFFORTS: readonly string[] = [
  "off",
  "low",
  "medium",
  "high",
  "max",
];
/** Extension IDs, as in `Agent.off`. */
export const extensionIds = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((e) => text(e, 64));
/** Largest avatar kept, as a data URL: it lives in its own state document. */
export const MAX_AVATAR = 40_000;
const AVATAR = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
export const validAvatar = (value: unknown): value is string =>
  typeof value === "string" && value.length <= MAX_AVATAR && AVATAR.test(value);
export const AVATAR_PROBLEM =
  "头像须是不超过 40 KB 的 PNG、JPEG 或 WebP 图片。";
export function parseRoleCard(raw: string): AgentConfig {
  const value: unknown = JSON.parse(raw);
  if (
    !object(value) ||
    !text(value.name, 60) ||
    !value.name.trim() ||
    (value.version !== undefined && value.version !== 1) ||
    (value.description !== undefined && !text(value.description))
  )
    throw new Error(
      "角色卡格式不支持：需要 name，可选 description、avatar 和 version: 1。",
    );
  if (value.avatar !== undefined && !validAvatar(value.avatar))
    throw new Error(`角色卡的${AVATAR_PROBLEM}`);
  return {
    name: value.name.trim(),
    description: value.description as string | undefined,
    ...(value.avatar !== undefined && { avatar: value.avatar as string }),
  };
}
/** Longest `chat@1` model id an Agent keeps; longer ones are not offered. */
export const MAX_MODEL_ID = 256;
/** Longest message, sent or received: room for a document in a 1M-token context. */
export const MAX_TEXT = 1_000_000;
/** Stored Agents that cannot be read; the data is kept as it is. */
export const corrupt = () =>
  new ContractError("state.corrupt", "agents", "Agent 配置损坏");
export function restoreAgents(value: unknown): Agent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw corrupt();
  const ids = new Set<string>();
  for (const a of value) {
    if (
      !object(a) ||
      !text(a.id) ||
      ids.has(a.id) ||
      !text(a.name, 60) ||
      !a.name.trim() ||
      !text(a.description) ||
      typeof a.pinned !== "boolean" ||
      !text(a.extensionId) ||
      (a.off !== undefined && !extensionIds(a.off)) ||
      (a.effort !== undefined && !EFFORTS.includes(a.effort as string)) ||
      (a.model !== undefined &&
        (!object(a.model) ||
          !text(a.model.provider, 64) ||
          !text(a.model.model, MAX_MODEL_ID))) ||
      !Array.isArray(a.sessions) ||
      a.sessions.length === 0 ||
      !text(a.currentSessionId)
    )
      throw corrupt();
    ids.add(a.id);
    const sessions = new Set<string>();
    for (const s of a.sessions) {
      if (
        !object(s) ||
        !text(s.id) ||
        sessions.has(s.id) ||
        !text(s.title) ||
        !Number.isFinite(s.createdAt) ||
        !Number.isFinite(s.lastMessageAt) ||
        (s.lastReadAt !== undefined && !Number.isFinite(s.lastReadAt)) ||
        !Array.isArray(s.messages) ||
        !s.messages.every(
          (m) =>
            object(m) &&
            text(m.id) &&
            (m.role === "user" || m.role === "agent") &&
            text(m.text, MAX_TEXT) &&
            attachmentProblem(m.attachments) === undefined &&
            (m.at === undefined || Number.isFinite(m.at)),
        )
      )
        throw new ContractError(
          "state.corrupt",
          "agents.sessions",
          "会话配置损坏",
        );
      sessions.add(s.id);
    }
    if (!sessions.has(a.currentSessionId))
      throw new ContractError(
        "state.corrupt",
        "agents.currentSessionId",
        "当前会话不存在",
      );
  }
  // Older versions also saved text extensions, fixed capabilities and a
  // single-session flag; none of them is used any more.
  return structuredClone(value).map(
    ({
      canCancel,
      pending,
      extensions,
      capabilities,
      multiSession,
      avatar,
      ...a
    }) => ({
      ...renameForRecords(a),
      // A damaged picture only costs the picture.
      ...(validAvatar(avatar) && { avatar }),
      status: "idle",
    }),
  );
}

/**
 * Gives ids that cannot name a stored record (`isRecordName`), and message
 * ids repeated in a session, new ones. Ids have always been UUIDs, so only
 * hand-made or damaged data changes; nothing outside an Agent keeps them.
 */
function renameForRecords<
  A extends { id: string; currentSessionId: string; sessions: Session[] },
>(agent: A): A {
  const fresh = (valid: boolean, id: string) =>
    valid ? id : crypto.randomUUID();
  let { currentSessionId } = agent;
  const sessions = agent.sessions.map((session) => {
    const id = fresh(isRecordName(`session:${session.id}`), session.id);
    if (session.id === agent.currentSessionId) currentSessionId = id;
    const seen = new Set<string>();
    const messages = session.messages.map((message) => {
      const renamed = fresh(
        isRecordName(message.id) && !seen.has(message.id),
        message.id,
      );
      seen.add(renamed);
      return renamed === message.id ? message : { ...message, id: renamed };
    });
    return { ...session, id, messages };
  });
  return {
    ...agent,
    id: fresh(isRecordName(agent.id), agent.id),
    currentSessionId,
    sessions,
  };
}
