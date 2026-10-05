import { realpathSync, statSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PERMISSION_DENIED, PlumsError } from "../errors.js";
import { requireManifest, type InstallContext } from "../install/lifecycle.js";
import { isManifestV2, type PermissionV2 } from "../package/types.js";
import type { CapabilityCaller, CapabilityRequest } from "./types.js";

export interface TaskScopePlan {
  fingerprint: string;
  entries: { packageId: string; name: string; permissions: PermissionV2[] }[];
  /** Host-selected directories, displayed only in the trusted manager. */
  roots: Record<string, string>;
}
export interface TaskScopeSelection extends CapabilityCaller {
  operation: "read" | "list" | "write" | "send";
}
export interface TaskScopeState {
  taskId: string;
  expiresAt: number;
}

/** In-memory authority owned by one core instance, never exported to an extension. */
export class TaskScopes {
  private readonly instance = randomUUID();
  private revision = 0;
  private taskMode = false;
  private active?: TaskScopeState & {
    fingerprint: string;
    grants: Set<string>;
  };
  constructor(
    private ctx: InstallContext,
    private roots: ReadonlyMap<string, string>,
    private readonly requireApproval = false,
  ) {}
  plan(): TaskScopePlan {
    const installed = this.ctx.store.list().filter((p) => p.enabled);
    const manifests = installed.map((p) => requireManifest(this.ctx, p.id));
    const entries = manifests
      .filter(isManifestV2)
      .filter((m) => m.kind !== "character")
      .map((m) => ({
        packageId: m.id,
        name: m.name,
        permissions: m.permissions.filter(
          (p) =>
            p.kind === "egress" ||
            (p.kind === "fs" && this.roots.has(p.target)),
        ),
      }))
      .filter((e) => e.permissions.length);
    const roots = Object.fromEntries(
      [...this.roots].filter(([root]) =>
        entries.some((e) =>
          e.permissions.some((p) => p.kind === "fs" && p.target === root),
        ),
      ),
    );
    // A pathname rebound outside the manager must not carry a prior directory approval.
    const rootIdentities = [...this.roots].map(([name, directory]) => {
      try {
        const canonical = realpathSync(directory),
          info = statSync(canonical);
        return [name, canonical, info.dev, info.ino, info.isDirectory()];
      } catch {
        return [name, null];
      }
    });
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          this.instance,
          this.revision,
          this.ctx.store.externalChangeVersion(),
          installed,
          manifests,
          installed.map((p) => this.ctx.store.getConsent(p.id)),
          [...this.roots],
          rootIdentities,
        ]),
      )
      .digest("hex");
    return structuredClone({ fingerprint, entries, roots });
  }
  state(): TaskScopeState | undefined {
    const task = this.active;
    if (
      !task ||
      task.expiresAt <= Date.now() ||
      task.fingerprint !== this.plan().fingerprint
    )
      return undefined;
    return { taskId: task.taskId, expiresAt: task.expiresAt };
  }
  validate(
    fingerprint: string,
    durationMs: number,
    selection?: TaskScopeSelection[],
  ): TaskScopePlan {
    const plan = this.plan();
    if (
      plan.fingerprint !== fingerprint ||
      !Number.isInteger(durationMs) ||
      durationMs <= 0 ||
      durationMs > 3_600_000
    )
      this.deny();
    const available = new Set(this.selections(plan).map((s) => this.key(s)));
    if (
      selection !== undefined &&
      (!Array.isArray(selection) ||
        selection.some((s) => !s || !available.has(this.key(s))))
    )
      this.deny();
    return plan;
  }
  selections(plan = this.plan()): TaskScopeSelection[] {
    return plan.entries.flatMap((e) =>
      e.permissions.flatMap((p) =>
        (p.kind === "fs" ? p.operations : ["send" as const]).map(
          (operation) => ({
            packageId: e.packageId,
            permissionId: p.id,
            operation,
          }),
        ),
      ),
    );
  }
  grant(
    fingerprint: string,
    durationMs: number,
    taskId = randomUUID(),
    selection?: TaskScopeSelection[],
  ): TaskScopeState {
    const plan = this.validate(fingerprint, durationMs, selection);
    const selected = selection ?? this.selections(plan);
    const state = { taskId, expiresAt: Date.now() + durationMs };
    this.taskMode = true;
    this.active = {
      ...state,
      fingerprint,
      grants: new Set(selected.map((s) => this.key(s))),
    };
    return state;
  }
  requiresApproval(): boolean {
    return this.requireApproval || this.taskMode;
  }
  revoke(): void {
    this.active = undefined;
    this.revision += 1;
  }
  checkpoint(): () => void {
    const revision = this.revision;
    return () => {
      if (this.revision !== revision) this.deny();
    };
  }
  covers(
    principals: readonly CapabilityCaller[],
    request: CapabilityRequest,
  ): TaskScopeState | undefined {
    const state = this.state();
    return state &&
      principals.every((p) =>
        this.active!.grants.has(
          this.key({
            ...p,
            operation: request.kind === "fs" ? request.operation : "send",
          }),
        ),
      )
      ? state
      : undefined;
  }
  private key(s: TaskScopeSelection): string {
    return JSON.stringify([s.packageId, s.permissionId, s.operation]);
  }
  private deny(): never {
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: "任务范围已变化、到期或撤销，请重新开始使用。",
      details: { reason: "TASK_SCOPE_CHANGED" },
    });
  }
}
