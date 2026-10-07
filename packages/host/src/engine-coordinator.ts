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
import { EngineManager, type EngineHooks } from "./engine-manager.js";
import type { Session } from "./host.js";
import type { ComponentLibrary } from "./library.js";
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
  canRun?(s: Session): Promise<void>;
  nodePath?: string;
  library: ComponentLibrary;
  confirm: Confirm;
  grantConfirm?: GrantConfirm;
  audit(id: string, event: AuditEvent): Promise<void>;
  event(id: string, pkg: string, topic: string, data: unknown): void;
  sanitize(s: Session, value: unknown): Promise<unknown>;
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
  ): Promise<unknown>;
}
export class EngineCoordinator {
  private manager: EngineManager;
  private hooks = new Map<string, EngineHooks>();
  constructor(private options: Options) {
    this.manager = new EngineManager(options.nodePath);
  }
  hasActive(s: Session) {
    return this.manager.activeFor(s.record.instanceId + "/");
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
    return {
      engineId: engine,
      state: this.manager.state(this.key(s, pkg, engine)),
      trusted: (await s.core.engineTrustSnapshot(pkg, engine)).trusted,
    };
  }
  private lifecycle(
    s: Session,
    pkg: string,
    engine: string,
    reason: string,
    state: AuditEvent["executionState"] = "not_started",
  ): Promise<void> {
    return this.options.audit(s.record.instanceId, {
      callId: randomUUID(),
      timestamp: new Date().toISOString(),
      extensionId: pkg,
      kind: "engine",
      target: engine,
      phase:
        reason === "ENGINE_AUTHORIZED"
          ? "grant"
          : reason === "ENGINE_REVOKED"
            ? "revoke"
            : "result",
      outcome: state === "completed" ? "completed" : "allowed",
      executionState: state,
      reason,
    });
  }
  private createHooks(
    s: Session,
    pkg: string,
    engine: string,
    startup?: {
      signal: AbortSignal;
      assertActive: () => Promise<void>;
      active: boolean;
    },
  ): EngineHooks {
    const signal = s.engineController.signal;
    let snapshotDir: string | undefined;
    const active = async () => {
      await this.options.canRun?.(s);
      if (startup?.active) {
        if (startup.signal.aborted) denied();
        await startup.assertActive();
      }
      if (signal.aborted) denied();
      await this.declaration(s, pkg, engine);
      if (!(await s.core.engineTrustSnapshot(pkg, engine)).trusted) denied();
      if (signal.aborted) denied();
    };
    return {
      active,
      cleanup: async () => {
        try {
          await this.options.cleanupRuntime(s, `${pkg}/${engine}`);
        } finally {
          if (snapshotDir)
            await rm(snapshotDir, { recursive: true, force: true });
        }
      },
      prepare: async (managerSignal) => {
        const combined = AbortSignal.any([
            signal,
            managerSignal,
            ...(startup ? [startup.signal] : []),
          ]),
          d = await this.declaration(s, pkg, engine);
        if (!d.platforms.includes(`${process.platform}-${process.arch}`))
          denied();
        const snapshot = await s.core.engineTrustSnapshot(pkg, engine);
        if (!snapshot.trusted) {
          const allowed = await this.ask(
            s,
            pkg,
            {
              presentation: "engine-trust",
              subject: d.title,
              action: `“${d.title}”需要读取和修改本机文件、运行程序及访问网络。`,
              message: `“${d.title}”需要读取和修改本机文件、运行程序及访问网络。`,
            },
            combined,
          );
          if (!allowed || combined.aborted) denied();
          if (!(await s.core.grantEngineTrust(snapshot))) denied();
          await this.lifecycle(s, pkg, engine, "ENGINE_AUTHORIZED");
        }
        await active();
        if (combined.aborted) denied();
        const binding = s.record.components?.find((c) => c.packageId === pkg);
        if (!binding) denied();
        const expected = (await this.options.library.get(binding.digest))
            .contents,
          installed = await s.core.getPackageContents(pkg);
        if (
          JSON.stringify(expected.manifest) !==
            JSON.stringify(installed.manifest) ||
          Object.keys(expected.files).length !==
            Object.keys(installed.files).length ||
          Object.entries(expected.files).some(
            ([p, b]) =>
              !installed.files[p] ||
              !Buffer.from(b).equals(Buffer.from(installed.files[p]!)),
          )
        )
          denied();
        // Execute a verified snapshot, so replacement of the install entry cannot redirect launch.
        snapshotDir = path.join(s.core.dataDir, "..", "engines", randomUUID());
        for (const [p, b] of Object.entries(expected.files)) {
          const file = path.join(snapshotDir, p);
          await mkdir(path.dirname(file), { recursive: true });
          await writeFile(file, b, { flag: "wx", mode: 0o600 });
        }
        await active();
        if (combined.aborted) denied();
        const identity = createHash("sha256")
          .update(JSON.stringify([pkg, snapshot.installedAt, engine]))
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
          },
        };
      },
      callback: async (method, input, engineSignal) => {
        const a = input as Record<string, unknown>,
          combined = AbortSignal.any([signal, engineSignal]);
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
                Object.freeze(
                  (await this.options.sanitize(s, event)) as AuditEvent,
                ),
              ),
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
          method === "host.invokeProtocol" &&
          typeof a.requirementId === "string"
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
        let authorization:
          | { grantId: string; grantScope: GrantUse }
          | undefined;
        if (a.grantId !== undefined) {
          if (
            typeof a.grantId !== "string" ||
            !a.grantScope ||
            typeof a.grantScope !== "object"
          )
            denied();
          const use = a.grantScope as GrantUse;
          const grant = await s.core.checkGrant(a.grantId, pkg, use);
          const reachable = await connectionBindings(
            s.core,
            targetId,
            s.record,
          );
          if (
            !grant ||
            grant.engineId !== engine ||
            !reachable.some((target) =>
              grant.scope.services.some(
                (v) =>
                  v.packageId === target.packageId &&
                  v.binding === target.binding,
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
        );
      },
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
            action === "start" ? "not_started" : "completed",
          );
        } finally {
          if (action !== "start") {
            try {
              await this.options.cleanupRuntime(s, `${pkg}/${engine}`);
            } finally {
              if (snapshotDir)
                await rm(snapshotDir, { recursive: true, force: true });
            }
          }
        }
      },
    };
  }
  async start(
    s: Session,
    pkg: string,
    engine: string,
    scope?: { signal: AbortSignal; assertActive: () => Promise<void> },
  ): Promise<EngineStatus> {
    await scope?.assertActive();
    await this.declaration(s, pkg, engine);
    const key = this.key(s, pkg, engine);
    let hooks = this.hooks.get(key);
    let startup:
      | {
          signal: AbortSignal;
          assertActive: () => Promise<void>;
          active: boolean;
        }
      | undefined;
    if (!hooks || ["stopped", "crashed"].includes(this.manager.state(key))) {
      startup = scope ? { ...scope, active: true } : undefined;
      hooks = this.createHooks(s, pkg, engine, startup);
      this.hooks.set(key, hooks);
    }
    try {
      await this.manager.start(key, hooks);
      if (startup) startup.active = false;
      return this.status(s, pkg, engine);
    } catch (error) {
      if (this.hooks.get(key) === hooks) this.hooks.delete(key);
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
  ): Promise<unknown> {
    await this.declaration(s, pkg, engine);
    const key = this.key(s, pkg, engine),
      hooks = this.hooks.get(key);
    if (!hooks) denied();
    return this.manager.request(key, hooks, method, input, id);
  }
  async cancel(
    s: Session,
    pkg: string,
    engine: string,
    id: string,
  ): Promise<void> {
    await this.declaration(s, pkg, engine);
    const key = this.key(s, pkg, engine),
      hooks = this.hooks.get(key);
    if (!hooks) denied();
    await this.manager.cancel(key, hooks, id);
  }
  async stop(s: Session, pkg: string, engine: string): Promise<void> {
    await this.declaration(s, pkg, engine, false);
    const key = this.key(s, pkg, engine),
      hooks = this.hooks.get(key);
    if (hooks) {
      try {
        await this.manager.stop(key, hooks);
      } finally {
        if (this.hooks.get(key) === hooks) this.hooks.delete(key);
      }
    }
  }
  async revoke(s: Session, pkg: string, engine: string): Promise<void> {
    await this.declaration(s, pkg, engine, false);
    await s.core.revokeEngineTrust(pkg, engine);
    try {
      await this.stop(s, pkg, engine);
    } finally {
      await this.lifecycle(s, pkg, engine, "ENGINE_REVOKED");
    }
  }
  async stopAgent(s: Session): Promise<void> {
    const prefix = s.record.instanceId + "/";
    const runs = [...this.hooks].filter(([key]) => key.startsWith(prefix));
    await Promise.all(
      runs.map(async ([key, hooks]) => {
        try {
          await this.manager.stop(key, hooks);
        } finally {
          if (this.hooks.get(key) === hooks) this.hooks.delete(key);
        }
      }),
    );
  }
}
