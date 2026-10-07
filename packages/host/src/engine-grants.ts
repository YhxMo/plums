import { resolveProtocol } from "./protocol-bindings.js";
import {
  PlumsError,
  PERMISSION_DENIED,
  isManifestV2,
  type GrantUse,
  type GrantInput,
  type AuditEvent,
} from "@plums/core";
import type { EngineDeclaration } from "@plums/sdk";
import { configuredConnection } from "./connection-service.js";
import type { Session } from "./host.js";

export interface GrantApproval {
  subject: string;
  targets: string[];
  reads: { id: string; title: string }[];
  outputs: { id: string; title: string }[];
}
export interface GrantChoice extends GrantUse {
  durationMs: number;
}
export type GrantConfirm = (
  request: GrantApproval,
  signal: AbortSignal,
) => Promise<GrantChoice | undefined>;
function denied(): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "授权请求不属于当前引擎声明。",
  });
}
function ids(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 32 ||
    value.some(
      (v) =>
        typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.test(v),
    ) ||
    new Set(value).size !== value.length
  )
    denied();
  return [...value];
}
export async function engineGrant(
  s: Session,
  pkg: string,
  declaration: EngineDeclaration,
  a: Record<string, unknown>,
  signal: AbortSignal,
  confirm: GrantConfirm | undefined,
  audit: (event: AuditEvent) => Promise<void>,
): Promise<unknown> {
  a = structuredClone(a);
  const assertActive = () => {
    if (signal.aborted) denied();
  };
  assertActive();
  const use = (): GrantUse => {
    const reads = ids(a.reads),
      outputs = ids(a.outputs);
    if (
      reads.some(
        (id) => !declaration.grantResources?.reads.some((r) => r.id === id),
      ) ||
      outputs.some(
        (id) => !declaration.grantResources?.outputs.some((r) => r.id === id),
      )
    )
      denied();
    return { reads, outputs };
  };
  if (a.action === "list") {
    const all = (await s.core.listGrants(pkg)).filter(
        (g) => g.engineId === declaration.id,
      ),
      grants = [];
    for (const g of all)
      if (await s.core.checkGrant(g.id, pkg, { reads: [], outputs: [] }))
        grants.push(g);
    assertActive();
    return grants;
  }
  if (a.action === "check") {
    if (typeof a.grantId !== "string") denied();
    const g = await s.core.checkGrant(a.grantId, pkg, use());
    assertActive();
    return g?.engineId === declaration.id ? g : null;
  }
  if (a.action === "revoke") {
    if (
      !(await s.core.listGrants(pkg)).some(
        (g) => g.id === a.grantId && g.engineId === declaration.id,
      )
    )
      denied();
    await s.core.revokeGrant(a.grantId as string);
    return null;
  }
  if (a.action === "audit") {
    if (
      !["read", "write", "run"].includes(a.operation as string) ||
      !["allow", "result"].includes(a.phase as string) ||
      !["not_started", "completed", "unknown"].includes(
        a.executionState as string,
      ) ||
      typeof a.callId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(a.callId)
    )
      denied();
    if (a.grantId !== undefined) {
      const g = await s.core.checkGrant(a.grantId as string, pkg, use());
      if (!g || g.engineId !== declaration.id) denied();
    }
    await audit({
      callId: a.callId,
      ...(a.grantId ? { grantId: a.grantId as string } : {}),
      timestamp: new Date().toISOString(),
      extensionId: pkg,
      kind: "engine",
      target: declaration.id,
      operation: a.operation as string,
      phase: a.phase as "allow" | "result",
      outcome: a.phase === "allow" ? "allowed" : "completed",
      executionState: a.executionState as AuditEvent["executionState"],
    });
    assertActive();
    if (
      a.grantId !== undefined &&
      !(await s.core.checkGrant(a.grantId as string, pkg, use()))
    )
      denied();
    return null;
  }
  if (
    a.action !== "request" ||
    !confirm ||
    (typeof a.packageId !== "string" &&
      typeof a.requirementId !== "string" &&
      a.requirementPath === undefined) ||
    typeof a.connectionId !== "string"
  )
    denied();
  const manifest = (await s.core.getPackage(pkg)).manifest;
  if (!isManifestV2(manifest)) denied();
  const pathBindings: Awaited<ReturnType<typeof resolveProtocol>>[] = [];
  let targetId: string;
  if (a.requirementPath !== undefined) {
    if (
      !Array.isArray(a.requirementPath) ||
      a.requirementPath.length < 1 ||
      a.requirementPath.length > 15 ||
      a.requirementPath.some((v) => typeof v !== "string") ||
      a.requirementId !== undefined ||
      a.packageId !== undefined
    )
      denied();
    targetId = pkg;
    const seen = new Set([pkg]);
    for (const requirementId of a.requirementPath as string[]) {
      const binding = await resolveProtocol(
        s.core,
        s.record,
        targetId,
        requirementId,
      );
      if (seen.has(binding.providerId)) denied();
      seen.add(binding.providerId);
      pathBindings.push(binding);
      targetId = binding.providerId;
    }
  } else {
    const selected =
      typeof a.requirementId === "string"
        ? await resolveProtocol(s.core, s.record, pkg, a.requirementId)
        : undefined;
    if (selected) pathBindings.push(selected);
    targetId = selected?.providerId ?? (a.packageId as string);
    if (!selected && !manifest.dependencies.some((d) => d.id === targetId))
      denied();
  }
  const checkEdge = async () => {
    assertActive();
    for (const binding of pathBindings)
      if (
        JSON.stringify(
          await resolveProtocol(
            s.core,
            s.record,
            binding.consumerId,
            binding.requirementId,
          ),
        ) !== JSON.stringify(binding)
      )
        denied();
  };
  const b = await configuredConnection(
    s.core,
    targetId,
    a.connectionId as string,
  );
  if (!b?.enabled || !b.ready) denied();
  const callerPermission = manifest.permissions.find(
    (p) =>
      "kind" in p &&
      p.kind === "service" &&
      p.target === "https" &&
      p.operations.includes("request"),
  );
  if (!callerPermission) denied();
  const principals = [
    ...new Set([pkg, ...pathBindings.map((p) => p.providerId), b.packageId]),
  ];
  const services: GrantInput["scope"]["services"] = [];
  for (const principal of principals) {
    const m = (await s.core.getPackage(principal)).manifest;
    if (!isManifestV2(m)) denied();
    const permission =
      principal === b.packageId
        ? m.permissions.find((p) => p.id === b.declaration.permissionId)
        : m.permissions.find(
            (p) =>
              p.kind === "service" &&
              p.target === "https" &&
              p.operations.includes("request"),
          );
    if (!permission || permission.kind !== "service") denied();
    services.push({
      packageId: principal,
      permissionId: permission.id,
      binding: b.binding,
      operation: "request",
    });
  }
  const requested = use();
  const input: GrantInput = {
    ownerId: pkg,
    engineId: declaration.id,
    scope: {
      ...requested,
      services,
    },
  };
  const before = await s.core.grantPlan(input);
  const choice = await confirm(
    {
      subject: declaration.title,
      targets: [b.label],
      reads: declaration.grantResources!.reads.filter((r) =>
        requested.reads.includes(r.id),
      ),
      outputs: declaration.grantResources!.outputs.filter((r) =>
        requested.outputs.includes(r.id),
      ),
    },
    signal,
  );
  assertActive();
  if (!choice) return null;
  if (
    ![900_000, 3_600_000].includes(choice.durationMs) ||
    ids(choice.reads).some((r) => !requested.reads.includes(r)) ||
    ids(choice.outputs).some((r) => !requested.outputs.includes(r))
  )
    denied();
  await checkEdge();
  if ((await s.core.grantPlan(input)).fingerprint !== before.fingerprint)
    denied();
  const selectedGrant = await s.core.grantPlan({
    ...input,
    scope: { ...input.scope, reads: choice.reads, outputs: choice.outputs },
  });
  // Freeze the selected scope before persistence; audit and state rechecks happen inside core.
  const grant = await s.core.createGrant({
    ...selectedGrant,
    durationMs: choice.durationMs,
  });
  try {
    await checkEdge();
  } catch {
    await s.core.revokeGrant(grant.id);
    denied();
  }
  if (signal.aborted) {
    await s.core.revokeGrant(grant.id);
    denied();
  }
  return grant;
}
