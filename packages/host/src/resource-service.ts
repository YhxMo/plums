import { resourceAuditEvent } from "./audit-presentation.js";
import { randomUUID } from "node:crypto";
import {
  redact,
  PlumsError,
  type AuditEvent,
  type ResourceAccessInput,
  type ResourceAccessCheckpoint,
  type InstalledPackage,
} from "@plumsjs/core";
import {
  desktopContribution,
  parseCommonEnvelope,
  type ResourceDescription,
  type ResourceOperation,
  type CommonJson,
  type CommonExecutionState,
  type CommonErrorCode,
} from "@plumsjs/sdk";
import type { Session } from "./host.js";
import type { InvocationContext } from "./foundation-runtime.js";
import { ResourceStore, type ResourceBindingRecord } from "./resource-store.js";
import { resourceFailure } from "./resource-error.js";
import { protocolFingerprint } from "./protocol-bindings.js";

export const resourceOperations: ResourceOperation[] = [
  "read",
  "write",
  "delete",
];
export function validOperations(value: unknown): ResourceOperation[] {
  if (
    !Array.isArray(value) ||
    value.some((v) => !resourceOperations.includes(v)) ||
    new Set(value).size !== value.length
  )
    throw resourceFailure("INVALID_REQUEST");
  return [...value];
}
export function resourceInstallation(
  s: Session,
  componentId: string,
  installed: InstalledPackage,
): string {
  const pin = s.record.components?.find((p) => p.packageId === componentId);
  if (!pin) throw resourceFailure("NOT_AUTHORIZED");
  return protocolFingerprint([
    [installed.id, installed.kind, installed.version, installed.installedAt],
    pin,
  ]);
}
export interface ResourceRangeSelection {
  componentId: string;
  resourceId: string;
  operations: ResourceOperation[];
}
export interface ResourceRange {
  id: string;
  mode: "task" | "full-access";
  expiresAt: string;
  selection: ResourceRangeSelection[];
}
interface Lease extends ResourceRange {
  session: Session;
  controller: AbortController;
  epoch: number;
  expires: number;
  installations: string;
  checkpoints: ResourceAccessCheckpoint[];
}
interface Handle {
  session: Session;
  instance: string;
  packageId: string;
  binding: ResourceBindingRecord;
  checkpoint: ResourceAccessCheckpoint;
  epoch: number;
  controller: AbortController;
}
interface Hooks {
  active(s: Session): void;
  coreFile(s: Session): string;
  audit(s: Session, event: AuditEvent): Promise<void>;
  secrets(s: Session): Promise<string[]>;
  confirm(s: Session, message: string, signal: AbortSignal): Promise<boolean>;
  policy(
    s: Session,
    op: import("./policy-service.js").PolicyOperation,
  ): Promise<import("./policy-service.js").PolicyCheckpoint | undefined>;
  fault?: (phase: "before-commit" | "after-commit") => void;
}
export class ResourceService {
  private handles = new Map<string, Handle>();
  private leases = new Map<string, Lease>();
  constructor(
    readonly store: ResourceStore,
    private hooks: Hooks,
  ) {}
  invalidate(agentId: string, components?: string[]) {
    const lease = this.leases.get(agentId);
    if (
      !components ||
      lease?.selection.some((v) => components.includes(v.componentId))
    )
      this.leases.delete(agentId);
    for (const [id, h] of this.handles)
      if (
        h.session.record.instanceId === agentId &&
        (!components || components.includes(h.packageId))
      )
        this.handles.delete(id);
  }
  close() {
    this.handles.clear();
    this.leases.clear();
    this.store.close();
  }
  async status(s: Session) {
    const lease = this.leases.get(s.record.instanceId);
    if (lease && lease.installations !== (await this.installations(s)))
      this.leases.delete(s.record.instanceId);
    return this.range(s);
  }
  range(s: Session): ResourceRange | undefined {
    const l = this.leases.get(s.record.instanceId);
    if (
      !l ||
      l.session !== s ||
      l.controller !== s.controller ||
      l.epoch !== this.store.epoch(s.record.instanceId) ||
      performance.now() >= l.expires
    )
      return undefined;
    try {
      l.checkpoints.forEach((c) => c.assertCurrent());
    } catch {
      this.leases.delete(s.record.instanceId);
      return undefined;
    }
    return {
      id: l.id,
      mode: l.mode,
      expiresAt: l.expiresAt,
      selection: structuredClone(l.selection),
    };
  }
  async grant(
    s: Session,
    mode: ResourceRange["mode"],
    durationMs: number,
    selections: ResourceRangeSelection[],
  ) {
    if (
      !["task", "full-access"].includes(mode) ||
      ![900_000, 3_600_000].includes(durationMs) ||
      !Array.isArray(selections) ||
      !selections.length ||
      selections.length > 256
    )
      throw resourceFailure("INVALID_REQUEST");
    const selection = structuredClone(selections).map((v) => ({
      ...v,
      operations: validOperations(v.operations),
    }));
    if (
      selection.some((v) => !v.operations.length) ||
      new Set(
        selection.map((v) => JSON.stringify([v.componentId, v.resourceId])),
      ).size !== selection.length
    )
      throw resourceFailure("INVALID_REQUEST");
    const epoch = this.store.epoch(s.record.instanceId),
      controller = s.controller;
    const inputs: ResourceAccessInput[] = [];
    for (const chosen of selection) {
      const space = this.store.space(chosen.resourceId);
      const actor = await s.core.getPackage(chosen.componentId);
      const bindings = this.store
        .bindings(s.record.instanceId)
        .filter(
          (b) =>
            b.componentId === chosen.componentId &&
            b.resourceId === chosen.resourceId &&
            b.installation ===
              resourceInstallation(s, chosen.componentId, actor.installed),
        );
      for (const op of chosen.operations) {
        const b = bindings.find((b) =>
          this.demand(
            s,
            chosen.componentId,
            actor.manifest,
            b.requirementId,
          )?.operations.includes(op),
        );
        const requirement =
          b &&
          this.demand(s, chosen.componentId, actor.manifest, b.requirementId);
        if (
          !requirement ||
          (mode === "task" &&
            !this.qualified(s, chosen.componentId, chosen.resourceId, op))
        )
          throw resourceFailure("NOT_AUTHORIZED");
        inputs.push({
          packageId: chosen.componentId,
          permissionId: requirement.permissionId,
          scope: space.scope,
          operation: op,
        });
      }
    }
    // More than 16 inputs may represent many operations, while each call remains <=16 actors.
    const checkpoints = inputs.map((i) => s.core.resourceAccessCheckpoint([i]));
    const installations = await this.installations(s);
    const id = randomUUID();
    await this.emit(s, {
      callId: id,
      kind: "resource",
      phase: "task",
      outcome: "allowed",
      executionState: "not_started",
      durationMs,
      resourceMode: mode,
      resourceScope: selection,
    });
    this.hooks.active(s);
    checkpoints.forEach((c) => c.assertCurrent());
    if (
      controller !== s.controller ||
      controller.signal.aborted ||
      epoch !== this.store.epoch(s.record.instanceId)
    )
      throw resourceFailure("STALE_BINDING");
    const lease: Lease = {
      id,
      mode,
      selection,
      session: s,
      controller,
      epoch,
      installations,
      checkpoints,
      expires: performance.now() + durationMs,
      expiresAt: new Date(Date.now() + durationMs).toISOString(),
    };
    this.leases.set(s.record.instanceId, lease);
    return this.range(s)!;
  }
  private async installations(s: Session) {
    return protocolFingerprint(await s.core.listInstalled());
  }
  private demand(
    _s: Session,
    _pkg: string,
    manifest: Parameters<typeof desktopContribution>[0],
    id: string,
  ) {
    return desktopContribution(manifest)?.common?.resources?.find(
      (r) => r.id === id,
    );
  }
  private qualified(
    s: Session,
    pkg: string,
    id: string,
    op: ResourceOperation,
  ) {
    const space = this.store.space(id),
      agent = s.record.instanceId;
    return (
      (space.scope !== "agent" || space.ownerAgentId === agent) &&
      this.store.operations(id, agent, "").includes(op) &&
      this.store.operations(id, agent, pkg).includes(op)
    );
  }
  private covered(
    s: Session,
    pkg: string,
    id: string,
    op: ResourceOperation,
    lease?: Lease,
  ) {
    return (
      !!lease &&
      !!this.range(s) &&
      this.leases.get(s.record.instanceId) === lease &&
      lease.selection.some(
        (v) =>
          v.componentId === pkg &&
          v.resourceId === id &&
          v.operations.includes(op),
      )
    );
  }
  private async resolve(
    s: Session,
    pkg: string,
    context: InvocationContext,
    b: ResourceBindingRecord,
    op: ResourceOperation,
    lease?: Lease,
  ) {
    if (context.signal.aborted) throw resourceFailure("NOT_AUTHORIZED");
    const actor = await s.core.getPackage(pkg),
      space = this.store.space(b.resourceId);
    const d = this.demand(s, pkg, actor.manifest, b.requirementId);
    if (b.installation !== resourceInstallation(s, pkg, actor.installed))
      throw resourceFailure("STALE_BINDING");
    if (!d?.operations.includes(op)) throw resourceFailure("NOT_AUTHORIZED");
    const full =
      lease?.mode === "full-access" &&
      this.covered(s, pkg, b.resourceId, op, lease);
    if (!full && !this.qualified(s, pkg, b.resourceId, op))
      throw resourceFailure("NOT_AUTHORIZED");
    return {
      packageId: pkg,
      permissionId: d.permissionId,
      scope: space.scope,
      operation: op,
    } as ResourceAccessInput;
  }
  /** Trusted task viewers must retain every bound resource qualification of the owner. */
  async takeoverQualified(s: Session, owner: string, viewer: string) {
    const bindings = this.store.bindings(s.record.instanceId),
      lease = this.leases.get(s.record.instanceId);
    const context = { signal: s.controller.signal } as InvocationContext;
    try {
      for (const b of bindings.filter((b) => b.componentId === owner)) {
        const manifest = (await s.core.getPackage(owner)).manifest;
        for (const op of this.demand(s, owner, manifest, b.requirementId)
          ?.operations ?? []) {
          const original = await this.resolve(s, owner, context, b, op, lease);
          s.core.resourceAccessCheckpoint([original]).assertCurrent();
          if (this.range(s) && !this.covered(s, owner, b.resourceId, op, lease))
            return false;
          let covered = false;
          for (const v of bindings.filter(
            (v) => v.componentId === viewer && v.resourceId === b.resourceId,
          )) {
            try {
              const input = await this.resolve(
                s,
                viewer,
                context,
                v,
                op,
                lease,
              );
              s.core.resourceAccessCheckpoint([input]).assertCurrent();
              if (
                !this.range(s) ||
                this.covered(s, viewer, b.resourceId, op, lease)
              )
                covered = true;
            } catch {}
          }
          if (!covered) return false;
        }
      }
      return true;
    } catch {
      return false;
    }
  }
  async call(
    s: Session,
    pkg: string,
    method: string,
    args: Record<string, unknown>,
    context: InvocationContext,
  ): Promise<unknown> {
    // Clone before the first wait, validate JSON with the same limits as the common transport.
    const callId = randomUUID();
    let a: Record<string, unknown>;
    try {
      a = structuredClone(args);
    } catch {
      throw resourceFailure("INVALID_REQUEST", callId);
    }
    let state: CommonExecutionState = "not_started",
      phase = "authorization";
    let known: string[] = [];
    const refreshing = this.hooks.secrets(s).then((v) => {
      known.push(...v);
    });
    const audit = async (e: Omit<AuditEvent, "timestamp">) => {
      await refreshing;
      known.push(...(await this.hooks.secrets(s)));
      await this.hooks.audit(
        s,
        freezeAudit(
          resourceAuditEvent(
            { ...e, timestamp: new Date().toISOString() },
            known,
          ),
        ),
      );
    };
    try {
      await refreshing;
      await context.assertActive?.();
      this.hooks.active(s);
      if (context.signal.aborted || !context.resourceInstanceId)
        throw resourceFailure("NOT_AUTHORIZED");
      const agent = s.record.instanceId,
        epoch = this.store.epoch(agent),
        lease = this.leases.get(agent);
      if (lease && (await this.installations(s)) !== lease.installations)
        this.leases.delete(agent);
      const actors = [...context.callers.map((c) => c.packageId), pkg];
      if (
        actors.length > 16 ||
        new Set(actors).size !== actors.length ||
        JSON.stringify(actors) !== JSON.stringify(context.ancestry)
      )
        throw resourceFailure("NOT_AUTHORIZED");
      const runtimeController = () =>
        context.engineScope ? s.engineController : s.controller;
      const controller = runtimeController();
      const authorityFor = async (
        target: ResourceBindingRecord,
        op: ResourceOperation,
      ) => {
        await context.assertActive?.();
        this.hooks.active(s);
        if (
          context.signal.aborted ||
          controller !== runtimeController() ||
          controller.signal.aborted ||
          epoch !== this.store.epoch(agent)
        )
          throw resourceFailure("STALE_BINDING");
        const inputs: ResourceAccessInput[] = [];
        for (const actor of actors) {
          // Caller demands may use their own slot name; resolve checks the actual declared slot.
          const candidates =
            actor === pkg
              ? [target]
              : this.store
                  .bindings(agent)
                  .filter(
                    (b) =>
                      b.componentId === actor &&
                      b.resourceId === target.resourceId,
                  );
          let input: ResourceAccessInput | undefined;
          for (const candidate of candidates) {
            try {
              input = await this.resolve(
                s,
                actor,
                context,
                candidate,
                op,
                lease,
              );
              break;
            } catch {}
          }
          if (!input) throw resourceFailure("NOT_AUTHORIZED");
          inputs.push(input);
        }
        if (
          this.range(s) &&
          !actors.every((actor) =>
            this.covered(s, actor, target.resourceId, op, lease),
          )
        )
          throw resourceFailure("NOT_AUTHORIZED");
        await context.assertActive?.();
        if (
          context.signal.aborted ||
          controller !== runtimeController() ||
          controller.signal.aborted ||
          epoch !== this.store.epoch(agent)
        )
          throw resourceFailure("STALE_BINDING");
        return s.core.resourceAccessCheckpoint(inputs);
      };
      if (method === "list") {
        const out: ResourceDescription[] = [];
        for (const b of this.store
          .bindings(agent)
          .filter((b) => b.componentId === pkg)) {
          const operations: ResourceOperation[] = [];
          for (const op of resourceOperations) {
            try {
              const opCheck = await authorityFor(b, op);
              opCheck.assertCurrent();
              operations.push(op);
            } catch {
              /* Unavailable bindings are not revealed. */
            }
          }
          if (!operations.length) continue;
          const space = this.store.space(b.resourceId);
          const checkpoint = s.core.resourceAccessCheckpoint([
            await this.resolve(s, pkg, context, b, operations[0]!, lease),
          ]);
          const existing = [...this.handles].find(
            ([_id, v]) =>
              v.session === s &&
              v.packageId === pkg &&
              v.instance === context.resourceInstanceId &&
              v.epoch === epoch &&
              v.binding.requirementId === b.requirementId,
          );
          let binding = existing?.[0];
          if (existing) {
            try {
              existing[1].checkpoint.assertCurrent();
            } catch {
              this.handles.delete(existing[0]);
              binding = undefined;
            }
          }
          if (!binding) {
            if (this.handles.size >= 4096)
              throw resourceFailure("LIMIT_EXCEEDED");
            binding = randomUUID();
          }
          this.handles.set(binding, {
            session: s,
            packageId: pkg,
            instance: context.resourceInstanceId,
            binding: b,
            checkpoint,
            epoch,
            controller,
          });
          out.push({
            binding,
            requirementId: b.requirementId,
            resourceId: b.resourceId,
            scope: space.scope,
            ...(space.ownerAgentId ? { ownerAgentId: space.ownerAgentId } : {}),
            operations,
            generation: epoch,
          });
        }
        await context.assertActive?.();
        this.hooks.active(s);
        if (epoch !== this.store.epoch(agent) || context.signal.aborted)
          throw resourceFailure("STALE_BINDING");
        return out;
      }
      if (
        !resourceOperations.includes(method as ResourceOperation) ||
        typeof a.binding !== "string" ||
        typeof a.key !== "string" ||
        a.key.includes("\0") ||
        Buffer.byteLength(a.key) > 256 ||
        (method !== "read" &&
          (typeof a.expectedRevision !== "string" ||
            a.expectedRevision.length > 128))
      )
        throw resourceFailure("INVALID_REQUEST");
      const op = method as ResourceOperation,
        h = this.handles.get(a.binding);
      if (
        !h ||
        h.session !== s ||
        h.packageId !== pkg ||
        h.instance !== context.resourceInstanceId ||
        h.epoch !== epoch ||
        h.controller !== controller
      )
        throw resourceFailure("STALE_BINDING");
      let value: CommonJson | undefined;
      if (op === "write")
        value = (
          parseCommonEnvelope({
            commonVersion: "1.0",
            kind: "invoke",
            callId,
            binding: a.binding,
            operation: op,
            input: a.value,
          }) as Extract<
            ReturnType<typeof parseCommonEnvelope>,
            { kind: "invoke" }
          >
        ).input;
      const assertHandle = () => {
        if (this.handles.get(a.binding as string) !== h)
          throw resourceFailure("STALE_BINDING");
        try {
          h.checkpoint.assertCurrent();
        } catch {
          this.handles.delete(a.binding as string);
          throw resourceFailure("STALE_BINDING");
        }
      };
      let policy: import("./policy-service.js").PolicyCheckpoint | undefined;
      const check = async () => {
        await policy?.recheck();
        assertHandle();
        return authorityFor(h.binding, op);
      };
      let checkpoint = await check();
      const reusable = actors.every((actor) =>
        this.covered(s, actor, h.binding.resourceId, op, lease),
      );
      policy = await this.hooks.policy(s, {
        permissionId: (
          await this.resolve(s, pkg, context, h.binding, op, lease)
        ).permissionId,
        packageId: pkg,
        callId,
        category: "resource",
        requiresConfirmation: !reusable && !this.range(s),
        operation: op,
        target: h.binding.resourceId,
        intent: {
          resourceId: h.binding.resourceId,
          key: a.key as string,
          ...(value === undefined ? {} : { value }),
        },
        fingerprintInput: a,
        context,
      });
      checkpoint = await check();
      if (!reusable && !policy) {
        // An active maximum scope cannot be enlarged by a one-off question.
        if (this.range(s)) throw resourceFailure("NOT_AUTHORIZED");
        phase = "confirmation";
        await audit({
          callId,
          kind: "resource",
          extensionId: pkg,
          callerIds: actors.slice(0, -1),
          operation: op,
          phase: "confirmation",
          outcome: "requested",
          executionState: state,
        });
        checkpoint = await check();
        const space = this.store.space(h.binding.resourceId);
        const message = `允许 ${pkg} 在「${space.name}」中${op === "read" ? "读取" : op === "write" ? "写入" : "删除"}一条记录？`;
        const allowed =
          (await this.hooks.confirm(
            s,
            redact(message, known),
            context.signal,
          )) === true;
        await audit({
          callId,
          kind: "resource",
          extensionId: pkg,
          callerIds: actors.slice(0, -1),
          operation: op,
          phase: "confirmation",
          outcome: allowed ? "allowed" : "denied",
          executionState: state,
        });
        if (!allowed) throw resourceFailure("NOT_AUTHORIZED");
        checkpoint = await check();
      }
      phase = "audit";
      await audit({
        callId,
        kind: "resource",
        extensionId: pkg,
        callerIds: actors.slice(0, -1),
        operation: op,
        phase: "allow",
        outcome: "allowed",
        executionState: state,
        ...(reusable ? { taskId: lease!.id } : {}),
      });
      checkpoint = await check();
      phase = "commit";
      let result: unknown;
      result = this.store.transaction(() => {
        if (op !== "read") this.hooks.fault?.("before-commit");
        policy?.assertCurrent();
        assertHandle();
        checkpoint.assertCurrent();
        this.hooks.active(s);
        if (
          context.signal.aborted ||
          h.controller !== runtimeController() ||
          h.controller.signal.aborted ||
          epoch !== this.store.epoch(agent) ||
          (reusable &&
            !actors.every((actor) =>
              this.covered(s, actor, h.binding.resourceId, op, lease),
            ))
        )
          throw resourceFailure("STALE_BINDING");
        if (op === "read")
          return this.store.read(h.binding.resourceId, a.key as string);
        if (
          this.store.read(h.binding.resourceId, a.key as string).revision !==
          a.expectedRevision
        )
          throw resourceFailure("RESOURCE_CONFLICT");
        state = "unknown";
        return this.store.mutate(
          h.binding.resourceId,
          a.key as string,
          a.expectedRevision as string,
          value,
          callId,
        );
      }, this.hooks.coreFile(s));
      state = "completed";
      if (op !== "read") {
        phase = "response";
        try {
          this.hooks.fault?.("after-commit");
        } catch {
          state = "unknown";
          throw resourceFailure("PROVIDER_FAILED", callId, state, phase);
        }
      }
      phase = "result_audit";
      await audit({
        callId,
        kind: "resource",
        extensionId: pkg,
        callerIds: actors.slice(0, -1),
        operation: op,
        phase: "result",
        outcome: "completed",
        executionState: state,
      });
      return result;
    } catch (error) {
      const candidate =
        error instanceof PlumsError
          ? (error.details as { reason?: string } | undefined)?.reason
          : undefined;
      const safeReasons: CommonErrorCode[] = [
        "INVALID_REQUEST",
        "POLICY_UNAVAILABLE",
        "STALE_BINDING",
        "NOT_AUTHORIZED",
        "RESOURCE_CONFLICT",
        "RESOURCE_NOT_FOUND",
        "LIMIT_EXCEEDED",
        "PROVIDER_FAILED",
        "RUNTIME_UNAVAILABLE",
      ];
      const reason: CommonErrorCode = safeReasons.includes(
        candidate as CommonErrorCode,
      )
        ? (candidate as CommonErrorCode)
        : candidate === "COMMON_CONTRACT_INVALID"
          ? "INVALID_REQUEST"
          : error instanceof PlumsError
            ? "NOT_AUTHORIZED"
            : "PROVIDER_FAILED";
      try {
        await audit({
          callId,
          kind: "resource",
          extensionId: pkg,
          phase: "denied",
          outcome: "failed",
          executionState: state,
          reason,
        });
      } catch {}
      throw resourceFailure(reason, callId, state, phase);
    }
  }
  private async emit(s: Session, e: Omit<AuditEvent, "timestamp">) {
    try {
      const known = await this.hooks.secrets(s);
      await this.hooks.audit(
        s,
        freezeAudit(
          resourceAuditEvent(
            { ...e, timestamp: new Date().toISOString() },
            known,
          ),
        ),
      );
    } catch {
      throw resourceFailure(
        "PROVIDER_FAILED",
        e.callId,
        "not_started",
        "audit",
      );
    }
  }
}

function freezeAudit(event: AuditEvent): AuditEvent {
  if (event.callerIds) Object.freeze(event.callerIds);
  if (event.resourceScope) {
    for (const s of event.resourceScope) {
      Object.freeze(s.operations);
      Object.freeze(s);
    }
    Object.freeze(event.resourceScope);
  }
  return Object.freeze(event);
}
