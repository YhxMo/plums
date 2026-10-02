/**
 * MCP tool consent. The kernel never connects to a server; the host passes the list it read.
 *
 * - Fingerprint is SHA-256 of [name, description, inputSchema]. Why: a changed parameter list
 *   changes what the tool can do, including adding a parameter that writes files, so it needs
 *   consent again. Encoding rules live on `mcpToolFingerprint`.
 * - Nothing is trimmed or lowercased. Why: one changed character must change the hash.
 * - The description is never read, executed, or used as a permission, and never copied into
 *   the confirm text. Why: it is untrusted text from the server.
 * - A new name, a renamed tool, a changed description, or a changed inputSchema needs a new
 *   approval before the call. Why: any of those can change what the tool does, so it counts as
 *   a new permission.
 * - A tool missing from a list check loses its approval, and an empty list drops every tool
 *   approval for that server. The list is hashed before the drop, and the read and the delete
 *   are one transaction. Why: keeping the old row would let that consent come back to life when
 *   the same name returns, and a check that throws is not a new list.
 * - A hand-added server (`manual:<name>`) is unverified: only `read` is approved unless the
 *   caller names that tool in `allowNonRead`. Why: no package manifest vouches for it.
 * - A hand-added tool with no level counts as `write`. Why: treating it as read would skip
 *   the per-tool grant.
 * - A connector tool's level is the manifest permission with the same id. Why: the host and
 *   the description must not be able to raise or lower it.
 * - Tool names are `A-Za-z0-9_.-`, 1 to 128 characters. Why: the name is placed in the error
 *   path and the confirm text, and this set needs no JSON Pointer escaping.
 */
import { createHash } from "node:crypto";
import { authorize } from "../actions/run-action.js";
import { CONFIRMATION_DENIED, CONSENT_REQUIRED, PERMISSION_DENIED, PlumsError } from "../errors.js";
import { LEVEL_RANK, requireInstalled, requireManifest, type InstallContext } from "../install/lifecycle.js";
import type { McpApproval } from "../install/store.js";
import { ID_PATTERN } from "../package/schema.js";
import type { PermissionLevel } from "../package/types.js";
import type { Confirm } from "../types.js";

/** Server ids of hand-added MCP services start with this. Package ids cannot contain a colon. */
const MANUAL_PREFIX = "manual:";
// The name after `manual:` is ID_PATTERN. Package ids are also capped at 64 characters in the
// manifest schema; a hand-added name is not, so a long name stays valid.
const MANUAL_ID = new RegExp(`^manual:${ID_PATTERN.slice(1, -1)}$`);
// Tool names go into error messages and paths, so only plain characters are allowed.
const TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

/** A tool as the host read it from the server. The kernel never connects to a server. */
export interface McpTool {
  name: string;
  /** Untrusted text from the server. It is hashed only: never read, shown or used for a permission. */
  description: string;
  /** Untrusted JSON from the server. Hashed only, never read as a permission or shown. */
  inputSchema?: unknown;
  /** Used for hand-added services only; a connector's level comes from its manifest. Left out means `write`. */
  level?: PermissionLevel;
}

export type McpToolState = "APPROVED" | "ADDED" | "CHANGED";

export interface McpToolCheck {
  tool: string;
  fingerprint: string;
  /** `ADDED`: never approved. `CHANGED`: the name, description, or inputSchema hash differs. */
  state: McpToolState;
}

export interface McpServerState {
  serverId: string;
  /** True for a hand-added service: it is read-only unless a tool is granted one by one. */
  unverified: boolean;
  tools: McpApproval[];
}

export interface McpApproveResult {
  approved: McpApproval[];
  skipped: { tool: string; reason: "NOT_DECLARED" | "UNVERIFIED_READ_ONLY" }[];
}

type Ctx = InstallContext & { confirm: Confirm };

const MAX_SCHEMA_DEPTH = 64;
const MAX_SCHEMA_BYTES = 256 * 1024;

