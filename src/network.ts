import { invokeNative } from "./native/invoke";
import type {
  CredentialFailureOutcome,
  NetworkReadResponse,
} from "../modules/sdk";
import { networkOrigin } from "../modules/sdk/network";

const reasons: Record<string, string> = {
  denied: "扩展没有联网读取权限。",
  busy: "该扩展已有联网读取在进行，请稍后再试。",
  "invalid-request": "地址不是扩展声明的 HTTPS 来源，未发送。",
  timeout: "读取超时。",
  redirect: "服务返回了跳转，已拒绝跟随。",
  "response-too-large": "响应超过 16 MiB。",
  "response-encoding": "响应不是有效的 UTF-8 文本。",
};
function readFailure(code: string, outcome: CredentialFailureOutcome) {
  return Object.assign(
    new Error(
      reasons[code] ?? (outcome === "unknown" ? "读取未完成。" : "未发送。"),
    ),
    { code, outcome },
  );
}

/**
 * `network.read`: a GET of a public resource on a source the owner's
 * manifest declares, sent natively with no credentials or redirects.
 */
export class NetworkAccess {
  /** The owner's declared sources; the shell sets it from manifests. */
  describe: (owner: string) => readonly string[] | undefined = () => undefined;
  async read(
    owner: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<NetworkReadResponse> {
    const { version, url } = (payload ?? {}) as Record<string, unknown>;
    const fields =
      payload && typeof payload === "object"
        ? Object.keys(payload).sort().join()
        : "";
    const origin =
      typeof url === "string" && url.length <= 2048 && !url.includes("#")
        ? networkOrigin(url)
        : undefined;
    if (
      fields !== "url,version" ||
      version !== 1 ||
      !origin ||
      !this.describe(owner)?.includes(origin)
    )
      throw readFailure("invalid-request", "not-dispatched");
    if (signal?.aborted) throw readFailure("cancelled", "not-dispatched");
    const id = crypto.randomUUID();
    const abort = () =>
      void invokeNative("network_abort", { owner, id }).catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await invokeNative("network_read", {
        owner,
        id,
        url: url as string,
      });
    } catch (error) {
      const { code, outcome } = (error ?? {}) as Record<string, unknown>;
      if (
        typeof code === "string" &&
        (outcome === "not-dispatched" || outcome === "unknown")
      )
        throw readFailure(code, outcome);
      throw readFailure("transport", "unknown");
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  /** Cancels the owner's read in flight. */
  async release(owner: string) {
    await invokeNative("network_release", { owner }).catch(() => {});
  }
}
