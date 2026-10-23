import type { Attachment } from "@modules/agents/contract";
import { LIMITS, decodeText } from "@modules/agents/attachments";
import { scaledPicture } from "./imageFile";

/** Fits a name into the attachment name limit, keeping the extension. */
function shortName(name: string) {
  return name.length <= 120 ? name : `${name.slice(0, 100)}…${name.slice(-19)}`;
}

/** A chosen, dropped or pasted file as an attachment, or the reason it cannot be one. */
export async function toAttachment(file: File): Promise<Attachment> {
  const name = shortName(file.name || "图片");
  if (file.type.startsWith("image/"))
    return { kind: "image", name, ...(await scaledPicture(file)) };
  if (file.size > LIMITS.text * 4)
    throw new Error(
      `文件「${name}」太大，最多约 ${LIMITS.text / 1000}K 个字符。`,
    );
  return {
    kind: "text",
    name,
    text: decodeText(name, new Uint8Array(await file.arrayBuffer())),
  };
}