/**
 * SHA-256 hex of `[name, description, inputSchema]`. Object keys are sorted at every level and
 * array order is kept. A missing schema and an explicit `null` both hash as `null`. Why `null`:
 * omitting the field has to be one stable fingerprint. Why sort keys: key order in a JSON object
 * is not part of its meaning. Why keep array order: position can change which argument a value is.
 * Why JSON: encoded values cannot run into each other. Name and description are not trimmed.
 * `level` is not included. The host must pass `inputSchema`; the kernel cannot see the server.
 */
export function mcpToolFingerprint(tool: { name: string; description: string; inputSchema?: unknown }): string {
  const schema = canonicalSchema(tool.inputSchema, 1);
  if (Buffer.byteLength(JSON.stringify(schema)) > MAX_SCHEMA_BYTES) {
    throw new TypeError("MCP inputSchema is too large");
  }
  return createHash("sha256").update(JSON.stringify([tool.name, tool.description, schema])).digest("hex");
}

/** Plain JSON with object keys sorted. Why a null prototype: a key named `__proto__` must stay in the hash. */
function canonicalSchema(value: unknown, depth: number): unknown {
  if (depth > MAX_SCHEMA_DEPTH) {
    throw new TypeError("MCP inputSchema is too deep");
  }
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("MCP inputSchema must be JSON");
    }
    return value;
  }
  if (typeof value !== "object") {
    throw new TypeError("MCP inputSchema must be JSON");
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalSchema(item, depth + 1));
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError("MCP inputSchema must be JSON");
  }
  const out = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(value).sort()) {
    const child = (value as Record<string, unknown>)[key];
    if (child !== undefined) {
      out[key] = canonicalSchema(child, depth + 1);
    }
  }
  return out;
}

/**
 * Drops a hand-added server's tool approvals. Those rows are its fingerprints and its consent;
 * there is no package and no separate consent record. A valid id with nothing stored still succeeds.
 */
export function uninstallManualServer(ctx: InstallContext, serverId: string): void {
  if (typeof serverId !== "string" || !MANUAL_ID.test(serverId)) {
    throw new TypeError(`A hand-added MCP serverId looks like "manual:<lowercase-name>", got: ${String(serverId)}`);
  }
  ctx.store.remove(serverId);
}

export function getMcpApprovals(ctx: InstallContext, serverId: string): McpServerState {
  const unverified = resolveServer(ctx, serverId);
  return { serverId, unverified, tools: ctx.store.listMcpApprovals(serverId) };
}

/**
 * Compares the host's current list with the approvals. A tool that is not in `tools` loses its row.
 * An empty list drops every tool approval for this server. Package consent is another table, and
 * other servers are other ids, so those rows stay.
 * Why: the old fingerprint must not count as consent if that name comes back.
 * The host must pass the full list. Do not pass `[]` or a subset when a fetch fails or only the
 * first page arrived, or the other tools lose their fingerprint and consent. This call deletes
 * tools that have disappeared (it has a delete side effect).
 * Names are hashed before the drop. Why: a list that cannot be hashed throws, and that throw must
 * leave the previous consent in place. The store then reads and deletes in one transaction.
 */
export function checkMcpTools(ctx: InstallContext, serverId: string, tools: McpTool[]): McpToolCheck[] {
  requireToolArray(tools);
  resolveServer(ctx, serverId);
  const list = validTools(tools);
  const hashed = list.map((tool) => ({ name: tool.name, fingerprint: mcpToolFingerprint(tool) }));
  const approved = new Map(
    ctx.store.dropMcpApprovalsExcept(serverId, hashed.map((tool) => tool.name)).map((row) => [row.tool, row.fingerprint]),
  );
  return hashed.map(({ name, fingerprint }) => {
    const before = approved.get(name);
    return { tool: name, fingerprint, state: before === undefined ? "ADDED" : before === fingerprint ? "APPROVED" : "CHANGED" };
  });
}

/**
 * Records the current fingerprint of each tool: the user's (re)consent to that name, description, and inputSchema.
 * The host must call this only after the user has agreed. Why: the kernel does not connect to an MCP
 * server, so it cannot check that agreement itself. `enable` and `grantConsent` do not record fingerprints.
 * Connector: only tools that match a manifest permission id are recorded, at that permission's level.
 * Hand-added service: only `read` tools, plus the `write`/`egress` tools named in `allowNonRead`.
 * Why: a hand-added service has no manifest to vouch for it, so anything above read is a separate choice.
 */
