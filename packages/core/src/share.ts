import { Buffer } from "node:buffer";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  CONFIRMATION_DENIED,
  PlumsError,
  SHARE_FETCH_FAILED,
} from "./errors.js";
import {
  requireInstalled,
  requireManifest,
  type InstallContext,
} from "./install/lifecycle.js";
import { knownSecrets } from "./install/settings.js";
import { checkHttpsUrl } from "./package/egress-target.js";
import { exportPackage } from "./package/export.js";
import { PACKAGES_DIR } from "./package/install.js";
import {
  MANIFEST_FILE,
  type PackageFiles,
  type PackageLimits,
} from "./package/types.js";
import type { Confirm, EgressResult, EgressSink } from "./types.js";

/** Largest share-link body accepted, in bytes (latin1 length). A larger body is SHARE_FETCH_FAILED. */
export const MAX_SHARE_BYTES = 20 * 1024 * 1024;

const SHARE_CONFIRM_REASON = "下载别人分享的包";

/**
 * Writes installed package `id` to `filePath` by calling `exportPackage`, so the secret check applies.
 * Returns those zip bytes. Throws PERMISSION_DENIED and creates no file when `id` is not installed.
 */
export async function shareToFile(
  ctx: InstallContext,
  limits: PackageLimits,
  id: string,
  filePath: string,
): Promise<Uint8Array> {
  requireInstalled(ctx, id);
  const files = await readInstalledFiles(
    path.join(ctx.dataDir, PACKAGES_DIR, id),
  );
  return exportPackage(
    { manifest: requireManifest(ctx, id), files },
    limits,
    { outPath: filePath },
    await knownSecrets(ctx),
  );
}

/**
 * Downloads `url` into memory. Writes nothing. One `egress.send`, no redirect following.
 * The body is latin1: one character is one byte. A character above 0xFF is not a byte and is refused, not truncated.
 */
export async function fetchSharedPackage(
  url: string,
  egress: EgressSink,
  confirm: Confirm,
): Promise<Uint8Array> {
  const parsed = requireShareUrl(url);
  let yes = false;
  try {
    yes =
      (await confirm.ask({
        subject: "Plums",
        action: `从 ${parsed.host} 下载分享的包。`,
        message: `要从 ${parsed.host} 下载别人分享的包。原因:${SHARE_CONFIRM_REASON}。允许吗?`,
        host: parsed.host,
        reason: SHARE_CONFIRM_REASON,
      })) === true;
  } catch {
    yes = false;
  }
  if (!yes) {
    throw new PlumsError({
      code: CONFIRMATION_DENIED,
      message: "你没有确认，所以没有下载这个包。",
      path: "/url",
      details: { url: redactShareUrl(url) },
    });
  }

  let result: EgressResult;
  try {
    result = await egress.send({ url: parsed.href, method: "GET" });
  } catch {
    throw shareFailed(url, "NETWORK");
  }
  if (result.redirectTo !== undefined) {
    throw shareFailed(url, "REDIRECT");
  }
  if (
    !Number.isInteger(result.status) ||
    result.status < 200 ||
    result.status >= 300
  ) {
    throw shareFailed(url, "HTTP_STATUS", result.status);
  }
  const body = typeof result.body === "string" ? result.body : "";
  if (body.length > MAX_SHARE_BYTES) {
    throw shareFailed(url, "TOO_LARGE");
  }
  if (/[^\u0000-\u00ff]/.test(body) || !isZip(body)) {
    throw shareFailed(url, "NOT_A_ZIP");
  }
  return new Uint8Array(Buffer.from(body, "latin1"));
}

function requireShareUrl(input: string): URL {
  const parsed = checkHttpsUrl(input);
  if (typeof parsed === "string") throw shareFailed(input, parsed);
  return parsed;
}

/** Local file header. A package zip always starts with one; anything else is not a zip we can import. */
function isZip(body: string): boolean {
  return (
    body.length >= 4 &&
    body.charCodeAt(0) === 0x50 &&
    body.charCodeAt(1) === 0x4b &&
    body.charCodeAt(2) === 0x03 &&
    body.charCodeAt(3) === 0x04
  );
}

/** Drops user info, the query, and the fragment. Keeps scheme, host, and path. An unparseable value loses everything from `?` or `#`. */
function redactShareUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    const cut = raw.split(/[?#]/)[0] ?? "";
    return cut.replace(/\/\/[^/?#\s]*@/, "//");
  }
}

const SHARE_MESSAGES = {
  INVALID_URL: () => "这个分享链接不是有效的网址。",
  NOT_HTTPS: () => "分享链接必须是 https。",
  USERINFO: () => "分享链接里不能写账号或密码。",
  IP_LITERAL: () => "分享链接不能用 IP 地址。",
  TRAILING_DOT: () => "主机名不能以点结尾。",
  LOCALHOST: () => "分享链接不能用 localhost。",
  NETWORK: () => "下载分享链接时没有连上。",
  HTTP_STATUS: (status?: number) => `分享链接没有下载成功（HTTP ${status}）。`,
  REDIRECT: () => "分享链接发生了跳转，已经停止，没有下载。",
  TOO_LARGE: () => `分享链接的内容超过 ${MAX_SHARE_BYTES} 字节，已经停止。`,
  NOT_A_ZIP: () => "分享链接的内容不是一个 zip 压缩包。",
};

function shareFailed(
  rawUrl: string,
  reason: keyof typeof SHARE_MESSAGES,
  status?: number,
): PlumsError {
  return new PlumsError({
    code: SHARE_FETCH_FAILED,
    // Why no fallback: every caller passes one of the keys above.
    message: SHARE_MESSAGES[reason](status),
    path: "/url",
    details: { url: redactShareUrl(rawUrl), reason },
  });
}

export async function readInstalledFiles(dir: string): Promise<PackageFiles> {
  const files: PackageFiles = Object.create(null);
  const walk = async (relative: string): Promise<void> => {
    const entries = await readdir(
      path.join(dir, ...relative.split("/").filter(Boolean)),
      { withFileTypes: true },
    );
    for (const entry of entries) {
      const rel = relative === "" ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(rel);
      } else if (entry.isFile() && rel !== MANIFEST_FILE) {
        files[rel] = new Uint8Array(
          await readFile(path.join(dir, ...rel.split("/"))),
        );
      }
    }
  };
  await walk("");
  return files;
}
