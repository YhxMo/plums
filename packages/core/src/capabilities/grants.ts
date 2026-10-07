import { createHash, randomUUID } from "node:crypto";
import { PlumsError, PERMISSION_DENIED, CAPABILITY_FAILED } from "../errors.js";
import { requireInstalled, requireManifest } from "../install/lifecycle.js";
import { enginePermissionKey } from "../install/engine-trust.js";
import { knownSecrets } from "../install/settings.js";
import { redact } from "../redact.js";
import {
  copyJson,
  declaredService,
  resolveService,
  type ServiceContext,
} from "./services.js";
import type {
  AuditEvent,
  CapabilityCaller,
  CapabilityRequest,
} from "./types.js";

/** Resource ids are opaque. The trusted engine enforces its own local reads and outputs. */
export interface GrantUse {
  reads: string[];
  outputs: string[];
}
export interface GrantService extends CapabilityCaller {
  binding: string;
  operation: string;
}
export interface GrantScope extends GrantUse {
  services: GrantService[];
}
export interface GrantInput {
  ownerId: string;
  engineId: string;
  scope: GrantScope;
}
export interface Grant extends GrantInput {
  id: string;
  instanceId: string;
  fingerprint: string;
  grantedAt: string;
  expiresAt: number;
  revokedAt?: string;
}
export interface GrantPlan extends GrantInput {
  fingerprint: string;
}
export interface CreateGrantInput extends GrantPlan {
  durationMs: number;
}
const resource = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
function deny(): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "授权已到期、撤销或范围发生变化。",
    path: "/grantId",
    details: { reason: "GRANT_SCOPE_CHANGED" },
  });
}
export function copyGrantUse(raw: unknown): GrantUse {
  const value = copyJson(raw) as unknown as GrantUse;
  if (
    !value ||
    Object.keys(value).some((k) => !["reads", "outputs"].includes(k))
  )
    throw new TypeError("Invalid grant resources");
  for (const list of [value.reads, value.outputs])
    if (
      !Array.isArray(list) ||
      list.length > 32 ||
      list.some((v) => typeof v !== "string" || !resource.test(v)) ||
      new Set(list).size !== list.length
    )
      throw new TypeError("Invalid grant resources");
  return { reads: [...value.reads].sort(), outputs: [...value.outputs].sort() };
}
function input(raw: GrantInput): GrantInput {
  const value = copyJson(raw) as unknown as GrantInput;
  if (
    !value ||
    typeof value.ownerId !== "string" ||
    !resource.test(value.ownerId) ||
    typeof value.engineId !== "string" ||
    !resource.test(value.engineId) ||
    !value.scope ||
    !Array.isArray(value.scope.services) ||
    value.scope.services.length === 0 ||
    value.scope.services.length > 16
  )
    throw new TypeError("Invalid grant scope");
  const use = copyGrantUse({
    reads: value.scope.reads,
    outputs: value.scope.outputs,
  });
  const services = value.scope.services
    .map((s) => {
      if (
        !s ||
        typeof s.packageId !== "string" ||
        !resource.test(s.packageId) ||
        typeof s.permissionId !== "string" ||
        !resource.test(s.permissionId) ||
        typeof s.operation !== "string" ||
        !resource.test(s.operation) ||
        typeof s.binding !== "string" ||
        !s.binding ||
        s.binding.length > 256 ||
        /[\r\n\0]/.test(s.binding)
      )
        throw new TypeError("Invalid grant service");
      return {
        packageId: s.packageId,
        permissionId: s.permissionId,
        operation: s.operation,
        binding: s.binding,
      };
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  if (new Set(services.map((s) => JSON.stringify(s))).size !== services.length)
    throw new TypeError("Duplicate grant service");
  return {
    ownerId: value.ownerId,
    engineId: value.engineId,
    scope: { ...use, services },
  };
}
export async function grantPlan(
  ctx: ServiceContext,
  raw: GrantInput,
): Promise<GrantPlan> {
  const value = input(raw),
    owner = requireInstalled(ctx, value.ownerId),
    manifest = requireManifest(ctx, value.ownerId);
  const permission = manifest.permissions.find(
    (p) => "kind" in p && p.kind === "engine" && p.target === value.engineId,
  );
  const trust = ctx.store
    .listEngineTrust(value.ownerId)
    .find((t) => t.engineId === value.engineId);
  if (
    !owner.enabled ||
    !permission ||
    !trust ||
    trust.instanceId !== ctx.instanceId ||
    trust.installedAt !== owner.installedAt ||
    trust.permission !== enginePermissionKey(permission)
  )
    deny();
  const state = () =>
    JSON.stringify([
      ctx.instanceId,
      [
        ...new Set([
          value.ownerId,
          ...value.scope.services.map((s) => s.packageId),
        ]),
      ].map((id) => [
        requireInstalled(ctx, id),
        requireManifest(ctx, id),
        ctx.store.getConsent(id),
        ctx.store.settingsRevision(id),
      ]),
      ctx.store.listEngineTrust(value.ownerId),
      ctx.store.engineTrustRevision(),
      ctx.store.backgroundRevision(),
    ]);
  const before = state();
  const scopes = [];
  for (const s of value.scope.services) {
    const p = declaredService(ctx, s.packageId, s.permissionId, s.operation);
    const scope = await resolveService(
      ctx,
      {
        extensionId: s.packageId,
        permissionId: s.permissionId,
        request: {
          kind: "service",
          operation: s.operation,
          binding: s.binding,
          sources: [],
          input: null,
        },
      },
      p,
    );
    if (scope.effect !== "egress" && scope.effect !== "model-egress") deny();
    const installed = requireInstalled(ctx, s.packageId);
    scopes.push([
      s,
      installed,
      requireManifest(ctx, s.packageId),
      ctx.store.getConsent(s.packageId),
      ctx.store.settingsRevision(s.packageId),
      scope.fingerprint,
      scope.revision,
    ]);
  }
  if (
    state() !== before ||
    !value.scope.services.some((s) => s.packageId === value.ownerId)
  )
    deny();
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        ctx.instanceId,
        value,
        owner,
        manifest,
        ctx.store.getConsent(value.ownerId),
        ctx.store.settingsRevision(value.ownerId),
        trust,
        ctx.store.engineTrustRevision(),
        scopes,
      ]),
    )
    .digest("hex");
  return { ...value, fingerprint };
}
async function audit(
  ctx: ServiceContext,
  grant: Pick<Grant, "id" | "ownerId">,
  phase: "grant" | "revoke",
): Promise<void> {
  const callId = randomUUID();
  try {
    if (!ctx.onAudit) throw Error();
    const event: AuditEvent = {
      callId,
      grantId: grant.id,
      timestamp: new Date().toISOString(),
      extensionId: grant.ownerId,
      kind: "engine",
      phase,
      outcome: phase === "grant" ? "allowed" : "completed",
      executionState: phase === "grant" ? "not_started" : "completed",
    };
    await ctx.onAudit(
      Object.freeze(redact(event, await knownSecrets(ctx)) as AuditEvent),
    );
  } catch {
    throw new PlumsError({
      code: CAPABILITY_FAILED,
      message: "授权审计未能完成。",
      details: {
        callId,
        phase: "audit_" + phase,
        executionState: phase === "grant" ? "not_started" : "completed",
      },
    });
  }
}
export async function createGrant(
  ctx: ServiceContext,
  raw: CreateGrantInput,
): Promise<Grant> {
  const copied = copyJson(raw) as unknown as CreateGrantInput;
  if (
    ![900_000, 3_600_000].includes(copied.durationMs) ||
    typeof copied.fingerprint !== "string"
  )
    throw new TypeError("Invalid grant duration or fingerprint");
  const revision = ctx.store.grantRevision(),
    first = await grantPlan(ctx, copied);
  if (first.fingerprint !== copied.fingerprint) deny();
  const grant: Grant = {
    ...first,
    id: randomUUID(),
    instanceId: ctx.instanceId,
    grantedAt: new Date().toISOString(),
    expiresAt: Date.now() + copied.durationMs,
  };
  await audit(ctx, grant, "grant");
  const next = await grantPlan(ctx, first);
  if (next.fingerprint !== first.fingerprint || Date.now() >= grant.expiresAt)
    deny();
  let saved = false;
  try {
    saved = ctx.store.saveGrantIfCurrent(grant, revision);
  } catch {
    throw new PlumsError({
      code: CAPABILITY_FAILED,
      message: "授权未能保存，没有生效。",
      details: {
        grantId: grant.id,
        phase: "grant_save",
        executionState: "not_started",
      },
    });
  }
  if (!saved) deny();
  return structuredClone(grant);
}
export async function revokeGrant(
  ctx: ServiceContext,
  id: string,
): Promise<void> {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
    throw new TypeError("Invalid grant id");
  const grant = ctx.store.listGrants().find((g) => g.id === id);
  ctx.store.revokeGrant(id);
  if (grant) await audit(ctx, grant, "revoke");
}
export async function checkGrant(
  ctx: ServiceContext,
  id: string,
  ownerId: string,
  use: GrantUse,
): Promise<Grant | undefined> {
  const copied = copyGrantUse(use);
  const grant = ctx.store.listGrants(ownerId).find((g) => g.id === id);
  if (
    !grant ||
    grant.instanceId !== ctx.instanceId ||
    grant.revokedAt ||
    grant.expiresAt <= Date.now() ||
    copied.reads.some((r) => !grant.scope.reads.includes(r)) ||
    copied.outputs.some((r) => !grant.scope.outputs.includes(r))
  )
    return undefined;
  try {
    const plan = await grantPlan(ctx, grant);
    const current = ctx.store.listGrants(ownerId).find((g) => g.id === id);
    return current &&
      !current.revokedAt &&
      current.expiresAt > Date.now() &&
      plan.fingerprint === grant.fingerprint
      ? structuredClone(grant)
      : undefined;
  } catch (error) {
    if (
      error instanceof PlumsError &&
      [PERMISSION_DENIED, "CONSENT_REQUIRED", "EXT_NOT_FOUND"].includes(
        error.code,
      )
    )
      return undefined;
    throw error;
  }
}
export async function capabilityGrant(
  ctx: ServiceContext,
  id: string,
  principals: CapabilityCaller[],
  request: CapabilityRequest,
  use: GrantUse,
): Promise<{ grant: Grant; covered: boolean }> {
  const stored = ctx.store.listGrants().find((g) => g.id === id);
  if (!stored) deny();
  const grant = await checkGrant(ctx, id, stored.ownerId, {
    reads: [],
    outputs: [],
  });
  if (!grant || !principals.some((p) => p.packageId === grant.ownerId)) deny();
  const callerIds = [...new Set(principals.map((p) => p.packageId))].sort(),
    approvedIds = [
      ...new Set(grant.scope.services.map((s) => s.packageId)),
    ].sort();
  if (JSON.stringify(callerIds) !== JSON.stringify(approvedIds)) deny();
  if (
    request.kind !== "service" ||
    use.reads.some((r) => !grant.scope.reads.includes(r)) ||
    use.outputs.some((r) => !grant.scope.outputs.includes(r))
  )
    return { grant, covered: false };
  const requested = principals
    .map((p) =>
      JSON.stringify({
        ...p,
        binding: request.binding,
        operation: request.operation,
      }),
    )
    .sort();
  const available = grant.scope.services
    .filter(
      (s) => s.binding === request.binding && s.operation === request.operation,
    )
    .map((s) =>
      JSON.stringify({
        packageId: s.packageId,
        permissionId: s.permissionId,
        binding: s.binding,
        operation: s.operation,
      }),
    )
    .sort();
  return {
    grant,
    covered: JSON.stringify(requested) === JSON.stringify(available),
  };
}
