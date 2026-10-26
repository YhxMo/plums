import { LIMITS, attachmentProblem, imageSize } from "./attachments";
import { MAX_TEXT } from "./validation";
import { OWNER, type Attachment, type Message, type Session } from "./contract";

/**
 * How messages enter a session, apart from who produces them: the store
 * decides when, these rules decide what is written.
 */

/** A new session's title, until its first message names it. */
export const UNTITLED = "未命名会话";
export const newSession = (): Session => ({
  id: crypto.randomUUID(),
  title: UNTITLED,
  createdAt: Date.now(),
  lastMessageAt: Date.now(),
  messages: [],
});

/** Marks a session read up to `at`, and every message in it, even one stamped ahead of this clock. */
export const readAll = (s: Session, at = Date.now()) => {
  s.lastReadAt = Math.max(at, ...s.messages.map((m) => m.at ?? 0));
};

/** The files a message carries, or throws why it cannot be sent. */
export function checkMessage(input: string, attachments?: Attachment[]) {
  const problem = attachmentProblem(attachments);
  if (problem) throw new Error(problem);
  const files = attachments?.length ? attachments : undefined;
  // Files may go out alone; a message needs text or files.
  if ((!files && !input.trim()) || input.length > MAX_TEXT)
    throw new Error(`请输入 1–${MAX_TEXT} 个字符，或添加附件。`);
  const filesText = (files ?? []).reduce(
    (sum, a) => sum + (a.kind === "text" ? a.text.length : 0),
    0,
  );
  if (input.length + filesText > MAX_TEXT)
    throw new Error("文字与文件合计过长，请减少文件或缩短文字。");
  return files;
}

/** Throws when `files` would take the session's pictures past their limit. */
export function checkImages(
  saved: readonly Pick<Message, "attachments">[],
  files?: Attachment[],
) {
  if (
    imageSize(saved) + imageSize([{ attachments: files }]) >
    LIMITS.sessionImages
  )
    throw new Error("此会话的图片已达上限，请新建会话或删除带图片的消息。");
}

/**
 * Writes the person's message and the Agent's reply at the end of `s`.
 * Sending reads what came before; the reply sorts after all of it, also
 * within the same millisecond. `read` marks the reply read as well.
 */
export function recordExchange(
  s: Session,
  {
    agentId,
    input,
    files,
    output,
    sentAt,
    read,
  }: {
    agentId: string;
    input: string;
    files?: Attachment[];
    output: string;
    sentAt: number;
    read: boolean;
  },
) {
  readAll(s, sentAt);
  const repliedAt = Math.max(Date.now(), s.lastReadAt! + 1);
  s.messages.push(
    {
      id: crypto.randomUUID(),
      role: "user",
      from: OWNER,
      text: input,
      ...(files && { attachments: files }),
      at: sentAt,
    },
    {
      id: crypto.randomUUID(),
      role: "agent",
      from: agentId,
      text: output,
      at: repliedAt,
    },
  );
  s.lastMessageAt = repliedAt;
  if (read) s.lastReadAt = repliedAt;
  // The first message names the session, unless it was named already.
  if (s.messages.length === 2 && s.title === UNTITLED)
    s.title = (input.trim() ? input : files![0].name).slice(0, 24);
}
