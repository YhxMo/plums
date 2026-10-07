import { randomUUID } from "node:crypto";
import { PlumsError } from "@plums/core";
import {
  desktopContribution,
  parseCommonEnvelope,
  negotiateCommonContract,
  type CommonActor,
  type CommonBinding,
} from "@plums/sdk";
import type { Session } from "./host.js";
import type { InvocationContext } from "./foundation-runtime.js";
import {
  protocolPlan,
  protocolFingerprint,
  resolveProtocol,
} from "./protocol-bindings.js";
import { resourceFailure } from "./resource-error.js";
import { CommonTasks } from "./common-tasks.js";
interface Hooks {
  active(s: Session): void;
  controlledAllowed(s: Session): Promise<void>;
  context(
    s: Session,
    pkg: string,
    signal?: AbortSignal,
  ): Promise<InvocationContext>;
  invoke(
    s: Session,
    pkg: string,
    requirementId: string,
    input: unknown,
    context: InvocationContext,
  ): Promise<unknown>;
  sanitize(s: Session, value: unknown): Promise<unknown>;
  takeoverQualified(
    s: Session,
    owner: string,
    viewer: string,
  ): Promise<boolean>;
  audit(
    s: Session,
    callId: string,
    taskId: string,
    outcome: "allowed" | "completed" | "failed",
    state: "not_started" | "unknown" | "completed",
  ): Promise<void>;
}
export class CommonService {
  readonly tasks: CommonTasks;
  private componentCalls = new Map<Session, Map<string, Set<object>>>();
  private taskEdges = new Map<
    string,
    {
      s: Session;
      owner: string;
      requirementId: string;
      selected: string;
      principals: string[];
      checkpoint: { assertCurrent(): void };
    }
  >();
  private viewers = new Map<
    string,
    Map<
      string,
      {
        signature: string;
        requirementId: string;
        selected: string;
        checkpoint: { assertCurrent(): void };
      }
    >
  >();
  async takeoverPlan(s: Session, taskId: string) {
    const edge = this.taskEdges.get(taskId);
    if (!edge || edge.s !== s) return [];
    try {
      edge.checkpoint.assertCurrent();
      const original = await resolveProtocol(
        s.core,
        s.record,
        edge.owner,
        edge.requirementId,
      );
      if (JSON.stringify(original) !== edge.selected) return [];
      const plan = await protocolPlan(s.core, s.record);
      const candidates = plan.requirements.filter(
        (r) =>
          r.consumerId !== edge.owner &&
          r.state === "bound" &&
          r.selected?.providerId === original.providerId &&
          r.selected.provideId === original.provideId,
      );
      const out = [];
      for (const r of candidates) {
        if (
          !desktopContribution((await s.core.getPackage(r.consumerId)).manifest)
            ?.common ||
          !(await this.hooks.takeoverQualified(s, edge.owner, r.consumerId))
        )
          continue;
        out.push({
          componentId: r.consumerId,
          name: r.consumerName,
          allowed: this.viewers.get(taskId)?.has(r.consumerId) ?? false,
        });
      }
      return out;
    } catch {
      return [];
    }
  }
  async permitTakeover(
    s: Session,
    taskId: string,
    componentId: string,
    enabled: boolean,
  ) {
    const edge = this.taskEdges.get(taskId);
    if (!edge || edge.s !== s) throw resourceFailure("STALE_BINDING");
    if (!enabled) {
      this.viewers.get(taskId)?.delete(componentId);
      return;
    }
    edge.checkpoint.assertCurrent();
    if (!(await this.hooks.takeoverQualified(s, edge.owner, componentId)))
      throw resourceFailure("NOT_AUTHORIZED");
    const owner = await this.identity(s, componentId),
      original = await resolveProtocol(
        s.core,
        s.record,
        edge.owner,
        edge.requirementId,
      );
    if (JSON.stringify(original) !== edge.selected)
      throw resourceFailure("STALE_BINDING");
    const plan = await protocolPlan(s.core, s.record),
      candidate = plan.requirements.find(
        (r) =>
          r.consumerId === componentId &&
          r.state === "bound" &&
          r.selected?.providerId === original.providerId &&
          r.selected.provideId === original.provideId,
      );
    if (
      !candidate ||
      !desktopContribution((await s.core.getPackage(componentId)).manifest)
        ?.common
    )
      throw resourceFailure("INCOMPATIBLE");
    const selected = await resolveProtocol(
      s.core,
      s.record,
      componentId,
      candidate.requirement.id,
    );
    let viewers = this.viewers.get(taskId);
    if (!viewers) {
      viewers = new Map();
      this.viewers.set(taskId, viewers);
    }
    viewers.set(componentId, {
      signature: owner.signature,
      requirementId: candidate.requirement.id,
      selected: JSON.stringify(selected),
      checkpoint: s.core.runtimeAccessCheckpoint([
        ...edge.principals,
        componentId,
      ]),
    });
  }
  private async taskPrincipal(s: Session, taskId: string, pkg: string) {
    const current = await this.identity(s, pkg),
      edge = this.taskEdges.get(taskId);
    if (!edge) return current;
    edge.checkpoint.assertCurrent();
    if (edge.owner === pkg) return current;
    const viewer = this.viewers.get(taskId)?.get(pkg);
    if (!viewer || viewer.signature !== current.signature || edge.s !== s)
      throw resourceFailure("NOT_AUTHORIZED");
    viewer.checkpoint.assertCurrent();
    if (!(await this.hooks.takeoverQualified(s, edge.owner, pkg)))
      throw resourceFailure("NOT_AUTHORIZED");
    if (
      JSON.stringify(
        await resolveProtocol(s.core, s.record, pkg, viewer.requirementId),
      ) !== viewer.selected ||
      JSON.stringify(
        await resolveProtocol(s.core, s.record, edge.owner, edge.requirementId),
      ) !== edge.selected
    )
      throw resourceFailure("STALE_BINDING");
    return this.identity(s, edge.owner);
  }
  private identities = new WeakMap<
    Session,
    Map<
      string,
      {
        actor: CommonActor;
        signature: string;
        checkpoint: { assertCurrent(): void };
      }
    >
  >();
  private handles = new Map<
    string,
    {
      s: Session;
      owner: string;
      instance: string;
      requirementId: string;
      selected: string;
      binding: CommonBinding;
      checkpoint: { assertCurrent(): void };
    }
  >();
  constructor(
    directory: string,
    private hooks: Hooks,
  ) {
    this.tasks = new CommonTasks(directory);
  }
  async identity(s: Session, pkg: string) {
    this.hooks.active(s);
    let map = this.identities.get(s);
    if (!map) {
      map = new Map();
      this.identities.set(s, map);
    }
    const p = await s.core.getPackage(pkg),
      pin = s.record.components?.find((c) => c.packageId === pkg);
    if (!p.installed.enabled || !pin) throw resourceFailure("NOT_AUTHORIZED");
    const signature = protocolFingerprint([
      p.installed.installedAt,
      p.manifest,
      pin,
      await s.core.settingsRevision(pkg),
    ]);
    let old = map.get(pkg);
    const generation = old?.actor.generation ?? 0;
    if (old) {
      try {
        old.checkpoint.assertCurrent();
      } catch {
        old = undefined;
      }
    }
    if (!old || old.signature !== signature) {
      old = {
        signature,
        checkpoint: s.core.runtimeAccessCheckpoint([pkg]),
        actor: {
          agentId: s.record.instanceId,
          componentId: pkg,
          installId: protocolFingerprint([p.installed.installedAt, pin]),
          artifactDigest: pin.digest,
          instanceId: randomUUID(),
          generation: generation + 1,
        },
      };
      map.set(pkg, old);
    }
    return old;
  }
  private async binding(
    s: Session,
    pkg: string,
    requirementId: string,
    context: InvocationContext,
  ) {
    const selected = await resolveProtocol(
        s.core,
        s.record,
        pkg,
        requirementId,
      ),
      owner = await this.identity(s, pkg),
      provider = await this.identity(s, selected.providerId);
    const declaration = desktopContribution(
      (await s.core.getPackage(selected.providerId)).manifest,
    )?.protocols?.provides?.find((p) => p.id === selected.provideId);
    if (!declaration) throw resourceFailure("INCOMPATIBLE");
    const instance =
      context.frontend?.handle ??
      context.resourceInstanceId ??
      owner.actor.instanceId;
    for (const h of this.handles.values())
      if (
        h.s === s &&
        h.owner === pkg &&
        h.instance === instance &&
        h.selected === JSON.stringify(selected)
      ) {
        try {
          h.checkpoint.assertCurrent();
          return structuredClone(h.binding);
        } catch {}
      }
    if (this.handles.size >= 4096) throw resourceFailure("LIMIT_EXCEEDED");
    const b: CommonBinding = {
      handle: randomUUID(),
      revision: provider.actor.generation,
      requirementId,
      protocol: declaration.protocol,
      protocolVersion: declaration.version,
      features: [...(declaration.features ?? [])],
      provider: provider.actor,
      evidence: "declared",
    };
    this.handles.set(b.handle, {
      s,
      owner: pkg,
      instance,
      requirementId,
      selected: JSON.stringify(selected),
      binding: b,
      checkpoint: s.core.runtimeAccessCheckpoint([pkg, selected.providerId]),
    });
    return structuredClone(b);
  }
  async call(
    s: Session,
    pkg: string,
    method: string,
    args: Record<string, unknown>,
    context: InvocationContext,
  ) {
    const copied = structuredClone(args);
    this.hooks.active(s);
    await context.assertActive?.();
    if (context.engineScope || context.signal.aborted)
      throw resourceFailure("NOT_AUTHORIZED");
    const declaration = desktopContribution(
      (await s.core.getPackage(pkg)).manifest,
    )?.common;
    if (!declaration) throw resourceFailure("INCOMPATIBLE");
    if (
      !negotiateCommonContract(declaration, [
        "resources-cas",
        "events",
        "task-attach",
        "controlled-node",
        "controlled-exec",
        "policy-v1",
        "ui-attach",
      ]).compatible
    )
      throw resourceFailure("INCOMPATIBLE");
    const owner = await this.identity(s, pkg),
      origin =
        context.frontend?.handle ??
        context.resourceInstanceId ??
        owner.actor.instanceId;
    switch (method) {
      case "stateWait":
        await new Promise((r) => setTimeout(r, 250));
        await context.assertActive?.();
        return null;
      case "listTasks": {
        const visible = [];
        for (const t of this.tasks.list(s.record.instanceId)) {
          try {
            const principal = await this.taskPrincipal(
              s,
              t.description.taskId,
              pkg,
            );
            this.tasks.status(
              t.description.taskId,
              principal.actor,
              principal.signature,
            );
            visible.push(t.description);
          } catch {}
        }
        await context.assertActive?.();
        return structuredClone(visible);
      }
      case "wait":
        await new Promise((r) => setTimeout(r, 20));
        await context.assertActive?.();
        return null;
      case "binding":
        return this.binding(
          s,
          pkg,
          String(copied.requirementId),
          context,
        ).catch((e) => {
          if ((e as any).details?.reason === "PROTOCOL_UNBOUND") return null;
          throw e;
        });
      case "discover": {
        const plan = await protocolPlan(s.core, s.record),
          state = plan.requirements.find(
            (r) =>
              r.consumerId === pkg && r.requirement.id === copied.requirementId,
          );
        if (!state) throw resourceFailure("INVALID_REQUEST");
        // Discovery never installs a connection; only the management-selected edge gets a callable handle.
        const found: CommonBinding[] = [];
        for (const candidate of state.candidates.filter(
          (c) => c.compatibility.compatible && c.enabled,
        )) {
          if (
            state.state === "bound" &&
            candidate.intent.providerId === state.selected?.providerId &&
            candidate.intent.provideId === state.selected?.provideId
          ) {
            found.push(
              await this.binding(s, pkg, String(copied.requirementId), context),
            );
            continue;
          }
          const provider = await this.identity(s, candidate.intent.providerId),
            manifest = (await s.core.getPackage(candidate.intent.providerId))
              .manifest;
          const provided = desktopContribution(
            manifest,
          )?.protocols?.provides?.find(
            (p) => p.id === candidate.intent.provideId,
          );
          if (!provided) continue;
          found.push({
            handle: randomUUID(),
            revision: provider.actor.generation,
            requirementId: state.requirement.id,
            protocol: provided.protocol,
            protocolVersion: provided.version,
            features: [...(provided.features ?? [])],
            provider: provider.actor,
            evidence: "declared",
          });
        }
        return found;
      }
      case "create": {
        await this.hooks.controlledAllowed(s);
        const options = copied.options as {
          lifetime: "frontend" | "agent";
          timeoutMs?: number;
        };
        if (
          options?.lifetime === "agent" &&
          (!declaration.background ||
            !s.record.backgroundComponents?.includes(pkg))
        )
          throw resourceFailure("NOT_AUTHORIZED");
        return this.tasks.create(
          owner.actor,
          owner.signature,
          origin,
          options?.lifetime,
          options?.timeoutMs,
        );
      }
      case "status": {
        const p = await this.taskPrincipal(s, String(copied.taskId), pkg);
        return this.tasks.status(String(copied.taskId), p.actor, p.signature);
      }
      case "poll": {
        const p = await this.taskPrincipal(s, String(copied.taskId), pkg);
        return this.tasks.poll(
          String(copied.taskId),
          p.actor,
          p.signature,
          copied.afterSequence as number,
        );
      }
      case "ack": {
        const p = await this.taskPrincipal(s, String(copied.taskId), pkg);
        if (copied.sequence !== -1)
          this.tasks.acknowledge(
            String(copied.taskId),
            p.actor,
            p.signature,
            copied.sequence as number,
          );
        return null;
      }
      case "cancel": {
        const p = await this.taskPrincipal(s, String(copied.taskId), pkg);
        await this.tasks.stop(String(copied.taskId), p.actor, p.signature);
        return null;
      }
      case "emit":
        if (!context.taskId) throw resourceFailure("NOT_AUTHORIZED");
        return this.tasks.emitCall(
          context.taskId,
          String(copied.channel),
          await this.hooks.sanitize(s, copied.data),
        );
      case "invoke": {
        await this.hooks.controlledAllowed(s);
        const handle = this.handles.get(String(copied.binding));
        if (
          !handle ||
          handle.s !== s ||
          handle.owner !== pkg ||
          handle.instance !== origin
        )
          throw resourceFailure("STALE_BINDING");
        handle.checkpoint.assertCurrent();
        if (
          JSON.stringify(
            await resolveProtocol(s.core, s.record, pkg, handle.requirementId),
          ) !== handle.selected
        )
          throw resourceFailure("STALE_BINDING");
        const options = (copied.options ?? {}) as {
          taskId?: string;
          timeoutMs?: number;
        };
        const request = parseCommonEnvelope({
          commonVersion: "1.0",
          kind: "invoke",
          callId: randomUUID(),
          binding: handle.binding.handle,
          operation: copied.operation,
          input: copied.input,
          ...(options.timeoutMs === undefined
            ? {}
            : { timeoutMs: options.timeoutMs }),
        });
        if (request.kind !== "invoke") throw resourceFailure("INVALID_REQUEST");
        const task = options.taskId
          ? this.tasks.describe(options.taskId, owner.actor, owner.signature)
          : this.tasks.create(
              owner.actor,
              owner.signature,
              origin,
              "frontend",
              options.timeoutMs,
            );
        const chain = s.core.runtimeAccessCheckpoint(context.ancestry);
        this.tasks.shorten(
          task.taskId,
          owner.actor,
          owner.signature,
          options.timeoutMs,
        );
        const startedCall = await this.tasks.start(
          task.taskId,
          owner.actor,
          owner.signature,
          request.callId,
          async (signal, started) => {
            let executionState: "not_started" | "unknown" | "completed" =
              "not_started";
            try {
              const base = await this.hooks.context(
                s,
                pkg,
                context.taskId
                  ? AbortSignal.any([signal, context.signal])
                  : signal,
              );
              const check = async () => {
                chain.assertCurrent();
                await base.assertActive?.();
                handle.checkpoint.assertCurrent();
                if (
                  JSON.stringify(
                    await resolveProtocol(
                      s.core,
                      s.record,
                      pkg,
                      handle.requirementId,
                    ),
                  ) !== handle.selected
                )
                  throw resourceFailure("STALE_BINDING");
              };
              await check();
              await this.hooks.audit(
                s,
                request.callId,
                task.taskId,
                "allowed",
                "not_started",
              );
              await check();
              const value = await this.hooks.invoke(
                s,
                pkg,
                handle.requirementId,
                { operation: request.operation, input: request.input },
                {
                  ...base,
                  callers: [...context.callers],
                  ancestry: [...context.ancestry],
                  grantId: context.grantId,
                  grantScope: context.grantScope,
                  taskId: task.taskId,
                  commonCallId: request.callId,
                  onDispatch: () => {
                    executionState = "unknown";
                    started();
                  },
                  assertActive: check,
                },
              );
              executionState = "completed";
              await check();
              const clean = await this.hooks.sanitize(s, value);
              await this.hooks.audit(
                s,
                request.callId,
                task.taskId,
                "completed",
                "completed",
              );
              await check();
              return clean;
            } catch (error) {
              if (
                error instanceof PlumsError &&
                (error.details as { executionState?: string })
                  ?.executionState === "completed"
              )
                executionState = "completed";
              try {
                await this.hooks.audit(
                  s,
                  request.callId,
                  task.taskId,
                  "failed",
                  executionState,
                );
              } catch {}
              const reason =
                error instanceof PlumsError
                  ? (error.details as { reason?: string })?.reason
                  : undefined;
              if (
                error instanceof PlumsError &&
                error.code === "PERMISSION_DENIED"
              )
                throw resourceFailure(
                  "NOT_AUTHORIZED",
                  request.callId,
                  executionState,
                );
              if (executionState === "completed")
                throw resourceFailure(
                  "PROVIDER_FAILED",
                  request.callId,
                  "completed",
                );
              if (reason) throw error;
              throw resourceFailure(
                "PROVIDER_FAILED",
                request.callId,
                executionState,
              );
            }
          },
        );
        this.taskEdges.set(task.taskId, {
          s,
          owner: pkg,
          requirementId: handle.requirementId,
          selected: handle.selected,
          principals: [
            ...context.ancestry,
            handle.binding.provider.componentId,
          ],
          checkpoint: s.core.runtimeAccessCheckpoint([
            ...context.ancestry,
            handle.binding.provider.componentId,
          ]),
        });
        return startedCall;
      }
      default:
        throw resourceFailure("INVALID_REQUEST");
    }
  }
  closeOrigin(origin: string) {
    for (const [id, h] of this.handles)
      if (h.instance === origin) this.handles.delete(id);
    this.tasks.closeOrigin(origin);
  }
  usesComponent(s: Session, componentId: string) {
    if (this.componentCalls.get(s)?.get(componentId)?.size) return true;
    return [...this.taskEdges].some(
      ([taskId, edge]) =>
        edge.s === s &&
        edge.principals.includes(componentId) &&
        this.tasks.isActive(taskId),
    );
  }
  retainComponent(s: Session, componentId: string, taskId?: string) {
    if (!taskId || !this.tasks.isActive(taskId)) return () => {};
    const components =
      this.componentCalls.get(s) ?? new Map<string, Set<object>>();
    this.componentCalls.set(s, components);
    const calls = components.get(componentId) ?? new Set<object>();
    components.set(componentId, calls);
    const call = {};
    calls.add(call);
    return () => {
      calls.delete(call);
      if (!calls.size) components.delete(componentId);
      if (!components.size) this.componentCalls.delete(s);
    };
  }
  async stopAgent(s: Session) {
    for (const [id, h] of this.handles) if (h.s === s) this.handles.delete(id);
    await this.tasks.stopAgent(s.record.instanceId);
    this.identities.delete(s);
    for (const [id, e] of this.taskEdges)
      if (e.s === s) {
        this.taskEdges.delete(id);
        this.viewers.delete(id);
      }
  }
}
