import { createHash } from "node:crypto";
import {
  PlumsError,
  PERMISSION_DENIED,
  IMPORT_INVALID,
  type Core,
  type Manifest,
} from "@plums/core";
import {
  desktopContribution,
  checkProtocolCompatibility,
  type ProtocolBindingIntent,
  type ProtocolBindingStatus,
  type ProtocolRequirement,
  type ProtocolProvider,
  type ProtocolCompatibility,
  type ProtocolDeclarations,
} from "@plums/sdk";
import type { AgentRecord } from "./host.js";
import type { LibraryItem } from "./library.js";

export interface ProtocolBinding extends ProtocolBindingIntent {
  autoBound?: boolean;
  agentId: string;
  consumerInstalledAt: string;
  providerInstalledAt: string;
  consumerDeclaration: string;
  providerDeclaration: string;
}
export interface ProtocolCandidate {
  name: string;
  enabled: boolean;
  intent: ProtocolBindingIntent;
  compatibility: ProtocolCompatibility;
}
export interface ProtocolRequirementState {
  consumerId: string;
  consumerName: string;
  requirement: ProtocolRequirement;
  state: "bound" | "unbound" | "missing" | "choose" | "stale" | "disabled";
  selected?: ProtocolBindingIntent;
  autoBound?: boolean;
  candidates: ProtocolCandidate[];
}
interface Component {
  digest: string;
  manifest: Manifest;
  enabled: boolean;
  installedAt: string;
}
export function protocolFingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function protocolDenied(reason = "PROTOCOL_BINDING_UNAVAILABLE"): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "组件连接尚不可用，请在管理页选择兼容组件并启用。",
    path: "/protocolBindings",
    details: { reason, executionState: "not_started" },
  });
}
function intent(
  consumer: Component,
  requirement: ProtocolRequirement,
  provider: Component,
  provided: ProtocolProvider,
): ProtocolBindingIntent {
  return {
    consumerId: consumer.manifest.id,
    consumerDigest: consumer.digest,
    requirementId: requirement.id,
    providerId: provider.manifest.id,
    providerDigest: provider.digest,
    provideId: provided.id,
    protocolVersion: provided.version,
    contribution: {
      kind: provided.contribution.kind,
      name: provided.contribution.name,
    },
  };
}
export function sameIntent(
  a: ProtocolBindingIntent,
  b: ProtocolBindingIntent,
): boolean {
  return (
    [
      "consumerId",
      "consumerDigest",
      "requirementId",
      "providerId",
      "providerDigest",
      "provideId",
      "protocolVersion",
    ].every(
      (k) =>
        a[k as keyof ProtocolBindingIntent] ===
        b[k as keyof ProtocolBindingIntent],
    ) &&
    a.contribution?.kind === b.contribution.kind &&
    a.contribution?.name === b.contribution.name
  );
}
function discover(
  components: Component[],
  selections: ProtocolBindingIntent[],
): ProtocolRequirementState[] {
  const protocols = new Map<Component, ProtocolDeclarations | undefined>();
  // Reuse only this discovery's declarations, preserving first-validation order.
  const protocolsFor = (component: Component) => {
    if (!protocols.has(component))
      protocols.set(
        component,
        desktopContribution(component.manifest)?.protocols,
      );
    return protocols.get(component);
  };
  return components.flatMap((consumer) =>
    (protocolsFor(consumer)?.requires ?? []).map((requirement) => {
      const candidates: ProtocolCandidate[] = components
        .filter((p) => p !== consumer)
        .flatMap((provider) =>
          (protocolsFor(provider)?.provides ?? [])
            .filter((p) => p.protocol === requirement.protocol)
            .map((provided) => ({
              name: provider.manifest.name,
              enabled: provider.enabled,
              intent: intent(consumer, requirement, provider, provided),
              compatibility: checkProtocolCompatibility(requirement, provided),
            })),
        );
      const selected = selections.find(
        (b) =>
          b.consumerId === consumer.manifest.id &&
          b.requirementId === requirement.id,
      );
      const match =
        selected &&
        candidates.find(
          (c) => c.compatibility.compatible && sameIntent(selected, c.intent),
        );
      const count = candidates.filter((c) => c.compatibility.compatible).length;
      return {
        consumerId: consumer.manifest.id,
        consumerName: consumer.manifest.name,
        requirement: structuredClone(requirement),
        state: selected
          ? match
            ? match.enabled
              ? "bound"
              : "disabled"
            : "stale"
          : count
            ? count > 1
              ? "choose"
              : "unbound"
            : "missing",
        ...(selected ? { selected: structuredClone(selected) } : {}),
        candidates,
      };
    }),
  );
}
async function components(
  core: Core,
  record: AgentRecord,
): Promise<Component[]> {
  const installed = await core.listInstalled();
  const result: Component[] = [];
  for (const pin of record.components ?? []) {
    if (!installed.some((p) => p.id === pin.packageId)) continue;
    const p = await core.getPackage(pin.packageId);
    result.push({
      digest: pin.digest,
      manifest: p.manifest,
      enabled: p.installed.enabled,
      installedAt: p.installed.installedAt,
    });
  }
  return result;
}
export function assemblyProtocols(
  items: LibraryItem[],
  selections: ProtocolBindingIntent[] = [],
) {
  return discover(
    items.map((p) => ({
      digest: p.digest,
      manifest: p.manifest,
      enabled: false,
      installedAt: "",
    })),
    selections,
  );
}
/** Fill only empty slots. Stale selections and explicit portable intents keep priority. */
export function automaticProtocolChoices(
  states: ProtocolRequirementState[],
): ProtocolBindingIntent[] {
  return states
    .filter((s) => s.state === "unbound")
    .map((s) =>
      structuredClone(
        s.candidates.find((c) => c.compatibility.compatible)!.intent,
      ),
    );
}
export function requireProtocolSelections(
  states: ProtocolRequirementState[],
  consumerId?: string,
): void {
  if (
    states.some(
      (s) =>
        (!consumerId || s.consumerId === consumerId) &&
        !s.requirement.optional &&
        !["bound", "disabled"].includes(s.state),
    )
  )
    throw new PlumsError({
      code: IMPORT_INVALID,
      message: "请先为必需的组件连接选择兼容提供者。",
      path: "/protocolBindings",
      details: { reason: "PROTOCOL_BINDING_REQUIRED" },
    });
}
/** A selected protocol edge and a concrete dependency participate in the same cycle check. */
export function protocolOrder(
  manifests: Manifest[],
  states: ProtocolRequirementState[],
): string[] {
  const done = new Set<string>(),
    visiting = new Set<string>(),
    order: string[] = [];
  const visit = (id: string) => {
    if (done.has(id)) return;
    if (visiting.has(id))
      throw new PlumsError({
        code: IMPORT_INVALID,
        message: "组件连接与依赖不能形成循环。",
        path: "/protocolBindings",
        details: { reason: "PROTOCOL_CYCLE" },
      });
    visiting.add(id);
    for (const d of manifests.find((m) => m.id === id)?.dependencies ?? [])
      if (!d.optional) visit(d.id);
    for (const s of states)
      if (
        s.consumerId === id &&
        s.selected &&
        ["bound", "disabled"].includes(s.state)
      )
        visit(s.selected.providerId);
    visiting.delete(id);
    done.add(id);
    order.push(id);
  };
  manifests.forEach((m) => visit(m.id));
  return order;
}
export async function protocolPlan(core: Core, record: AgentRecord) {
  const items = await components(core, record);
  const states = discover(items, record.protocolBindings ?? []);
  for (const state of states) {
    const fixed = record.protocolBindings?.find(
      (b) =>
        b.consumerId === state.consumerId &&
        b.requirementId === state.requirement.id,
    );
    if (fixed && !validIdentity(record, items, fixed)) state.state = "stale";
    if (fixed?.autoBound) state.autoBound = true;
  }
  return {
    fingerprint: protocolFingerprint([
      record.instanceId,
      record.components,
      record.roots,
      record.agent.startup,
      record.characterId,
      record.protocolBindings,
      items,
    ]),
    requirements: states,
  };
}
function validIdentity(
  record: AgentRecord,
  items: Component[],
  fixed: ProtocolBinding,
): boolean {
  const consumer = items.find((p) => p.manifest.id === fixed.consumerId),
    provider = items.find((p) => p.manifest.id === fixed.providerId);
  return (
    fixed.agentId === record.instanceId &&
    !!consumer &&
    !!provider &&
    consumer.installedAt === fixed.consumerInstalledAt &&
    provider.installedAt === fixed.providerInstalledAt &&
    protocolFingerprint(consumer.manifest) === fixed.consumerDeclaration &&
    protocolFingerprint(provider.manifest) === fixed.providerDeclaration
  );
}
export async function fixProtocolBinding(
  core: Core,
  record: AgentRecord,
  choice: ProtocolBindingIntent,
): Promise<ProtocolBinding> {
  const plan = await protocolPlan(core, record);
  const candidate = plan.requirements
    .find(
      (s) =>
        s.consumerId === choice.consumerId &&
        s.requirement.id === choice.requirementId,
    )
    ?.candidates.find(
      (c) => c.compatibility.compatible && sameIntent(choice, c.intent),
    );
  if (!candidate) protocolDenied("PROTOCOL_SELECTION_CHANGED");
  const items = await components(core, record),
    consumer = items.find((p) => p.manifest.id === choice.consumerId)!,
    provider = items.find((p) => p.manifest.id === choice.providerId)!;
  return {
    ...structuredClone(candidate.intent),
    agentId: record.instanceId,
    consumerInstalledAt: consumer.installedAt,
    providerInstalledAt: provider.installedAt,
    consumerDeclaration: protocolFingerprint(consumer.manifest),
    providerDeclaration: protocolFingerprint(provider.manifest),
  };
}
export async function protocolStatus(
  core: Core,
  record: AgentRecord,
  consumerId: string,
  requirementId: string,
): Promise<ProtocolBindingStatus> {
  const state = (await protocolPlan(core, record)).requirements.find(
    (s) => s.consumerId === consumerId && s.requirement.id === requirementId,
  );
  if (!state) protocolDenied("PROTOCOL_REQUIREMENT_NOT_DECLARED");
  if (
    state.state === "bound" &&
    (await core.getPackage(consumerId)).installed.enabled
  )
    return {
      state: "available",
      requirementId,
      providerId: state.selected!.providerId,
      provideId: state.selected!.provideId,
      protocolVersion: state.selected!.protocolVersion,
    };
  return {
    state:
      state.state === "stale"
        ? "stale"
        : state.state === "bound" || state.state === "disabled"
          ? "disabled"
          : "unbound",
    requirementId,
    optional: state.requirement.optional === true,
  };
}
export async function resolveProtocol(
  core: Core,
  record: AgentRecord,
  consumerId: string,
  requirementId: string,
) {
  const status = await protocolStatus(core, record, consumerId, requirementId);
  if (status.state !== "available")
    protocolDenied(
      status.state === "stale"
        ? "PROTOCOL_BINDING_STALE"
        : status.state === "disabled"
          ? "PROTOCOL_PROVIDER_DISABLED"
          : "PROTOCOL_UNBOUND",
    );
  return structuredClone(
    record.protocolBindings!.find(
      (b) => b.consumerId === consumerId && b.requirementId === requirementId,
    )!,
  );
}
