import { invokeNative } from "./native/invoke";
import { platformRejection } from "@modules/sdk";
import { isOpenableLink } from "@modules/sdk/links";

/**
 * `link.open`: the app hands an HTTPS link to the default browser natively;
 * the browser preview opens a tab with no opener or referrer.
 */
export async function openLink(
  owner: string,
  payload: unknown,
  native: boolean,
) {
  const { version, url } = (payload ?? {}) as Record<string, unknown>;
  const fields =
    payload && typeof payload === "object"
      ? Object.keys(payload).sort().join()
      : "";
  if (fields !== "url,version" || version !== 1 || !isOpenableLink(url))
    throw platformRejection("只能打开 https 链接。");
  if (!native) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    await invokeNative("link_open", { owner, url });
  } catch (error) {
    throw Object.assign(platformRejection("未能在浏览器中打开链接。"), {
      cause: error,
    });
  }
}