export function approveMcpTools(
  ctx: InstallContext,
  serverId: string,
  tools: McpTool[],
  allowNonRead: string[] = [],
): McpApproveResult {
  requireToolArray(tools);
  const unverified = resolveServer(ctx, serverId);
  const list = validTools(tools);
  for (const name of allowNonRead) {
    if (!list.some((t) => t.name === name)) {
      throw new TypeError(`allowNonRead names a tool that is not in the list: ${name}`);
    }
  }
  const declared = unverified ? [] : requireManifest(ctx, serverId).permissions;
  const result: McpApproveResult = { approved: [], skipped: [] };
  const now = new Date().toISOString();
  for (const tool of list) {
    const level = unverified ? (tool.level ?? "write") : declared.find((p) => p.id === tool.name)?.level;
    if (level === undefined) {
      result.skipped.push({ tool: tool.name, reason: "NOT_DECLARED" });
    } else if (unverified && level !== "read" && !allowNonRead.includes(tool.name)) {
      result.skipped.push({ tool: tool.name, reason: "UNVERIFIED_READ_ONLY" });
    } else {
      result.approved.push({ tool: tool.name, fingerprint: mcpToolFingerprint(tool), level, approvedAt: now });
    }
  }
  ctx.store.saveMcpApprovals(serverId, result.approved);
  return result;
}

/**
 * Decides whether the host may call `tool` now. Does not call anything itself.
 * Order: connector installed, enabled, declared, consented (as `runAction`); the tool's hash against its
 * approval (CONSENT_REQUIRED `/tools/<name>`); level; confirm.ask for write and egress (CONFIRMATION_DENIED).
 * Why the host passes the tool: the check then uses the words the host is about to use, not a stored copy.
 */
export async function authorizeMcpTool(
  ctx: Ctx,
  serverId: string,
  tool: McpTool,
): Promise<{ level: PermissionLevel }> {
  const [checked] = validTools([tool]) as [McpTool];
  const first = gate(ctx, serverId, checked);
  if (first.level === "read") {
    return { level: first.level };
  }
  let yes = false;
  try {
    const what = first.level === "egress" ? "把数据发送到外部服务" : "修改你的数据";
    const message = `「${first.name}」想用工具「${checked.name}」${what}。允许吗?`;
    // The description and inputSchema are left out: both are untrusted and can be arbitrarily long.
    yes = (await ctx.confirm.ask({ message, ...(first.reason ? { reason: first.reason } : {}) })) === true;
  } catch {
    // A missing or failing confirm counts as "no".
  }
  if (!yes) {
    throw new PlumsError({
      code: CONFIRMATION_DENIED,
      message: `你没有确认，「${first.name}」的工具「${checked.name}」没有执行。`,
      path: toolPath(checked.name),
      details: { id: serverId, tool: checked.name },
    });
  }
  // The answer can take a while. A different level now must not run as the one the user saw.
  const second = gate(ctx, serverId, checked);
  if (second.level !== first.level) {
    throw levelMismatch(second.name, serverId, checked.name, toolPath(checked.name));
  }
  return { level: second.level };
}

