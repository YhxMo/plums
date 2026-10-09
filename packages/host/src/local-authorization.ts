import { checkProjectLinks } from "./project-links.js";
import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import {
  enginePermissionKey,
  isManifestV2,
  PlumsError,
  type AgentTierCeiling,
  type AgentLocalGrant,
  type LocalAuthorizationCommit,
  type LocalAuthorizationState,
  type LocalDirectory,
  type EnginePermission,
  type Permission,
  type AuditEvent,
  type Confirm,
} from "@plums/core";
import { confirmOnce } from "./engine-coordinator.js";
import type { Session } from "./host.js";
import {
  presentLocalAuthorizationEvent,
  presentLocalAuthorizationConfirmation,
} from "./foundation-presentation.js";

export interface TierSelection {
  ceiling: AgentTierCeiling;
  projects: string[];
  readOnly: string[];
  /** Includes ordinary components whose fs/exec declarations the user reviewed. */
  components: string[];
  hosts?: Record<string, Record<string, string[]>>;
}
export interface TierEntry {
  packageId: string;
  name: string;
  formatVersion: string;
  confirmed: boolean;
  permissions: Permission[];
  engines: {
    engineId: string;
    tier: "project" | "machine";
    hosts: string[];
    state: "confirmed" | "pending" | "tier-required";
  }[];
}
export interface TierPlan {
  fingerprint: string;
  selection: TierSelection;
  current: LocalAuthorizationState;
  entries: TierEntry[];
  projects: LocalDirectory[];
  readOnly: LocalDirectory[];
}
export const MACHINE_AUTHORIZATION_COPY =
  "该扩展可读取和修改本机所有文件（包括 Plums 自身数据和其他 Agent 的密钥）、运行任意程序、访问网络";
