import { sameOrigin } from "@modules/sdk/validation";
import { fromBase64, isPng, pngTextChunks } from "./card-png";
import { parseRoleCard } from "./validation";

/** Largest role card read: picture cards carry an image and long lore. */
export const MAX_CARD_BYTES = 20 * 1024 * 1024;
const TOO_LARGE = "角色卡不能超过 20 MB。";

/** A role card as read: its JSON text, and its picture for a picture card. */
export type RoleCardSource = { text: string; picture?: Blob };

/** The card in a file's bytes: a PNG's V3 or V2 chunk, else UTF-8 JSON. */
function fromBytes(bytes: Uint8Array<ArrayBuffer>): RoleCardSource {
  if (!isPng(bytes))
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  const text = pngTextChunks(bytes);
  const card = text.get("ccv3") ?? text.get("chara");
  if (!card) throw new Error("这张图片里没有角色卡。");
  try {
    return {
      text: fromBase64(card),
      picture: new Blob([bytes], { type: "image/png" }),
    };
  } catch (error) {
    throw new Error("这张图片里的角色卡已损坏。", { cause: error });
  }
}

export async function readRoleCardFile(file: Blob) {
  if (file.size > MAX_CARD_BYTES) throw Error(TOO_LARGE);
  return fromBytes(new Uint8Array(await file.arrayBuffer()));
}

/** Business-owned import: same-origin only, bounded even without Content-Length. */
export async function readRoleCardLink(
  url: string,
  signal: AbortSignal,
): Promise<RoleCardSource> {
  const target = sameOrigin(url, location.href);
  if (!target)
    throw Error("当前版本仅支持应用内链接；外部角色卡请下载后选择文件。");
  signal.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 10000);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await fetch(target, {
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok || !response.body) throw Error("角色卡读取失败。");
    reader = response.body.getReader();
    const parts: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_CARD_BYTES) throw Error(TOO_LARGE);
      parts.push(value);
    }
    const all = new Uint8Array(bytes);
    let at = 0;
    for (const part of parts) {
      all.set(part, at);
      at += part.byteLength;
    }
    const card = fromBytes(all);
    parseRoleCard(card.text);
    return card;
  } catch (error) {
    if (timedOut) throw Error("角色卡读取超时，请重试。", { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    if (reader) {
      void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
