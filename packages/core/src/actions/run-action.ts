import {
  CONFIRMATION_DENIED,
  CONSENT_REQUIRED,
  PERMISSION_DENIED,
  PlumsError,
} from "../errors.js";
import {
  requireInstalled,
  requireLegacyManifest,
  type InstallContext,
} from "../install/lifecycle.js";
import type { PermissionV1, PermissionLevel } from "../package/types.js";
import { matchEgressUrl, parseEgressTarget } from "../package/egress-target.js";
import { knownSecrets } from "../install/settings.js";
import { redact } from "../redact.js";
import type {
  ConfirmRequest,
  Confirm,
  EgressRequest,
  EgressResult,
  EgressSink,
} from "../types.js";

export interface RunActionInput {
  extensionId: string;
  /** An `id` from the `permissions` list of that extension's manifest. */
  permissionId: string;
  /**
   * Required for an `egress` permission. `EgressSink.send` receives it with `url` replaced by the
   * normalized form (`new URL(url).href`). Ignored for read and write.
   */
  request?: EgressRequest;
}

export interface ActionResult {
  /** Taken from the manifest. The caller cannot choose it. */
  level: PermissionLevel;
  /** What `EgressSink.send` returned. Present only for `egress`. */
  egress?: EgressResult;
}

/**
 * Check order: installed, enabled, declared (PERMISSION_DENIED); consent (CONSENT_REQUIRED);
 * egress url against the permission target (PERMISSION_DENIED, `/request/url`);
 * confirm.ask for write and egress (CONFIRMATION_DENIED); then egress.send, once, for egress only.
 * A redirect answer is returned as it is. The caller may call runAction again with the new url.
 */
export async function runAction(
  ctx: InstallContext & { egress: EgressSink; confirm: Confirm },
  { extensionId, permissionId, request }: RunActionInput,
): Promise<ActionResult> {
  const { permission, index, name } = authorize(ctx, extensionId, permissionId);
  const { level } = permission;

  const allowedUrl = (target: string, url: string, who: string): URL => {
    const parsed = matchEgressUrl(target, url);
    if (parsed === undefined) {
      throw new PlumsError({
        code: PERMISSION_DENIED,
        message: `「${who}」的权限「${permissionId}」只允许访问 ${target}，这个地址不在范围内。`,
        path: "/request/url",
        details: { id: extensionId, permissionId, reason: "URL_NOT_ALLOWED" },
      });
    }
    return parsed;
  };

  let host: string | undefined;
  let where = "";
  let outbound: EgressRequest | undefined;
  if (level === "egress") {
    if (request === undefined) {
      throw new TypeError(
        "runAction request is required for an egress permission",
      );
    }
    const parsed = allowedUrl(permission.target, request.url, name);
    outbound = { ...request, url: parsed.href };
    host = parsed.host;
    const rule = parseEgressTarget(permission.target);
    where = rule?.wildcard
      ? `${host}（${rule.host}${rule.port === "443" ? "" : `:${rule.port}`} 这个网站的所有子站）`
      : host;
  }
  if (level !== "read") {
    let yes = false;
    try {
      const message =
        level === "egress"
          ? `「${name}」想把数据发送到 ${where}。原因:${permission.reason}。允许吗?`
          : `「${name}」想修改你的数据。原因:${permission.reason}。允许吗?`;
      yes =
        (await ctx.confirm.ask(
          redact(
            {
              subject: name,
              action:
                level === "egress"
                  ? `「${name}」想把数据发送到 ${where}。`
                  : `「${name}」想修改你的数据。`,
              message,
              reason: permission.reason,
              ...(host ? { host } : {}),
            },
            await knownSecrets(ctx),
          ) as ConfirmRequest,
        )) === true;
    } catch {
      // A missing or failing confirm counts as "no".
    }
    if (!yes) {
      throw new PlumsError({
        code: CONFIRMATION_DENIED,
        message: `你没有确认，「${name}」的动作「${permissionId}」没有执行。`,
        path: `/permissions/${index}`,
        details: { id: extensionId, permissionId },
      });
    }
    // The answer can take a while. Check again, and match the url against the permission as it is now.
    const again = authorize(ctx, extensionId, permissionId);
    if (outbound === undefined && again.permission.level !== level) {
      throw new PlumsError({
        code: PERMISSION_DENIED,
        message: `「${again.name}」的权限在确认期间已变化，这次动作没有执行。请重新发起。`,
        path: `/permissions/${again.index}`,
        details: { id: extensionId, permissionId, reason: "LEVEL_MISMATCH" },
      });
    }
    if (outbound !== undefined) {
      if (again.permission.level !== level) {
        throw new PlumsError({
          code: PERMISSION_DENIED,
          message: `「${again.name}」的权限「${permissionId}」只允许访问 ${again.permission.target}，这个地址不在范围内。`,
          path: "/request/url",
          details: { id: extensionId, permissionId, reason: "URL_NOT_ALLOWED" },
        });
      }
      outbound = {
        ...outbound,
        url: allowedUrl(again.permission.target, outbound.url, again.name).href,
      };
    }
  }
  return outbound === undefined
    ? { level }
    : { level, egress: await ctx.egress.send(outbound) };
}

/** Installed, enabled, declared, consented. Shared with the MCP tool gate. */
export function authorize(
  ctx: InstallContext,
  id: string,
  permissionId: string,
) {
  const installed = requireInstalled(ctx, id);
  if (!installed.enabled) {
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: `「${installed.name}」还没有启用，不能执行动作。请先启用它。`,
      details: { id, reason: "NOT_ENABLED" },
    });
  }
  const permissions = requireLegacyManifest(ctx, id).permissions;
  const index = permissions.findIndex((p) => p.id === permissionId);
  const permission = permissions[index] as PermissionV1 | undefined;
  if (permission === undefined) {
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: `「${installed.name}」没有声明过权限「${permissionId}」。`,
      path: "/permissions",
      details: { id, permissionId, reason: "PERMISSION_NOT_DECLARED" },
    });
  }

  const consent = ctx.store.getConsent(id);
  const covered =
    consent?.formatVersion.startsWith("1.") &&
    consent.permissions.some(
      (g) =>
        g.id === permission.id &&
        g.level === permission.level &&
        g.target === permission.target,
    );
  if (!covered) {
    throw new PlumsError({
      code: CONSENT_REQUIRED,
      message: `「${installed.name}」还没有得到你对权限「${permissionId}」的同意。`,
      path: `/permissions/${index}`,
      details: {
        id,
        permissionId,
        version: installed.version,
        reason:
          consent === undefined ? "NO_CONSENT" : "PERMISSION_NOT_CONSENTED",
      },
    });
  }
  return { permission, index, name: installed.name };
}
