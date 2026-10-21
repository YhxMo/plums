import type { ChatImage, ChatTurn } from "../../extensions/contracts";
import type { Attachment } from "./contract";

/** What one message may carry; pictures are scaled before they get here. */
export const LIMITS = {
  /** Attachments of both kinds per message. */
  files: 5,
  images: 4,
  /** Characters of one text file. */
  text: 200_000,
  /** Base64 characters of one picture (about 300 KB). */
  image: 400_000,
  /** Base64 characters of all pictures in one session. */
  sessionImages: 8_000_000,
} as const;
/** Pictures that keep being sent with the history; older ones become text. */
const RECENT_IMAGES = 3;

const base64 = /^[A-Za-z0-9+/]+={0,2}$/;
const mimes: readonly unknown[] = ["image/jpeg", "image/png", "image/webp"];

/** Plain-language problem with a message's attachments, or undefined when fine. */
export function attachmentProblem(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const bad = "附件格式无效。";
  if (!Array.isArray(value)) return bad;
  if (value.length > LIMITS.files)
    return `一条消息最多 ${LIMITS.files} 个附件。`;
  let images = 0;
  for (const item of value as unknown[]) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Attachment).name !== "string" ||
      !(item as Attachment).name ||
      (item as Attachment).name.length > 120
    )
      return bad;
    const a = item as Attachment;
    if (a.kind === "text") {
      if (typeof a.text !== "string") return bad;
      if (a.text.length > LIMITS.text)
        return `文件「${a.name}」超过 ${LIMITS.text / 1000}K 个字符。`;
    } else if (a.kind === "image") {
      if (
        !mimes.includes(a.mime) ||
        typeof a.data !== "string" ||
        !base64.test(a.data)
      )
        return bad;
      if (a.data.length > LIMITS.image) return `图片「${a.name}」太大。`;
      if (++images > LIMITS.images)
        return `一条消息最多 ${LIMITS.images} 张图片。`;
    } else return bad;
  }
  return undefined;
}

/** The text of a file, or a plain-language reason it cannot be sent as text. */
export function decodeText(name: string, bytes: Uint8Array): string {
  if (bytes.length > LIMITS.text)
    throw new Error(
      `文件「${name}」太大，最多约 ${LIMITS.text / 1000}K 个字符。`,
    );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`文件「${name}」不是 UTF-8 文本，无法添加。`);
  }
  if (text.includes("\0"))
    throw new Error(`文件「${name}」不是文本文件，无法添加。`);
  if (!text.trim()) throw new Error(`文件「${name}」是空的。`);
  return text;
}

/** Base64 characters of the pictures in some messages. */
export const imageSize = (
  messages: readonly { attachments?: Attachment[] }[],
) =>
  messages
    .flatMap((m) => m.attachments ?? [])
    .reduce((sum, a) => sum + (a.kind === "image" ? a.data.length : 0), 0);

/** A fence longer than any run of backticks inside, so a file cannot end it early. */
function fenced({ name, text }: { name: string; text: string }) {
  const run = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = "`".repeat(run + 1);
  return `文件「${name}」：\n${fence}\n${text}\n${fence}`;
}

type Turn = {
  role: "user" | "agent";
  text: string;
  attachments?: Attachment[];
};

/**
 * What the model reads for each message: text files in one fixed form before
 * the text, so the same message gives the same prefix every time and the
 * service's cache keeps hitting.
 */
function render(
  { text, attachments = [] }: { text: string; attachments?: Attachment[] },
  keep: boolean,
) {
  const files = attachments.flatMap((a) => (a.kind === "text" ? [a] : []));
  const pictures = attachments.flatMap((a) => (a.kind === "image" ? [a] : []));
  const lines = (keep ? [] : pictures).map((a) => `[图片：${a.name}]`);
  const body = [
    ...(files.length ? [`${files.map(fenced).join("\n\n")}\n\n`] : []),
    text,
    ...lines.map((line) => `\n${line}`),
  ].join("");
  const images: ChatImage[] = keep
    ? pictures.map(({ mime, data }) => ({ mime, data }))
    : [];
  return { text: body, ...(images.length && { images }) };
}

/**
 * The history and the new message as a `chat@1` request reads them. Pictures
 * go only to a model that reads them, and only for the latest few messages
 * that have any; the rest become a line naming the file.
 */
export function prepareChat(
  history: readonly Turn[],
  input: { text: string; attachments?: Attachment[] },
  vision: boolean,
): { history: ChatTurn[]; input: { text: string; images?: ChatImage[] } } {
  const withImages = (t: { attachments?: Attachment[] }) =>
    t.attachments?.some((a) => a.kind === "image") ?? false;
  const holders = history.flatMap((t, i) => (withImages(t) ? [i] : []));
  if (withImages(input)) holders.push(history.length);
  const recent = new Set(holders.slice(-RECENT_IMAGES));
  return {
    history: history.map((turn, i) => ({
      role: turn.role,
      ...render(turn, vision && recent.has(i)),
    })),
    input: render(input, vision && recent.has(history.length)),
  };
}