function gate(ctx: InstallContext, serverId: string, tool: McpTool) {
  const unverified = resolveServer(ctx, serverId);
  const fingerprint = mcpToolFingerprint(tool);
  const approval = ctx.store.listMcpApprovals(serverId).find((a) => a.tool === tool.name);
  const path = toolPath(tool.name);
  if (unverified) {
    // The call's level is only a claim. Once approved, the recorded level is the one that counts.
    // Why: the host could pass `read` for a write tool and skip the confirm.
    const name = `${serverId.slice(MANUAL_PREFIX.length)}（未验证）`;
    const claimed = tool.level ?? "write";
    if (approval === undefined) {
      if (claimed !== "read") {
        throw new PlumsError({
          code: PERMISSION_DENIED,
          message: `「${name}」是手动添加的服务，默认只能读取。工具「${tool.name}」要先由你单独授权。`,
          path,
          details: { id: serverId, tool: tool.name, reason: "UNVERIFIED_READ_ONLY" },
        });
      }
      throw toolAdded(name, serverId, tool.name, path, fingerprint);
    }
    if (approval.fingerprint !== fingerprint) {
      throw toolChanged(name, serverId, tool.name, path, approval.fingerprint, fingerprint);
    }
    if (claimed !== approval.level) {
      throw levelMismatch(name, serverId, tool.name, path);
    }
    return { level: approval.level, name, reason: undefined };
  }

  const { permission, name } = authorize(ctx, serverId, tool.name);
  if (approval === undefined) {
    throw toolAdded(name, serverId, tool.name, path, fingerprint);
  }
  if (approval.fingerprint !== fingerprint) {
    throw toolChanged(name, serverId, tool.name, path, approval.fingerprint, fingerprint);
  }
  return { level: permission.level, name, reason: permission.reason };
}

function levelMismatch(name: string, id: string, tool: string, path: string): PlumsError {
  return new PlumsError({
    code: PERMISSION_DENIED,
    message: `「${name}」的工具「${tool}」声明的档位与已同意的档位不一致，所以没有执行。`,
    path,
    details: { id, tool, reason: "LEVEL_MISMATCH" },
  });
}

function toolAdded(name: string, id: string, tool: string, path: string, fingerprint: string): PlumsError {
  return new PlumsError({
    code: CONSENT_REQUIRED,
    message: `「${name}」的工具「${tool}」你还没有同意，暂时不能用。`,
    path,
    details: { id, tool, reason: "TOOL_ADDED", fingerprint },
  });
}

function toolChanged(
  name: string,
  id: string,
  tool: string,
  path: string,
  approvedFingerprint: string,
  fingerprint: string,
): PlumsError {
  return new PlumsError({
    code: CONSENT_REQUIRED,
    message: `「${name}」的工具「${tool}」自你同意之后有变化，需要你重新同意才能用。`,
    path,
    details: { id, tool, reason: "TOOL_CHANGED", approvedFingerprint, fingerprint },
  });
}

/** True for a hand-added service. A connector id must be an installed connector package. */
function resolveServer(ctx: InstallContext, serverId: string): boolean {
  if (typeof serverId !== "string") {
    throw new TypeError("MCP serverId must be a string");
  }
  if (serverId.startsWith(MANUAL_PREFIX)) {
    if (!MANUAL_ID.test(serverId)) {
      throw new TypeError(`A hand-added MCP serverId looks like "manual:<lowercase-name>", got: ${serverId}`);
    }
    return true;
  }
  const installed = requireInstalled(ctx, serverId);
  if (installed.kind !== "connector") {
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: `「${installed.name}」不是连接器，没有 MCP 工具。`,
      details: { id: serverId, reason: "NOT_A_CONNECTOR" },
    });
  }
  return false;
}

/** Only the list entrances reject a non-array. `authorizeMcpTool` passes one tool, already wrapped. */
function requireToolArray(tools: McpTool[]): void {
  if (!Array.isArray(tools)) {
    throw new TypeError("MCP tools must be an array");
  }
}

function validTools(tools: McpTool[]): McpTool[] {
  const seen = new Set<string>();
  for (const tool of tools) {
    if (tool === null || typeof tool !== "object" || typeof tool.name !== "string" || !TOOL_NAME.test(tool.name)) {
      throw new TypeError("An MCP tool name must be 1-128 characters of A-Z a-z 0-9 _ . -");
    }
    if (typeof tool.description !== "string") {
      throw new TypeError(`MCP tool ${tool.name} needs a string description`);
    }
    if (tool.level !== undefined && !Object.hasOwn(LEVEL_RANK, tool.level)) {
      throw new TypeError(`MCP tool ${tool.name} has an unknown level`);
    }
    if (seen.has(tool.name)) {
      throw new TypeError(`MCP tool name listed twice: ${tool.name}`);
    }
    seen.add(tool.name);
  }
  return tools;
}

function toolPath(name: string): string {
  return `/tools/${name}`;
}