const levels = { sandbox: 0, project: 1, machine: 2 };
const tierNames = { sandbox: "沙箱", project: "项目", machine: "整机" };
const permissionNames: Record<string, string> = {
  fs: "文件操作",
  exec: "受控程序",
  service: "服务访问",
  resource: "资源操作",
  egress: "联网",
  engine: "本地执行",
};
const operationNames: Record<string, string> = {
  read: "读取",
  write: "写入",
  list: "列目录",
  request: "请求",
};
function changed(): never {
  throw new PlumsError({
    code: "PERMISSION_DENIED",
    message: "本地授权计划或范围已变化，请重新查看。",
    details: { reason: "LOCAL_AUTHORIZATION_CHANGED" },
  });
}
function failed(phase: string, callId: string): never {
  throw new PlumsError({
    code: "CAPABILITY_FAILED",
    message: "本地授权未完成，请查看当前权限状态。",
    details: { callId, phase, executionState: "not_started" },
  });
}
function within(parent: string, child: string) {
  return (
    child === parent ||
    child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep)
  );
}
function permissionDescription(
  permission: Permission,
  formatVersion: string,
): string {
  const v2 = formatVersion.startsWith("2.");
  const label = v2
    ? permissionNames[String(permission.kind)]
    : operationNames[String(permission.level)];
  const operations =
    v2 && Array.isArray(permission.operations)
      ? permission.operations
          .map((o) => operationNames[String(o)] ?? "已声明操作")
          .join("、")
      : "";
  return `${label ?? "组件权限"}，${permission.target}${operations ? `，${operations}` : ""}。${permission.reason}`;
}
interface Options {
  dataDir: string;
  confirm: Confirm;
  audit(s: Session, event: AuditEvent): Promise<void>;
  secrets(s: Session): Promise<string[]>;
  stop(s: Session, packageIds: string[]): Promise<void>;
}
/** Trusted management only. No method on this service is bound into the SDK or a panel. */
export class LocalAuthorizations {
  private changing = new Map<string, Set<string>>();
  constructor(private options: Options) {}
  assertAvailable(s: Session, packageId: string) {
    if (this.changing.get(s.record.instanceId)?.has(packageId)) changed();
  }
  private async directory(
    s: Session,
    root: string,
    project = false,
  ): Promise<LocalDirectory> {
    const selected = s.record.roots[root];
    if (!selected || root === "agent-data") changed();
    try {
      const [actual, identity, protectedDir] = await Promise.all([
        realpath(selected),
        lstat(selected, { bigint: true }),
        realpath(this.options.dataDir),
      ]);
      if (
        actual !== selected ||
        !identity.isDirectory() ||
        identity.isSymbolicLink() ||
        within(actual, protectedDir) ||
        within(protectedDir, actual)
      )
        changed();
      if (project) await checkProjectLinks(actual);
      return {
        root,
        path: actual,
        dev: String(identity.dev),
        ino: String(identity.ino),
      };
    } catch (error) {
      if (error instanceof PlumsError && error.code === "TIER_UNAVAILABLE")
        throw error;
      changed();
    }
  }
  private async assembly(s: Session) {
    return Promise.all(
      (await s.core.listInstalled()).map(async (p) => {
        const { manifest } = await s.core.getPackage(p.id);
        return {
          packageId: p.id,
          installedAt: p.installedAt,
          permissions: enginePermissionKey(manifest.permissions),
        };
      }),
    );
  }
  private async event(
    s: Session,
    current: LocalAuthorizationState,
    next: LocalAuthorizationCommit,
    reason: string,
    phase: "grant" | "revoke",
    callId: string,
    outcome: "allowed" | "denied" | "failed" = "allowed",
  ) {
    const event: AuditEvent = {
      callId,
      timestamp: new Date().toISOString(),
      agentId: s.record.instanceId,
      kind: "engine",
      phase,
      outcome,
      executionState: "not_started",
      reason,
      tier: next.tier.ceiling,
      localScope: {
        roots: [
          ...new Set(
            [...current.tier.projects, ...next.tier.projects].map(
              (d) => d.root,
            ),
          ),
        ],
        readOnlyRoots: [
          ...new Set(
            [...current.tier.readOnly, ...next.tier.readOnly].map(
              (d) => d.root,
            ),
          ),
        ],
        componentIds: [
          ...new Set(
            [
              ...current.tier.components,
              ...next.tier.components,
              ...current.grants,
              ...next.grants,
            ].map((c) => c.packageId),
          ),
        ].sort(),
        hostCount: next.grants.reduce((n, g) => n + g.hosts.length, 0),
      },
    };
    const safe = presentLocalAuthorizationEvent(
      event,
      await this.options.secrets(s),
    );
    if (safe.localScope) {
      Object.values(safe.localScope).forEach((v) => {
        if (Array.isArray(v)) Object.freeze(v);
      });
      Object.freeze(safe.localScope);
    }
    await this.options.audit(s, Object.freeze(safe));
  }
  async invalidate(s: Session, rebound?: string): Promise<void> {
    const current = await s.core.localAuthorizationState();
    const invalid = new Set<string>();
    for (const d of [...current.tier.projects, ...current.tier.readOnly]) {
      try {
        if (
          d.root === rebound ||
          enginePermissionKey(d) !==
            enginePermissionKey(
              await this.directory(
                s,
                d.root,
                current.tier.projects.some((p) => p.root === d.root),
              ),
            )
        )
          invalid.add(d.root);
      } catch {
        invalid.add(d.root);
      }
    }
    if (!invalid.size) return;
    const next: LocalAuthorizationCommit = {
      ...current,
      assembly: await this.assembly(s),
      tier: {
        ...current.tier,
        projects: current.tier.projects.filter((d) => !invalid.has(d.root)),
        readOnly: current.tier.readOnly.filter((d) => !invalid.has(d.root)),
        components: [],
      },
      grants: current.grants.filter((g) => g.tier !== "project"),
    };
    await this.replace(
      s,
      current,
      next,
      "LOCAL_DIRECTORY_INVALIDATED",
      "revoke",
    );
  }
  async plan(s: Session, input?: TierSelection): Promise<TierPlan> {
    const current = await s.core.localAuthorizationState();
    const selection = structuredClone(
      input ?? {
        ceiling: current.tier.ceiling,
        projects: current.tier.projects.map((d) => d.root),
        readOnly: current.tier.readOnly.map((d) => d.root),
        components: (await s.core.listInstalled()).map((p) => p.id),
        hosts: Object.fromEntries(
          current.grants.map((g) => [
            g.packageId,
            Object.fromEntries(
              current.grants
                .filter((x) => x.packageId === g.packageId)
                .map((x) => [x.engineId, x.hosts]),
            ),
          ]),
        ),
      },
    );
    if (!selection || !Object.hasOwn(levels, selection.ceiling)) changed();
    for (const list of [
      selection.projects,
      selection.readOnly,
      selection.components,
    ])
      if (
        !Array.isArray(list) ||
        list.some((x) => typeof x !== "string") ||
        new Set(list).size !== list.length
      )
        changed();
    if (
      selection.ceiling === "sandbox" &&
      (selection.projects.length || selection.readOnly.length)
    )
      changed();
    const projects = await Promise.all(
      selection.projects.map((r) => this.directory(s, r, true)),
    );
    const readOnly = await Promise.all(
      selection.readOnly.map((r) => this.directory(s, r)),
    );
    const entries: TierEntry[] = [];
    for (const p of await s.core.listInstalled()) {
      const { manifest } = await s.core.getPackage(p.id);
      const engines = isManifestV2(manifest)
        ? manifest.permissions.filter(
            (p): p is EnginePermission => p.kind === "engine",
          )
        : [];
      const tier = engines.some((e) => (e.tier ?? "machine") === "machine")
        ? "machine"
        : "project";
      entries.push({
        packageId: p.id,
        name: p.name,
        formatVersion: manifest.formatVersion,
        confirmed: current.tier.components.some(
          (c) =>
            c.packageId === p.id &&
            c.installedAt === p.installedAt &&
            c.permissions === enginePermissionKey(manifest.permissions),
        ),
        permissions: manifest.permissions,
        engines: engines.map((e) => {
          const hosts = selection.hosts?.[p.id]?.[e.target] ?? [];
          if (
            !Array.isArray(hosts) ||
            new Set(hosts).size !== hosts.length ||
            hosts.some((h) => !e.network?.hosts.includes(h))
          )
            changed();
          const saved = current.grants.find(
            (g) => g.packageId === p.id && g.engineId === e.target,
          );
          const sameScope =
            enginePermissionKey(saved?.hosts) === enginePermissionKey(hosts) &&
            (tier === "machine" ||
              enginePermissionKey([
                current.tier.projects,
                current.tier.readOnly,
              ]) === enginePermissionKey([projects, readOnly]));
          return {
            engineId: e.target,
            tier,
            hosts,
            state:
              levels[tier] > levels[selection.ceiling]
                ? "tier-required"
                : saved?.installedAt === p.installedAt &&
                    saved.permission === enginePermissionKey(e) &&
                    saved.tier === tier &&
                    sameScope
                  ? "confirmed"
                  : "pending",
          };
        }),
      });
    }
    if (
      selection.components.some(
        (id) => !entries.some((e) => e.packageId === id),
      ) ||
      Object.entries(selection.hosts ?? {}).some(
        ([id, hosts]) =>
          !hosts ||
          typeof hosts !== "object" ||
          Array.isArray(hosts) ||
          Object.keys(hosts).some(
            (engine) =>
              !entries.some(
                (e) =>
                  e.packageId === id &&
                  e.engines.some((g) => g.engineId === engine),
              ),
          ),
      )
    )
      changed();
    const body = {
      selection,
      current,
      entries,
      projects,
      readOnly,
      assembly: await this.assembly(s),
      roots: s.record.roots,
    };
    return {
      ...body,
      fingerprint: createHash("sha256")
        .update(enginePermissionKey(body))
        .digest("hex"),
    };
  }
  private async commitFor(
    s: Session,
    plan: TierPlan,
  ): Promise<LocalAuthorizationCommit> {
    const assembly = await this.assembly(s),
      now = new Date().toISOString();
    const grants: AgentLocalGrant[] = [];
    for (const entry of plan.entries.filter((e) =>
      plan.selection.components.includes(e.packageId),
    )) {
      for (const e of entry.engines) {
        if (levels[e.tier] > levels[plan.selection.ceiling]) continue;
        if (e.tier === "project" && !plan.projects.length) changed();
        const permission = entry.permissions.find(
          (p) => "kind" in p && p.kind === "engine" && p.target === e.engineId,
        )!;
        const saved = plan.current.grants.find(
          (g) => g.packageId === entry.packageId && g.engineId === e.engineId,
        );
        const unchanged =
          saved &&
          saved.installedAt ===
            assembly.find((p) => p.packageId === entry.packageId)!
              .installedAt &&
          saved.permission === enginePermissionKey(permission) &&
          saved.tier === e.tier;
        grants.push({
          instanceId: s.record.instanceId,
          packageId: entry.packageId,
          engineId: e.engineId,
          installedAt: assembly.find((p) => p.packageId === entry.packageId)!
            .installedAt,
          permission: enginePermissionKey(permission),
          tier: e.tier,
          hosts: e.hosts,
          toolchains: unchanged ? saved.toolchains : [],
          configuration: unchanged ? saved.configuration : [],
          credentials: unchanged
            ? saved.credentials.filter((c) => e.hosts.includes(c.host))
            : [],
          grantedAt: e.state === "confirmed" ? saved!.grantedAt : now,
          authorizationId:
            e.state === "confirmed" ? saved!.authorizationId : randomUUID(),
          source: e.state === "confirmed" ? saved!.source : "confirmation",
        });
      }
    }
    return {
      revision: plan.current.revision,
      assembly,
      grants,
      tier: {
        instanceId: s.record.instanceId,
        ceiling: plan.selection.ceiling,
        projects: plan.projects,
        readOnly: plan.readOnly,
        components: assembly.filter((p) =>
          plan.selection.components.includes(p.packageId),
        ),
      },
    };
  }
  async ask(s: Session, plan: TierPlan): Promise<boolean> {
    const candidate = await this.commitFor(s, plan);
    const selected = plan.entries.filter((e) =>
      plan.selection.components.includes(e.packageId),
    );
    const versionControl = await Promise.all(
      plan.projects.map(async (d) => {
        const marker = await lstat(path.join(d.path, ".git")).catch(
          () => undefined,
        );
        return marker
          ? ""
          : `项目 ${d.root} 未发现版本控制标记，建议纳入版本控制并保持提交干净以便回滚。`;
      }),
    );
    const message = [
      `确认当前 Agent 的本地授权。档位上限：${tierNames[plan.selection.ceiling]}。`,
      `项目目录：${plan.projects.map((d) => `${d.root}（${d.path}）`).join("、") || "无"}。`,
      `额外只读目录：${plan.readOnly.map((d) => `${d.root}（${d.path}）`).join("、") || "无"}。`,
      ...(plan.projects.length
        ? [
            "项目档位仅适用于受信任项目。硬链接创建拦截与启动前校验不是内核级 inode 防线，非后代进程运行期新增别名仍有风险；宿主不提供回滚，项目运行当前不可用。",
            ...versionControl.filter(Boolean),
          ]
        : []),
      ...selected.map(
        (e) =>
          `${e.name}：${e.engines.length ? e.engines.map((g) => `入口 ${g.engineId}，${tierNames[g.tier]}档位，主机：${g.hosts.join("、") || "无"}${g.tier === "machine" ? `。${MACHINE_AUTHORIZATION_COPY}` : ""}`).join("；") : "无本地执行"}。`,
      ),
      ...selected.flatMap((e) =>
        e.permissions.map(
          (p) =>
            `“${e.name}”声明：${permissionDescription(p, e.formatVersion)}`,
        ),
      ),
    ].join("\n");
    const request = presentLocalAuthorizationConfirmation(
      {
        presentation: "local-authorization",
        subject: s.record.name,
        action: message,
        message,
      },
      await this.options.secrets(s),
    );
    const allowed = await confirmOnce(
      this.options.confirm,
      request,
      s.controller.signal,
    );
    if (!allowed) {
      const callId = randomUUID();
      try {
        await this.event(
          s,
          plan.current,
          candidate,
          "LOCAL_AUTHORIZATION_DENIED",
          "grant",
          callId,
          "denied",
        );
      } catch {
        failed("local_authorization_audit", callId);
      }
    }
    return allowed;
  }
  async confirm(
    s: Session,
    fingerprint: string,
    selection: TierSelection,
  ): Promise<boolean> {
    const plan = await this.plan(s, selection);
    if (plan.fingerprint !== fingerprint) changed();
    const next = await this.commitFor(s, plan);
    await this.replace(
      s,
      plan.current,
      next,
      "LOCAL_AUTHORIZATION_CONFIRMED",
      "grant",
      async () => {
        if ((await this.plan(s, selection)).fingerprint !== fingerprint)
          changed();
      },
    );
    return true;
  }
  async lower(s: Session, ceiling: AgentTierCeiling): Promise<void> {
    const current = await s.core.localAuthorizationState();
    if (
      !Object.hasOwn(levels, ceiling) ||
      levels[ceiling] > levels[current.tier.ceiling]
    )
      changed();
    const next: LocalAuthorizationCommit = {
      ...current,
      assembly: await this.assembly(s),
      tier: {
        ...current.tier,
        ceiling,
        ...(ceiling === "sandbox"
          ? { projects: [], readOnly: [], components: [] }
          : {}),
      },
      grants: current.grants.filter((g) => levels[g.tier] <= levels[ceiling]),
    };
    await this.replace(s, current, next, "LOCAL_TIER_LOWERED", "revoke");
  }
  async removeDirectory(
    s: Session,
    root: string,
    readOnly: boolean,
  ): Promise<void> {
    const current = await s.core.localAuthorizationState();
    const key = readOnly ? "readOnly" : "projects";
    if (!current.tier[key].some((d) => d.root === root)) changed();
    const tier = {
      ...current.tier,
      [key]: current.tier[key].filter((d) => d.root !== root),
      components: [],
    };
    const next: LocalAuthorizationCommit = {
      ...current,
      assembly: await this.assembly(s),
      tier,
      grants: current.grants.filter(
        (g) => g.tier === "machine" || tier.projects.length > 0,
      ),
    };
    await this.replace(s, current, next, "LOCAL_DIRECTORY_REMOVED", "revoke");
  }
  async revoke(s: Session, packageId?: string): Promise<void> {
    const current = await s.core.localAuthorizationState();
    if (
      packageId !== undefined &&
      !(await s.core.listInstalled()).some((p) => p.id === packageId)
    )
      changed();
    const next: LocalAuthorizationCommit = {
      ...current,
      assembly: await this.assembly(s),
      tier: {
        ...current.tier,
        components: current.tier.components.filter(
          (c) => packageId !== undefined && c.packageId !== packageId,
        ),
      },
      grants: current.grants.filter(
        (g) => packageId !== undefined && g.packageId !== packageId,
      ),
    };
    await this.replace(
      s,
      current,
      next,
      "LOCAL_AUTHORIZATION_REVOKED",
      "revoke",
    );
  }
  private async replace(
    s: Session,
    current: LocalAuthorizationState,
    next: LocalAuthorizationCommit,
    reason: string,
    phase: "grant" | "revoke",
    recheck?: () => Promise<void>,
  ) {
    const callId = randomUUID();
    next.tier.components = next.tier.components.filter((c) =>
      next.assembly.some(
        (p) => enginePermissionKey(p) === enginePermissionKey(c),
      ),
    );
    const affected = current.grants
      .filter((g) => {
        const candidate = next.grants.find(
          (n) => n.packageId === g.packageId && n.engineId === g.engineId,
        );
        return (
          !candidate ||
          enginePermissionKey({ ...g, grantedAt: "" }) !==
            enginePermissionKey({ ...candidate, grantedAt: "" }) ||
          (g.tier === "project" &&
            enginePermissionKey([
              current.tier.projects,
              current.tier.readOnly,
            ]) !==
              enginePermissionKey([next.tier.projects, next.tier.readOnly]))
        );
      })
      .map((g) => g.packageId);
    this.changing.set(s.record.instanceId, new Set(affected));
    try {
      try {
        await this.event(s, current, next, reason, phase, callId);
      } catch {
        failed("local_authorization_audit", callId);
      }
      await recheck?.();
      const stopped = await Promise.allSettled([
        this.options.stop(s, [...new Set(affected)]),
      ]);
      await recheck?.();
      const cleanupFailed = stopped.some((r) => r.status === "rejected");
      // A failed cleanup can revoke, but cannot add authority or expand the surviving scope.
      if (cleanupFailed && phase === "grant") {
        next = {
          ...next,
          tier: {
            ...current.tier,
            components: current.tier.components.filter((c) =>
              next.tier.components.some(
                (n) => enginePermissionKey(n) === enginePermissionKey(c),
              ),
            ),
          },
          grants: current.grants.filter((g) => !affected.includes(g.packageId)),
        };
      }
      let committed: boolean;
      try {
        committed = await s.core.commitLocalAuthorization(next);
      } catch {
        await this.event(
          s,
          current,
          next,
          "LOCAL_AUTHORIZATION_NOT_APPLIED",
          phase,
          callId,
          "failed",
        );
        failed("local_authorization_commit", callId);
      }
      if (!committed) {
        await this.event(
          s,
          current,
          next,
          "LOCAL_AUTHORIZATION_NOT_APPLIED",
          phase,
          callId,
          "failed",
        );
        changed();
      }
      if (cleanupFailed) failed("local_authorization_cleanup", callId);
    } finally {
      this.changing.delete(s.record.instanceId);
    }
  }
}
