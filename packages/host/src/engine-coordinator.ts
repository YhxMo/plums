import {
  engineAuditEvent,
  reportedEngineAuditEvent,
} from "./audit-presentation.js";
import { resolveProtocol } from "./protocol-bindings.js";
import { engineGrant, type GrantConfirm } from "./engine-grants.js";
import { connectionBindings } from "./connection-service.js";
import type { GrantUse } from "@plums/core";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  PlumsError,
  PERMISSION_DENIED,
  type AuditEvent,
  type Confirm,
} from "@plums/core";
import { desktopContribution, type EngineStatus } from "@plums/sdk";
import { ioContext } from "./io.js";
import type { EngineHooks } from "./engine-manager.js";
import {
  AgentExecutionService,
  type LocalExecutionAuthorization,
} from "./local-execution.js";
import {
  copyInvocationContext,
  type InvocationContext,
} from "./foundation-runtime.js";
import type { PolicyCheckpoint } from "./policy-service.js";
import type { Session } from "./host.js";
import type { ComponentLibrary } from "./library.js";
import { installedComponent } from "./installed-component.js";
import { RequestRechecks, withRecheck } from "./recheck-cache.js";
function denied(): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "引擎未获授权或当前声明已变化。",
  });
}
export async function confirmOnce(
  confirm: Confirm,
  request: Parameters<Confirm["ask"]>[0],
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return false;
  const combined = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
  let cancel!: () => void;
  const aborted = new Promise<boolean>((resolve) => {
    cancel = () => resolve(false);
    combined.addEventListener("abort", cancel, { once: true });
  });
  try {
    return (
      (await Promise.race([
        Promise.resolve()
          .then(() => confirm.ask(request))
          .catch(() => false),
        aborted,
      ])) === true && !combined.aborted
    );
  } finally {
    combined.removeEventListener("abort", cancel);
  }
}
interface Options {
  allocateSnapshot?: (s: Session) => { root: string; release(): void };
  trackProcess?: (
    s: Session,
    child: import("node:child_process").ChildProcess,
  ) => void;
  canRun?(s: Session, packageId: string): Promise<void>;
  localCheckpoint?(s: Session, packageId: string): void;
  nodePath?: string;
  deadline?(s: Session, taskId?: string): number | undefined;
  policy?(
    s: Session,
    pkg: string,
    engine: string,
    method: string,
    input: unknown,
    callId: string,
    context: InvocationContext,
    authorization: LocalExecutionAuthorization,
  ): Promise<PolicyCheckpoint | undefined>;
  library: ComponentLibrary;
  confirm: Confirm;
  grantConfirm?: GrantConfirm;
  audit(id: string, event: AuditEvent): Promise<void>;
  event(id: string, pkg: string, topic: string, data: unknown): void;
  sanitize(s: Session, value: unknown): Promise<unknown>;
  secrets(s: Session): Promise<string[]>;
  cleanupRuntime(s: Session, scope: string): Promise<void>;
  protocolStatus(
    id: string,
    owner: string,
    requirementId: string,
  ): Promise<unknown>;
  invokeProtocol(
    id: string,
    owner: string,
    requirementId: string,
    input: unknown,
    signal: AbortSignal,
    authorization: { grantId: string; grantScope: GrantUse } | undefined,
    engineScope: string,
    context: InvocationContext,
  ): Promise<unknown>;
  invoke(
    id: string,
    owner: string,
    target: string,
    kind: "commands" | "tools" | "connectors",
    name: string,
    input: unknown,
    signal: AbortSignal,
    authorization: { grantId: string; grantScope: GrantUse } | undefined,
    engineScope: string,
    context: InvocationContext,
  ): Promise<unknown>;
}
export class EngineCoordinator {
  private services = new WeakMap<Session, AgentExecutionService>();
  constructor(private options: Options) {}
  private service(s: Session) {
    let service = this.services.get(s);
    if (!service) {
      service = new AgentExecutionService(s, this.options.nodePath);
      this.services.set(s, service);
    }
    return service;
  }
  async authorize(s: Session, pkg: string, engine: string) {
    this.options.localCheckpoint?.(s, pkg);
    const authorization = await this.service(s).authorize(pkg, engine);
    this.options.localCheckpoint?.(s, pkg);
    return authorization;
  }
  private async assessPolicy(
    ...args: Parameters<NonNullable<Options["policy"]>>
  ) {
    try {
      return await this.options.policy?.(...args);
    } catch (error) {
      const reason =
        error instanceof PlumsError &&
        error.details &&
        typeof error.details === "object"
          ? (error.details as { reason?: unknown }).reason
          : undefined;
      throw new PlumsError({
        code: error instanceof PlumsError ? error.code : "CAPABILITY_FAILED",
        message: "本地执行策略未允许此操作。",
        details: {
          callId: args[5],
          phase: "policy",
          executionState: "not_started",
          reason:
            typeof reason === "string" &&
            ["NOT_AUTHORIZED", "STALE_BINDING", "POLICY_UNAVAILABLE"].includes(
              reason,
            )
              ? reason
              : "POLICY_UNAVAILABLE",
        },
      });
    }
  }
  private key(s: Session, pkg: string, engine: string): string {
    return `${s.record.instanceId}/${pkg}/${engine}`;
  }
  private async ask(
    s: Session,
    pkg: string,
    request: Parameters<Confirm["ask"]>[0],
    signal: AbortSignal,
  ): Promise<boolean> {
    const safe = (await this.options.sanitize(s, request)) as typeof request;
    return ioContext.run(
      { signal, packageId: pkg, permissionId: "", secrets: s.secrets },
      () => confirmOnce(this.options.confirm, safe, signal),
    );
  }
  private async declaration(
    s: Session,
    pkg: string,
    engine: string,
    enabled = true,
  ) {
    if (typeof engine !== "string") denied();
    const p = await s.core.getPackage(pkg),
      d = desktopContribution(p.manifest)?.engines?.find(
        (d) => d.id === engine,
      );
    if (
      !d ||
      (enabled && !p.installed.enabled) ||
      !p.manifest.permissions.some(
        (p) => "kind" in p && p.kind === "engine" && p.target === engine,
      )
    )
      denied();
    return d;
  }
  async status(s: Session, pkg: string, engine: string): Promise<EngineStatus> {
    await this.declaration(s, pkg, engine, false);
    let trusted = false;
    try {
      await this.authorize(s, pkg, engine);
      trusted = true;
    } catch {}
    return {
      engineId: engine,
      state: this.service(s).manager.state(this.key(s, pkg, engine)),
      trusted,
    };
  }
  private lifecycle(
    s: Session,
    pkg: string,
    engine: string,
    reason: string,
    tier: "project" | "machine" | undefined,
    state: AuditEvent["executionState"] = "not_started",
    callers?: string[],
  ): Promise<void> {
    return this.audit(s, {
      callId: randomUUID(),
      timestamp: new Date().toISOString(),
      extensionId: pkg,
      ...(callers ? { callerIds: callers.slice(0, -1) } : {}),
      kind: "engine",
      target: engine,
      phase: "result",
      ...(tier ? { tier } : {}),
      outcome: state === "completed" ? "completed" : "allowed",
      executionState: state,
      reason,
    });
  }
  private async audit(
    s: Session,
    event: AuditEvent,
    secrets = new Set<string>(),
    first?: Promise<string[]>,
  ): Promise<void> {
    try {
      if (first) for (const value of await first) secrets.add(value);
      for (const value of await this.options.secrets(s)) secrets.add(value);
      const safe = engineAuditEvent(event, [...secrets]);
      if (safe.callerIds) Object.freeze(safe.callerIds);
      await this.options.audit(s.record.instanceId, Object.freeze(safe));
    } catch {
      throw new PlumsError({
        code: "CAPABILITY_FAILED",
        message: "本地执行审计未完成。",
        details: {
          callId: event.callId,
          phase: "audit_" + event.phase,
          executionState: event.executionState,
        },
      });
    }
  }
  private createHooks(
    s: Session,
    pkg: string,
    engine: string,
    startup?: {
      signal: AbortSignal;
      assertActive: () => Promise<void>;
      active: boolean;
      ancestry: string[];
    },
  ): EngineHooks {
    const signal = s.engineController.signal;
    let authorization: LocalExecutionAuthorization | undefined;
    let snapshotDir: string | undefined,
      allocation: { root: string; release(): void } | undefined;
    const active = async () => {
      this.options.localCheckpoint?.(s, pkg);
      await this.options.canRun?.(s, pkg);
      if (startup?.active) {
        if (startup.signal.aborted) denied();
        await startup.assertActive();
      }
      if (signal.aborted) denied();
      await this.declaration(s, pkg, engine);
      const current = await this.authorize(s, pkg, engine);
      if (!authorization || authorization.fingerprint !== current.fingerprint)
        denied();
      this.options.localCheckpoint?.(s, pkg);
      if (signal.aborted) denied();
      return current;
    };
    return {
      trackProcess: (child) => this.options.trackProcess?.(s, child),
      active,
      cleanup: async () => {
        try {
          await this.options.cleanupRuntime(s, `${pkg}/${engine}`);
        } finally {
          if (snapshotDir) {
            await rm(snapshotDir, { recursive: true, force: true });
            allocation?.release();
          }
        }
      },
      prepare: async (managerSignal) => {
        this.options.localCheckpoint?.(s, pkg);
        const combined = AbortSignal.any([
            signal,
            managerSignal,
            ...(startup ? [startup.signal] : []),
          ]),
          d = await this.declaration(s, pkg, engine);
        if (!d.platforms.includes(`${process.platform}-${process.arch}`))
          denied();
        authorization = await this.authorize(s, pkg, engine);
        await active();
        if (combined.aborted) denied();
        const binding = s.record.components?.find((c) => c.packageId === pkg);
        if (!binding) denied();
        await this.options.secrets(s);
        const expected = await installedComponent(s, this.options.library, pkg);
        // Execute a verified snapshot, so replacement of the install entry cannot redirect launch.
        allocation = this.options.allocateSnapshot?.(s);
        snapshotDir =
          allocation?.root ??
          path.join(s.core.dataDir, "..", "engines", randomUUID());
        for (const [p, b] of Object.entries(expected.files)) {
          const file = path.join(snapshotDir, p);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, b, { flag: "wx", mode: 0o600 });
        }
        await active();
        if (combined.aborted) denied();
        const identity = createHash("sha256")
          .update(
            JSON.stringify([pkg, authorization.grant.installedAt, engine]),
          )
          .digest("hex");
        const dataDir = path.join(
          s.core.dataDir,
          "..",
          "engine-data",
          identity,
        );
        await mkdir(dataDir, { recursive: true, mode: 0o700 });
        return {
          entry: path.join(snapshotDir, d.entry),
          cwd: snapshotDir,
          context: {
            agentId: s.record.instanceId,
            componentId: pkg,
            engineId: engine,
            dataDir,
            tier: authorization.grant.tier,
            projects: [],
          },
        };
      },
      callback: () =>
        Promise.reject(
          new PlumsError({
            code: PERMISSION_DENIED,
            message: "本地回调缺少请求上下文。",
          }),
        ),
      event: (topic, data) =>
        this.options.event(s.record.instanceId, pkg, topic, {
          engineId: engine,
          ...(data as object),
        }),
      audit: async (action) => {
        try {
          await this.lifecycle(
            s,
            pkg,
            engine,
            `ENGINE_${action.toUpperCase()}`,
            authorization?.grant.tier,
            action === "start" ? "not_started" : "completed",
            startup?.ancestry,
          );
        } finally {
          if (action !== "start") {
            try {
              await this.options.cleanupRuntime(s, `${pkg}/${engine}`);
            } finally {
              if (snapshotDir) {
                await rm(snapshotDir, { recursive: true, force: true });
                allocation?.release();
              }
            }
          }
        }
      },
    };
  }
  private async callback(
    s: Session,
    pkg: string,
    engine: string,
    method: string,
    input: unknown,
    engineSignal: AbortSignal,
    context: InvocationContext,
  ): Promise<unknown> {
    const a = structuredClone(input) as Record<string, unknown>,
      combined = AbortSignal.any([
        s.engineController.signal,
        engineSignal,
        context.signal,
      ]);
    const checkpoint = async () => {
      if (combined.aborted) denied();
      await context.assertActive?.();
      if (combined.aborted) denied();
    };
    await checkpoint();
    if (!a || typeof a !== "object" || Array.isArray(a)) denied();
    if (method === "host.grant") {
      const d = await this.declaration(s, pkg, engine);
      return engineGrant(
        s,
        pkg,
        d,
        a,
        combined,
        this.options.grantConfirm,
        async (event) =>
          this.options.audit(
            s.record.instanceId,
            reportedEngineAuditEvent(event, await this.options.secrets(s)),
          ),
        context,
      );
    }
    if (method === "host.confirm") {
      if (
        typeof a.message !== "string" ||
        !a.message.trim() ||
        a.message.length > 2048
      )
        denied();
      const message = a.message,
        title = (await this.declaration(s, pkg, engine)).title;
      return this.ask(
        s,
        pkg,
        { subject: title, action: message, message },
        combined,
      );
    }
    if (method === "host.protocolStatus") {
      if (typeof a.requirementId !== "string") denied();
      return this.options.protocolStatus(
        s.record.instanceId,
        pkg,
        a.requirementId,
      );
    }
    const selection =
      method === "host.invokeProtocol" && typeof a.requirementId === "string"
        ? await resolveProtocol(s.core, s.record, pkg, a.requirementId)
        : undefined;
    const targetId = selection?.providerId ?? a.packageId;
    const p = await s.core.getPackage(pkg);
    if (
      typeof targetId !== "string" ||
      (!selection &&
        (!p.manifest.dependencies.some((d) => d.id === targetId) ||
          !["commands", "tools", "connectors"].includes(a.kind as string) ||
          typeof a.name !== "string"))
    )
      denied();
    let authorization: { grantId: string; grantScope: GrantUse } | undefined;
    if (a.grantId !== undefined) {
      if (
        typeof a.grantId !== "string" ||
        !a.grantScope ||
        typeof a.grantScope !== "object"
      )
        denied();
      const use = a.grantScope as GrantUse;
      const grant = await s.core.checkGrant(a.grantId, pkg, use);
      const reachable = await connectionBindings(s.core, targetId, s.record);
      if (
        !grant ||
        grant.engineId !== engine ||
        !reachable.some((target) =>
          grant.scope.services.some(
            (v) =>
              v.packageId === target.packageId && v.binding === target.binding,
          ),
        )
      )
        denied();
      authorization = { grantId: grant.id, grantScope: use };
    }
    if (selection)
      return this.options.invokeProtocol(
        s.record.instanceId,
        pkg,
        selection.requirementId,
        a.input,
        combined,
        authorization,
        `${pkg}/${engine}`,
        { ...context, signal: combined, assertActive: checkpoint },
      );
    return this.options.invoke(
      s.record.instanceId,
      pkg,
      targetId,
      a.kind as "commands" | "tools" | "connectors",
      a.name as string,
      a.input,
      combined,
      authorization,
      `${pkg}/${engine}`,
      { ...context, signal: combined, assertActive: checkpoint },
    );
  }
  async start(
    s: Session,
    pkg: string,
    engine: string,
    context?: InvocationContext,
  ): Promise<EngineStatus> {
    context = copyInvocationContext(
      context ?? {
        callers: [],
        ancestry: [pkg],
        signal: s.engineController.signal,
      },
    );
    await context.assertActive?.();
    this.options.localCheckpoint?.(s, pkg);
    await this.declaration(s, pkg, engine);
    const authorization = await this.authorize(s, pkg, engine);
    const callerScope = context;
    const gate = await this.assessPolicy(
      s,
      pkg,
      engine,
      "start",
      null,
      randomUUID(),
      context,
      authorization,
    );
    const scope = {
      signal: gate?.signal ?? context.signal,
      assertActive: async () => {
        await callerScope.assertActive?.();
        if (context.signal.aborted) denied();
        if (
          (await this.authorize(s, pkg, engine)).fingerprint !==
          authorization.fingerprint
        )
          denied();
        await gate?.recheck();
        gate?.assertCurrent();
        if (context.signal.aborted) denied();
      },
    };
    await scope.assertActive();
    const key = this.key(s, pkg, engine);
    let hooks = this.service(s).hooks.get(key);
    let startup:
      | {
          signal: AbortSignal;
          assertActive: () => Promise<void>;
          active: boolean;
          ancestry: string[];
        }
      | undefined;
    if (
      !hooks ||
      ["stopped", "crashed"].includes(this.service(s).manager.state(key))
    ) {
      startup = { ...scope, active: true, ancestry: [...context.ancestry] };
      hooks = this.createHooks(s, pkg, engine, startup);
      this.service(s).hooks.set(key, hooks);
    }
    try {
      await this.service(s).manager.start(key, hooks);
      await scope.assertActive();
      if (startup) startup.active = false;
      return this.status(s, pkg, engine);
    } catch (error) {
      // A final caller/policy check can fail after the handshake made the run active.
      // Stop it before removing the hooks that stopAgent uses to find owned processes.
      try {
        await this.service(s).manager.stop(key, hooks);
      } catch {}
      if (this.service(s).hooks.get(key) === hooks)
        this.service(s).hooks.delete(key);
      await hooks.cleanup?.();
      throw error;
    }
  }
  async request(
    s: Session,
    pkg: string,
    engine: string,
    method: string,
    input: unknown,
    id?: string,
    context?: InvocationContext,
  ): Promise<unknown> {
    input = structuredClone(input);
    context = copyInvocationContext(
      context ?? {
        callers: [],
        ancestry: [pkg],
        signal: s.engineController.signal,
      },
    );
    context.deadline = Math.min(
      context.deadline ?? Infinity,
      this.options.deadline?.(s, context.taskId) ?? Date.now() + 120_000,
    );
    context.signal = AbortSignal.any([
      context.signal,
      AbortSignal.timeout(
        Math.max(0, Math.ceil(context.deadline - Date.now())),
      ),
    ]);
    const firstSecrets = this.options.secrets(s),
      secrets = new Set<string>();
    void firstSecrets.catch(() => {});
    if (
      typeof method !== "string" ||
      !/^[a-zA-Z][a-zA-Z0-9_.-]{0,127}$/.test(method) ||
      method === "initialize" ||
      method.startsWith("host.") ||
      (id !== undefined &&
        (typeof id !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/.test(id)))
    )
      denied();
    const callers = [...(context?.ancestry ?? [pkg])];
    if (
      !callers.length ||
      callers.at(-1) !== pkg ||
      new Set(callers).size !== callers.length ||
      callers.length > 16
    )
      denied();
    await this.declaration(s, pkg, engine);
    const authorization = await this.authorize(s, pkg, engine);
    const key = this.key(s, pkg, engine),
      hooks = this.service(s).hooks.get(key);
    if (!hooks) denied();
    const callId = randomUUID();
    let gate: PolicyCheckpoint | undefined;
    const epoch = new RequestRechecks();
    const check = async (full = false) =>
      withRecheck(epoch, full, async () => {
        await context?.assertActive?.();
        if (context?.signal.aborted) denied();
        await gate?.recheck();
        const current = await hooks.active();
        if (!current || current.fingerprint !== authorization.fingerprint)
          denied();
        gate?.assertCurrent();
        if (context?.signal.aborted) denied();
      });
    const audit = (
      phase: "allow" | "result",
      outcome: AuditEvent["outcome"],
      executionState: AuditEvent["executionState"],
    ) =>
      this.audit(
        s,
        {
          callId,
          timestamp: new Date().toISOString(),
          agentId: s.record.instanceId,
          extensionId: pkg,
          callerIds: callers.slice(0, -1),
          kind: "engine",
          target: engine,
          operation: method,
          phase,
          outcome,
          executionState,
          tier: authorization.grant.tier,
        },
        secrets,
        firstSecrets,
      );
    await check(true);
    gate = await this.assessPolicy(
      s,
      pkg,
      engine,
      method,
      input,
      callId,
      context ?? {
        callers: [],
        ancestry: [pkg],
        signal: s.engineController.signal,
      },
      authorization,
    );
    if (gate) context.deadline = Math.min(context.deadline, gate.deadline);
    await check();
    await audit("allow", "allowed", "not_started");
    let state: AuditEvent["executionState"] = "not_started",
      result: unknown;
    try {
      await check(true);
      state = "unknown";
      result = await this.service(s).manager.request(
        key,
        {
          ...hooks,
          active: check,
          signal: gate?.signal ?? context.signal,
          allowUnboundCallback: callers.length === 1,
          callbackScope: JSON.stringify([
            context.ancestry,
            context.callers,
            context.grantId,
            context.grantScope,
            context.taskId,
            context.resourceInstanceId,
          ]),
          callback: (method, input, signal) =>
            this.callback(s, pkg, engine, method, input, signal, {
              ...context,
              assertActive: check,
            }),
          assertCurrent: () => {
            this.options.localCheckpoint?.(s, pkg);
            gate?.assertCurrent();
            if (context?.signal.aborted || s.engineController.signal.aborted)
              denied();
          },
        },
        method,
        input,
        id,
      );
      state = "completed";
    } catch (error) {
      if (
        error instanceof PlumsError &&
        error.details &&
        typeof error.details === "object"
      ) {
        const described = (error.details as { executionState?: unknown })
          .executionState;
        if (
          ["not_started", "completed", "unknown"].includes(described as string)
        )
          state = described as typeof state;
      }
      await audit("result", "failed", state);
      const describedReason =
        error instanceof PlumsError &&
        error.details &&
        typeof error.details === "object"
          ? (error.details as { reason?: unknown }).reason
          : undefined;
      const reason =
        typeof describedReason === "string" &&
        [
          "ENGINE_EXITED",
          "ENGINE_REQUEST_LIMIT",
          "ENGINE_MESSAGE_LIMIT",
          "ENGINE_MESSAGE_INVALID",
          "ENGINE_STOPPED",
          "ENGINE_TASK_FAILED",
          "ENGINE_AUTHORIZATION_CHANGED",
        ].includes(describedReason)
          ? describedReason
          : undefined;
      throw new PlumsError({
        code:
          state === "not_started" && error instanceof PlumsError
            ? error.code
            : "CAPABILITY_FAILED",
        message: "本地请求未完成。",
        details: {
          callId,
          phase: "engine",
          executionState: state,
          ...(reason ? { reason } : {}),
        },
      });
    }
    await audit("result", "completed", state);
    try {
      await check(true);
    } catch {
      throw new PlumsError({
        code: "CAPABILITY_FAILED",
        message: "本地请求完成后授权已变化。",
        details: {
          callId,
          phase: "engine",
          reason: "ENGINE_AUTHORIZATION_CHANGED",
          executionState: "completed",
        },
      });
    }
    return result;
  }
  async cancel(
    s: Session,
    pkg: string,
    engine: string,
    id: string,
  ): Promise<void> {
    await this.declaration(s, pkg, engine);
    const key = this.key(s, pkg, engine),
      hooks = this.service(s).hooks.get(key);
    if (!hooks) denied();
    await this.service(s).manager.cancel(key, hooks, id);
  }
  async stop(s: Session, pkg: string, engine: string): Promise<void> {
    await this.declaration(s, pkg, engine, false);
    const key = this.key(s, pkg, engine),
      hooks = this.service(s).hooks.get(key);
    if (hooks) {
      try {
        await this.service(s).manager.stop(key, hooks);
      } finally {
        if (this.service(s).hooks.get(key) === hooks)
          this.service(s).hooks.delete(key);
      }
    }
  }
  async stopAgent(s: Session): Promise<void> {
    const prefix = s.record.instanceId + "/";
    const runs = [...this.service(s).hooks].filter(([key]) =>
      key.startsWith(prefix),
    );
    // A self-test cleanup failure must not prevent already running entries from stopping.
    const results = await Promise.allSettled([
      this.service(s).project.close(),
      ...runs.map(async ([key, hooks]) => {
        try {
          await this.service(s).manager.stop(key, hooks);
        } finally {
          if (this.service(s).hooks.get(key) === hooks)
            this.service(s).hooks.delete(key);
        }
      }),
    ]);
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
  async stopPackages(s: Session, packages: string[]): Promise<void> {
    const prefix = s.record.instanceId + "/";
    const runs = [...this.service(s).hooks].filter(([key]) =>
      packages.some((pkg) => key.startsWith(prefix + pkg + "/")),
    );
    const results = await Promise.allSettled(
      runs.map(async ([key, hooks]) => {
        try {
          await this.service(s).manager.stop(key, hooks);
        } finally {
          if (this.service(s).hooks.get(key) === hooks)
            this.service(s).hooks.delete(key);
        }
      }),
    );
    const failure = results.find((r) => r.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  }
}
