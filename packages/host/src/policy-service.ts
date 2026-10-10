import { policyAuditEvent } from "./audit-presentation.js";
import { createHash, randomUUID } from "node:crypto";
import { redact, type AuditEvent } from "@plums/core";
import {
  desktopContribution,
  parseCommonPolicyDecision,
  type CommonOperationContext,
  type CommonJson,
} from "@plums/sdk";
import type { Session } from "./host.js";
import type { InvocationContext } from "./foundation-runtime.js";
import { resourceFailure } from "./resource-error.js";

export interface PolicyBinding {
  providerId: string;
  provideId: string;
  artifactDigest: string;
  installation: string;
  declaration: string;
  mode: string;
}
export interface PolicyScopeSelection {
  componentId: string;
  category: CommonOperationContext["category"];
  operation: string;
  target: string;
}
export interface PolicyOperation {
  permissionId?: string;
  packageId: string;
  callId: string;
  category: CommonOperationContext["category"];
  operation: string;
  target: string;
  intent: CommonJson;
  requiresConfirmation: boolean;
  fingerprintInput: unknown;
  required?: {
    category: CommonOperationContext["category"];
    operation: string;
    target: string;
  }[];
  context: InvocationContext;
  /** Trusted host authorization; never accepted from an extension or SDK input. */
  localAuthorization?: {
    tier: "project" | "machine";
    fingerprint: string;
    recheck(): Promise<void>;
  };
}
export interface PolicyCheckpoint {
  assertCurrent(): void;
  recheck(): Promise<void>;
  signal: AbortSignal;
  deadline: number;
}
interface Hooks {
  active(s: Session): void;
  expired(s: Session, packages: string[]): Promise<void>;
  deadline(s: Session, taskId?: string): number | undefined;
  actor(
    s: Session,
    id: string,
  ): Promise<CommonOperationContext["actors"][number]>;
  snapshot(s: Session): string;
  resources(s: Session):
    | {
        expiresAt: string;
        selection: {
          componentId: string;
          resourceId: string;
          operations: string[];
        }[];
      }
    | undefined;
  evaluate(
    s: Session,
    binding: PolicyBinding,
    input: CommonOperationContext,
    signal: AbortSignal,
    check: () => Promise<void>,
  ): Promise<unknown>;
  secrets(s: Session): Promise<string[]>;
  audit(s: Session, event: AuditEvent): Promise<void>;
  confirm(s: Session, message: string, signal: AbortSignal): Promise<boolean>;
}
interface Lease {
  session: Session;
  controller: AbortController;
  sessionController: AbortController;
  timer?: ReturnType<typeof setTimeout>;
  generation: number;
  expires: number;
  expiresAt: number;
  selection: PolicyScopeSelection[];
  snapshot: string;
  checkpoint: { assertCurrent(): void };
}
/** Sorted JSON keys bind a decision to the exact host-copied operation. Never logged. */
export function operationFingerprint(value: unknown): string {
  const normalize = (v: any): any => {
    if (v instanceof Uint8Array)
      return { bytes: Buffer.from(v).toString("base64") };
    if (Array.isArray(v)) return v.map(normalize);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, normalize(v[k])]),
      );
    return v;
  };
  return createHash("sha256")
    .update(JSON.stringify(normalize(value)))
    .digest("hex");
}
export class PolicyService {
  private leases = new Map<string, Lease>();
  private generations = new Map<string, number>();
  private stopping = new Map<string, Promise<void>>();
  private invalidations = new Map<
    string,
    { generation: number; providerId?: string }
  >();
  private stopExpired(s: Session, l: Lease) {
    const id = s.record.instanceId;
    if (this.stopping.has(id)) return;
    const stopped = this.hooks.expired(s, [
      ...new Set(l.selection.map((v) => v.componentId)),
    ]);
    this.stopping.set(id, stopped);
    void stopped
      .finally(() => {
        if (this.stopping.get(id) === stopped) this.stopping.delete(id);
      })
      .catch(() => {});
  }
  async settled(id: string) {
    const stopped = this.stopping.get(id);
    if (stopped) await stopped;
  }
  constructor(private hooks: Hooks) {}
  invalidate(id: string, providerId?: string) {
    const l = this.leases.get(id);
    clearTimeout(l?.timer);
    l?.controller.abort();
    this.leases.delete(id);
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.invalidations.set(id, {
      generation: this.generations.get(id)!,
      providerId,
    });
  }
  private current(s: Session, l: Lease) {
    this.hooks.active(s);
    if (
      this.leases.get(s.record.instanceId) !== l ||
      l.session !== s ||
      l.sessionController !== s.controller ||
      l.controller.signal.aborted ||
      performance.now() >= l.expires ||
      this.hooks.snapshot(s) !== l.snapshot
    )
      throw resourceFailure("STALE_BINDING");
    l.checkpoint.assertCurrent();
  }
  state(s: Session) {
    const l = this.leases.get(s.record.instanceId);
    if (!l) return null;
    try {
      this.current(s, l);
    } catch {
      this.invalidate(s.record.instanceId);
      // A status read can observe monotonic expiry before the timer callback.
      // Invalidating clears that timer, so this path must also stop instances.
      this.stopExpired(s, l);
      return null;
    }
    return {
      modeGeneration: l.generation,
      expiresAt: l.expiresAt,
      selection: structuredClone(l.selection),
    };
  }
  async candidate(
    s: Session,
    providerId: string,
    provideId: string,
    mode: string,
  ): Promise<PolicyBinding> {
    const p = await s.core.getPackage(providerId),
      d = desktopContribution(p.manifest),
      pin = s.record.components?.find((p) => p.packageId === providerId);
    const provided = d?.protocols?.provides?.find((p) => p.id === provideId);
    if (
      !p.installed.enabled ||
      !pin ||
      !d?.runtime ||
      d.common?.policy?.provideId !== provideId ||
      provided?.protocol !== "org.plums.policy" ||
      provided.version !== "1.0.0" ||
      provided.contribution.kind !== "tools" ||
      !(await s.core.getConsent(providerId)) ||
      typeof mode !== "string" ||
      !/^[a-zA-Z0-9_.-]{1,64}$/.test(mode)
    )
      throw resourceFailure("INCOMPATIBLE");
    return {
      providerId,
      provideId,
      artifactDigest: pin.digest,
      installation: operationFingerprint([p.installed.installedAt, pin]),
      declaration: operationFingerprint(p.manifest),
      mode,
    };
  }
  async grant(
    s: Session,
    durationMs: number,
    input: PolicyScopeSelection[],
    available: PolicyScopeSelection[],
  ) {
    // The management plan itself can observe expiry after its earlier status check.
    await this.settled(s.record.instanceId);
    if (
      !s.record.policy ||
      ![900_000, 3_600_000].includes(durationMs) ||
      !Array.isArray(input) ||
      !input.length ||
      input.length > 1024
    )
      throw resourceFailure("INVALID_REQUEST");
    const selection = structuredClone(input),
      keys = selection.map(operationFingerprint),
      allowed = new Set(available.map(operationFingerprint));
    if (new Set(keys).size !== keys.length || keys.some((k) => !allowed.has(k)))
      throw resourceFailure("NOT_AUTHORIZED");
    if (
      JSON.stringify(
        await this.candidate(
          s,
          s.record.policy.providerId,
          s.record.policy.provideId,
          s.record.policy.mode,
        ),
      ) !== JSON.stringify(s.record.policy)
    )
      throw resourceFailure("STALE_BINDING");
    const checkpoint = s.core.runtimeAccessCheckpoint(
      (await s.core.listInstalled()).filter((p) => p.enabled).map((p) => p.id),
    );
    this.invalidate(s.record.instanceId);
    const l: Lease = {
      session: s,
      controller: new AbortController(),
      sessionController: s.controller,
      generation: this.generations.get(s.record.instanceId)!,
      selection,
      checkpoint,
      snapshot: this.hooks.snapshot(s),
      expires: performance.now() + durationMs,
      expiresAt: Date.now() + durationMs,
    };
    await this.hooks.audit(
      s,
      policyAuditEvent(
        {
          callId: randomUUID(),
          timestamp: new Date().toISOString(),
          phase: "task",
          outcome: "allowed",
          executionState: "not_started",
          reason: "POLICY_SCOPE_GRANTED",
          durationMs,
        },
        await this.hooks.secrets(s),
      ),
    );
    checkpoint.assertCurrent();
    this.hooks.active(s);
    if (
      s.controller !== l.sessionController ||
      s.controller.signal.aborted ||
      this.hooks.snapshot(s) !== l.snapshot ||
      this.generations.get(s.record.instanceId) !== l.generation
    )
      throw resourceFailure("STALE_BINDING");
    this.leases.set(s.record.instanceId, l);
    l.timer = setTimeout(() => {
      this.invalidate(s.record.instanceId);
      this.stopExpired(s, l);
    }, durationMs);
    l.timer.unref();
    return this.state(s);
  }
  async assess(
    s: Session,
    op: PolicyOperation,
  ): Promise<PolicyCheckpoint | undefined> {
    if (op.context.policyEvaluation)
      throw resourceFailure("POLICY_UNAVAILABLE", op.callId);
    const binding = s.record.policy;
    if (!binding) return undefined;
    const firstSecrets = this.hooks.secrets(s);
    void firstSecrets.catch(() => {});
    const local = op.category === "local" ? op.localAuthorization : undefined;
    if (op.category === "local" && !local)
      throw resourceFailure("NOT_AUTHORIZED", op.callId);
    const l = local ? undefined : this.leases.get(s.record.instanceId);
    const providerCurrent = async () => {
      try {
        return (
          s.record.policy === binding &&
          JSON.stringify(
            await this.candidate(
              s,
              binding.providerId,
              binding.provideId,
              binding.mode,
            ),
          ) === JSON.stringify(binding)
        );
      } catch {
        return false;
      }
    };
    let fallback = !(await providerCurrent());
    if (fallback && !op.requiresConfirmation)
      throw resourceFailure("POLICY_UNAVAILABLE", op.callId);
    if (!local && !l && !fallback)
      throw resourceFailure("POLICY_UNAVAILABLE", op.callId);
    const tier =
      local?.tier ?? (await s.core.localAuthorizationState()).tier.ceiling;
    const scopeSnapshot = this.hooks.snapshot(s);
    const generation =
      l?.generation ?? this.generations.get(s.record.instanceId) ?? 0;
    const executionController = s.engineController;
    const selection: PolicyScopeSelection[] = local
      ? [
          {
            componentId: op.packageId,
            category: "local",
            operation: op.operation,
            target: op.target,
          },
        ]
      : (l?.selection ?? chainSelection(op));
    const range = this.hooks.resources(s);
    const maximumExpiresAt =
      local || !l
        ? (this.hooks.deadline(s, op.context.taskId) ?? Date.now() + 120_000)
        : Math.min(
            l!.expiresAt,
            range && op.category === "resource"
              ? Date.parse(range.expiresAt)
              : l!.expiresAt,
            s.core.taskScopeState()?.expiresAt ?? l!.expiresAt,
          );
    const deadline = Math.min(
      op.context.deadline ?? Infinity,
      this.hooks.deadline(s, op.context.taskId) ?? Date.now() + 120_000,
      maximumExpiresAt,
    );
    const remainingMs = Math.max(0, Math.ceil(deadline - Date.now()));
    const budgetExpires = performance.now() + remainingMs;
    const operationSignal = AbortSignal.any([
      op.context.signal,
      local ? executionController.signal : s.controller.signal,
      AbortSignal.timeout(remainingMs),
    ]);
    const chain = [...op.context.ancestry];
    if (
      !chain.length ||
      chain[chain.length - 1] !== op.packageId ||
      new Set(chain).size !== chain.length ||
      chain.length > 16
    )
      throw resourceFailure("NOT_AUTHORIZED", op.callId);
    const checkpoint = s.core.runtimeAccessCheckpoint(chain);
    let providerCheckpoint:
      | ReturnType<Session["core"]["runtimeAccessCheckpoint"]>
      | undefined;
    const checkSync = () => {
      if (fallback) {
        this.hooks.active(s);
        if (this.hooks.snapshot(s) !== scopeSnapshot)
          throw resourceFailure("STALE_BINDING", op.callId);
        if (
          l &&
          (l.controller.signal.aborted ||
            this.leases.get(s.record.instanceId) !== l)
        ) {
          const invalidation = this.invalidations.get(s.record.instanceId);
          if (
            invalidation?.providerId !== binding.providerId ||
            invalidation.generation !== generation + 1
          )
            throw resourceFailure("STALE_BINDING", op.callId);
        }
      } else if (l) this.current(s, l);
      else {
        this.hooks.active(s);
        if (
          s.engineController !== executionController ||
          executionController.signal.aborted ||
          (this.generations.get(s.record.instanceId) ?? 0) !== generation
        )
          throw resourceFailure("STALE_BINDING", op.callId);
      }
      checkpoint.assertCurrent();
      if (!fallback) providerCheckpoint?.assertCurrent();
      if (
        operationSignal.aborted ||
        performance.now() >= budgetExpires ||
        (!fallback && s.record.policy !== binding)
      )
        throw resourceFailure("STALE_BINDING", op.callId);
      if (
        !local &&
        !chain.every((componentId) =>
          selection.some(
            (v) =>
              v.componentId === componentId &&
              v.category === op.category &&
              v.operation === op.operation &&
              v.target === op.target,
          ),
        )
      )
        throw resourceFailure("NOT_AUTHORIZED", op.callId);
      for (const required of op.required ?? [])
        if (
          !chain.every((componentId) =>
            selection.some(
              (v) =>
                v.componentId === componentId &&
                v.category === required.category &&
                v.operation === required.operation &&
                v.target === required.target,
            ),
          )
        )
          throw resourceFailure("NOT_AUTHORIZED", op.callId);
      if (op.category === "resource") {
        const range = this.hooks.resources(s);
        if (
          !range ||
          !chain.every((id) =>
            range.selection.some(
              (v) =>
                v.componentId === id &&
                v.resourceId === op.target &&
                v.operations.includes(op.operation),
            ),
          )
        )
          throw resourceFailure("NOT_AUTHORIZED", op.callId);
      }
    };
    const check = async () => {
      checkSync();
      await op.context.assertActive?.();
      if (local) await local.recheck();
      if (!fallback && providerCheckpoint) {
        if (
          JSON.stringify(
            await this.candidate(
              s,
              binding.providerId,
              binding.provideId,
              binding.mode,
            ),
          ) !== JSON.stringify(binding)
        )
          throw resourceFailure("STALE_BINDING", op.callId);
      }
      checkSync();
    };
    await check();
    const actors = await Promise.all(
      chain.map((id) => this.hooks.actor(s, id)),
    );
    const assessmentId = randomUUID(),
      fingerprint = operationFingerprint({
        actors,
        tier,
        requiresConfirmation: op.requiresConfirmation,
        callId: op.callId,
        taskId: op.context.taskId ?? op.callId,
        category: op.category,
        operation: op.operation,
        target: op.target,
        input: op.fingerprintInput,
        ...(local ? { localAuthorization: local.fingerprint } : {}),
        maximum: selection,
        modeGeneration: generation,
      });
    const secrets = new Set(await firstSecrets);
    for (const secret of await this.hooks.secrets(s)) secrets.add(secret);
    const intent = redact(op.intent, [...secrets]) as CommonJson;
    const context: CommonOperationContext = {
      deadline,
      assessmentId,
      operationFingerprint: fingerprint,
      callId: op.callId,
      taskId: op.context.taskId ?? op.callId,
      actors,
      category: op.category,
      operation: op.operation,
      target: op.target,
      tier,
      requiresConfirmation: op.requiresConfirmation,
      ...(op.permissionId ? { permissionId: op.permissionId } : {}),
      intent,
      maximum: {
        operations: [
          ...new Set(selection.map((v) => v.category + ":" + v.operation)),
        ],
        resourceIds: [
          ...new Set(
            selection
              .filter((v) => v.category === "resource")
              .map((v) => v.target),
          ),
        ],
        expiresAt: maximumExpiresAt,
        selection: structuredClone(selection),
      },
      modeGeneration: generation,
    };
    const emit = async (
      outcome: AuditEvent["outcome"],
      phase: AuditEvent["phase"] = "policy",
      reason?: string,
    ) => {
      for (const v of await this.hooks.secrets(s)) secrets.add(v);
      const event = policyAuditEvent(
        {
          callId: op.callId,
          taskId: context.taskId,
          assessmentId,
          modeGeneration: generation,
          providerId: binding.providerId,
          artifactDigest: binding.artifactDigest,
          mode: binding.mode,
          operationFingerprint: fingerprint,
          tier,
          ...(reason ? { reason } : {}),
          timestamp: new Date().toISOString(),
          phase,
          outcome,
          executionState: "not_started",
          extensionId: op.packageId,
          callerIds: chain.slice(0, -1),
          ...(local
            ? {
                kind: "engine",
                target: op.target,
                operation: op.operation,
              }
            : {}),
        },
        [...secrets],
      );
      Object.freeze(event.callerIds);
      await this.hooks.audit(s, Object.freeze(event));
      await check();
    };
    await emit("requested");
    context.intent = redact(op.intent, [...secrets]) as CommonJson;
    let decision: ReturnType<typeof parseCommonPolicyDecision>;
    const controller = new AbortController();
    const signal = AbortSignal.any([
      operationSignal,
      controller.signal,
      ...(l ? [l.controller.signal] : []),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      if (fallback) throw resourceFailure("POLICY_UNAVAILABLE", op.callId);
      providerCheckpoint = s.core.runtimeAccessCheckpoint([binding.providerId]);
      await check();
      const unavailable = new Promise<never>((_, reject) => {
        abort = () => reject(resourceFailure("POLICY_UNAVAILABLE", op.callId));
        signal.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => controller.abort(), 10_000);
        if (signal.aborted) abort();
      });
      decision = parseCommonPolicyDecision(
        await Promise.race([
          this.hooks.evaluate(
            s,
            binding,
            structuredClone(context),
            signal,
            check,
          ),
          unavailable,
        ]),
      );
      if (
        decision.assessmentId !== assessmentId ||
        decision.operationFingerprint !== fingerprint
      )
        throw Error();
    } catch {
      controller.abort();
      if (!op.requiresConfirmation) {
        await emit("failed", "policy", "POLICY_FAILED");
        throw resourceFailure("POLICY_UNAVAILABLE", op.callId);
      }
      fallback = true;
      await check();
      await emit("failed", "policy", "POLICY_FAILED");
      decision = {
        assessmentId,
        operationFingerprint: fingerprint,
        decision: "confirm",
      };
    } finally {
      clearTimeout(timer);
      if (abort) signal.removeEventListener("abort", abort);
    }
    await check();
    if (!fallback)
      await emit(
        decision.decision === "deny" ? "denied" : "allowed",
        "policy",
        "POLICY_" + decision.decision.toUpperCase(),
      );
    if (decision.decision === "deny")
      throw resourceFailure("NOT_AUTHORIZED", op.callId);
    if (decision.decision === "confirm" && !local) {
      const reason = fallback ? "POLICY_FAILED" : "POLICY_CONFIRM";
      await emit("requested", "confirmation", reason);
      const message = redact(
        `策略请求确认。Agent：${s.record.name}。调用链：${chain.join(" → ")}。操作：${op.category}/${op.operation}。目标：${op.target}。意图：${JSON.stringify(redact(op.intent, [...secrets]))}。有效期至：${new Date(context.maximum.expiresAt).toISOString()}。允许本次操作吗？`,
        [...secrets],
      );
      const allowed =
        (await this.hooks.confirm(
          s,
          message,
          fallback || !l
            ? operationSignal
            : AbortSignal.any([operationSignal, l.controller.signal]),
        )) === true;
      await emit(allowed ? "allowed" : "denied", "confirmation", reason);
      if (!allowed) throw resourceFailure("NOT_AUTHORIZED", op.callId);
    }
    await check();
    return {
      assertCurrent: checkSync,
      recheck: check,
      signal:
        fallback || !l
          ? operationSignal
          : AbortSignal.any([operationSignal, l.controller.signal]),
      deadline,
    };
  }
}

function chainSelection(op: PolicyOperation): PolicyScopeSelection[] {
  // No live lease: only a failed provider may reach a fresh trusted one-off question.
  return op.context.ancestry.map((componentId) => ({
    componentId,
    category: op.category,
    operation: op.operation,
    target: op.target,
  }));
}
