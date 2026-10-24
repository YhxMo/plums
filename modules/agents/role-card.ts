import { sameOrigin } from "@modules/sdk/validation";
import { parseRoleCard } from "./validation";

export async function readRoleCardFile(file: Blob) {
  if (file.size > 32000) throw Error("角色卡不能超过 32 KB。");
  return file.text();
}

/** Business-owned import: same-origin only, bounded even without Content-Length. */
export async function readRoleCardLink(url: string, signal: AbortSignal) {
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
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let card = "";
    for (;;) {
      const { done, value } = await reader.read();
      controller.signal.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 32000) throw Error("角色卡不能超过 32 KB（32000 字节）。");
      card += decoder.decode(value, { stream: true });
    }
    card += decoder.decode();
    parseRoleCard(card);
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
