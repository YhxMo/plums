import { CONSENT_REQUIRED, PERMISSION_DENIED, PlumsError } from "../errors.js";
import {
  requireInstalled,
  requireManifest,
  type InstallContext,
} from "../install/lifecycle.js";
import { isManifestV2 } from "../package/types.js";
import {
  mcpToolFingerprint,
  type McpTool,
  type McpToolCheck,
} from "./tools.js";
import type { McpApprovalV2 } from "../install/store.js";

function connector(
  ctx: InstallContext,
  id: string,
  permissionId?: string,
): void {
  const installed = requireInstalled(ctx, id);
  const manifest = requireManifest(ctx, id);
  if (!isManifestV2(manifest) || manifest.kind !== "connector")
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: "需要 2.x 连接器。",
      path: "/formatVersion",
    });
  if (permissionId !== undefined) {
    if (!installed.enabled) deny("NOT_ENABLED");
    const p = manifest.permissions.find(
      (p) => p.id === permissionId && p.kind === "egress",
    );
    if (!p) deny("PERMISSION_NOT_DECLARED");
    const c = ctx.store.getConsent(id);
    if (
      !c?.formatVersion.startsWith("2.") ||
      !c.permissions.some(
        (q) => q.id === p.id && q.kind === "egress" && q.target === p.target,
      )
    )
      throw new PlumsError({
        code: CONSENT_REQUIRED,
        message: "连接器尚未获得当前外发权限的同意。",
      });
  }
}
function deny(reason: string): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "连接器调用未获得授权。",
    details: { reason },
  });
}
function hashes(tools: McpTool[]) {
  if (!Array.isArray(tools) || tools.length > 1000)
    throw new TypeError("Invalid MCP tool list");
  const names = new Set<string>();
  return tools.map((t) => {
    if (
      !t ||
      typeof t.name !== "string" ||
      !/^[A-Za-z0-9_.-]{1,128}$/.test(t.name) ||
      typeof t.description !== "string" ||
      names.has(t.name)
    )
      throw new TypeError("Invalid MCP tool list");
    names.add(t.name);
    return { name: t.name, fingerprint: mcpToolFingerprint(t) };
  });
}
export function checkMcpToolsV2(
  ctx: InstallContext,
  id: string,
  tools: McpTool[],
): McpToolCheck[] {
  connector(ctx, id);
  const current = hashes(tools);
  const before = new Map(
    ctx.store.checkMcpV2(id, current).map((a) => [a.tool, a.fingerprint]),
  );
  return current.map((t) => ({
    tool: t.name,
    fingerprint: t.fingerprint,
    state: !before.has(t.name)
      ? "ADDED"
      : before.get(t.name) === t.fingerprint
        ? "APPROVED"
        : "CHANGED",
  }));
}
export function approveMcpToolsV2(
  ctx: InstallContext,
  id: string,
  permissionId: string,
  tools: McpTool[],
): McpApprovalV2[] {
  connector(ctx, id, permissionId);
  const rows = hashes(tools).map((t) => ({
    tool: t.name,
    fingerprint: t.fingerprint,
    permissionId,
    approvedAt: new Date().toISOString(),
  }));
  ctx.store.saveMcpV2(id, rows);
  return rows;
}
/** Called again by the delegated capability gate after confirmation and audit. */
export function authorizeMcpToolV2(
  ctx: InstallContext,
  id: string,
  permissionId: string,
  tool: McpTool,
): void {
  connector(ctx, id, permissionId);
  const [current] = hashes([tool]);
  const row = ctx.store.listMcpV2(id).find((a) => a.tool === current!.name);
  if (
    !row ||
    row.fingerprint !== current!.fingerprint ||
    row.permissionId !== permissionId
  )
    throw new PlumsError({
      code: CONSENT_REQUIRED,
      message: "MCP 工具需要重新批准。",
      path: `/tools/${tool.name}`,
      details: { reason: row ? "TOOL_CHANGED" : "TOOL_ADDED" },
    });
}
