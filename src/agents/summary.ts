import type { Message } from "@modules/agents/contract";

/** A message on one line: its text, or the files it carries when it has none. */
export function summary(m: Pick<Message, "text" | "attachments">) {
  return (
    m.text ||
    (m.attachments ?? [])
      .map((a) => `${a.kind === "image" ? "[图片]" : "[文件]"} ${a.name}`)
      .join(" ")
  );
}
