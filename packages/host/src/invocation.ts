import semver from "semver";
import { desktopContribution, type ContributionKind } from "@plumsjs/sdk";
import type { Session } from "./host.js";
import type {
  InvocationContext,
  HostFoundationSession,
} from "./foundation-runtime.js";
import {
  resolveProtocol,
  protocolFingerprint,
  protocolDenied,
  sameIntent,
} from "./protocol-bindings.js";

export interface InvocationHooks {
  active(): void;
  runtime(target: string): Promise<HostFoundationSession>;
  retain?(target: string): () => void;
}
/** Both edge types use fixed principals, ancestry and the same asynchronous checkpoint. */
export async function invokeComponent(
  s: Session,
  owner: string,
  request:
    | {
        packageId: string;
        kind: ContributionKind;
        name: string;
        input: unknown;
      }
    | { requirementId: string; input: unknown },
  context: InvocationContext,
  hooks: InvocationHooks,
): Promise<unknown> {
  // Copy before any wait; caller-provided objects cannot redirect the resolved edge.
  const copied = structuredClone(request);
  hooks.active();
  await context.assertActive?.();
  const selected =
    "requirementId" in copied
      ? await resolveProtocol(s.core, s.record, owner, copied.requirementId)
      : undefined;
  const target =
    selected?.providerId ?? (copied as { packageId: string }).packageId;
  const kind =
    selected?.contribution.kind ?? (copied as { kind: ContributionKind }).kind;
  const name = selected?.contribution.name ?? (copied as { name: string }).name;
  if (context.ancestry.includes(target) || context.ancestry.length >= 16)
    protocolDenied("CALL_CYCLE");
  const firstOwner = await s.core.getPackage(owner),
    firstTarget = await s.core.getPackage(target);
  const consumerSettings = await s.core.settingsRevision(owner),
    providerSettings = await s.core.settingsRevision(target);
  const edgePins = () =>
    JSON.stringify([
      s.record.components?.filter(
        (c) => c.packageId === owner || c.packageId === target,
      ),
      s.record.roots,
      s.record.agent.startup,
      s.record.characterId,
      s.record.protocolBindings?.filter(
        (b) => b.consumerId === owner || b.consumerId === target,
      ),
    ]);
  const pins = edgePins();
  const check = async () => {
    hooks.active();
    await context.assertActive?.();
    const currentOwner = await s.core.getPackage(owner),
      currentTarget = await s.core.getPackage(target);
    if (
      !currentOwner.installed.enabled ||
      !currentTarget.installed.enabled ||
      protocolFingerprint(currentOwner.installed) !==
        protocolFingerprint(firstOwner.installed) ||
      protocolFingerprint(currentTarget.installed) !==
        protocolFingerprint(firstTarget.installed) ||
      protocolFingerprint(currentOwner.manifest) !==
        protocolFingerprint(firstOwner.manifest) ||
      protocolFingerprint(currentTarget.manifest) !==
        protocolFingerprint(firstTarget.manifest) ||
      edgePins() !== pins ||
      (await s.core.settingsRevision(owner)) !== consumerSettings ||
      (await s.core.settingsRevision(target)) !== providerSettings
    )
      protocolDenied("CALL_EDGE_CHANGED");
    if (selected) {
      const next = await resolveProtocol(
        s.core,
        s.record,
        owner,
        selected.requirementId,
      );
      if (
        !sameIntent(selected, next) ||
        JSON.stringify(selected) !== JSON.stringify(next)
      )
        protocolDenied("PROTOCOL_BINDING_CHANGED");
    } else if (
      !currentOwner.manifest.dependencies.some(
        (d) =>
          d.id === target &&
          d.kind === currentTarget.manifest.kind &&
          semver.satisfies(currentTarget.manifest.version, d.range),
      )
    )
      protocolDenied("DEPENDENCY_NOT_DECLARED");
    if (
      !desktopContribution(currentTarget.manifest)?.contributes?.[kind]?.some(
        (c) => c.name === name,
      )
    )
      protocolDenied("CONTRIBUTION_NOT_DECLARED");
    hooks.active();
  };
  await check();
  const release = hooks.retain?.(target);
  let runtime: HostFoundationSession | undefined;
  try {
    runtime = await hooks.runtime(target);
    await check();
    return await runtime.invoke(kind, name, copied.input, {
      ...context,
      assertActive: check,
      ancestry: [...context.ancestry, target],
      callers: [...context.callers, { packageId: owner, permissionId: "" }],
    });
  } finally {
    release?.();
    if (context.signal.aborted) runtime?.stop();
    if (runtime && !runtime.alive) await runtime.close();
  }
}
