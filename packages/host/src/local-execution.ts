import { checkProjectLinks } from "./project-links.js";
import {
  enginePermissionKey,
  isManifestV2,
  PlumsError,
  type AgentLocalGrant,
} from "@plums/core";
import { EngineManager, type EngineHooks } from "./engine-manager.js";
import type { Session } from "./host.js";
import { ProjectSandbox } from "./project-sandbox.js";
import { currentRecheck, installationToken } from "./recheck-cache.js";

const levels = { sandbox: 0, project: 1, machine: 2 };
export interface LocalExecutionAuthorization {
  grant: AgentLocalGrant;
  fingerprint: string;
}
/** One Agent's execution service. Entries still have independent supervised processes. */
export class AgentExecutionService {
  readonly manager: EngineManager;
  readonly project: ProjectSandbox;
  readonly hooks = new Map<string, EngineHooks>();
  constructor(
    readonly session: Session,
    nodePath?: string,
  ) {
    this.manager = new EngineManager(nodePath);
    this.project = new ProjectSandbox(nodePath);
  }
  async authorize(
    packageId: string,
    engineId: string,
  ): Promise<LocalExecutionAuthorization> {
    const s = this.session,
      checkpoint = s.core.runtimeAccessCheckpoint([packageId]),
      scope = currentRecheck();
    const read = async () => ({
      detail: await s.core.getPackage(packageId),
      state: await s.core.localAuthorizationState(),
    });
    const snapshot =
      scope && !scope.full
        ? await scope.epoch.authorization.inflight(
            await installationToken(s),
            packageId,
            read,
          )
        : await read();
    const { manifest, installed } = snapshot.detail;
    checkpoint.assertCurrent();
    if (!isManifestV2(manifest) || !installed.enabled)
      throw new PlumsError({
        code: "PERMISSION_DENIED",
        message: "本地入口未启用或未声明。",
      });
    const permissions = manifest.permissions.filter((p) => p.kind === "engine"),
      permission = permissions.find((p) => p.target === engineId);
    if (!permission)
      throw new PlumsError({
        code: "PERMISSION_DENIED",
        message: "组件未声明此本地入口。",
      });
    const tier = permission.tier ?? "machine",
      state = snapshot.state;
    if (levels[tier] > levels[state.tier.ceiling])
      throw new PlumsError({
        code: "TIER_REQUIRED",
        message: "Agent 档位上限不足。",
      });
    const grant = state.grants.find(
      (g) =>
        g.instanceId === s.record.instanceId &&
        g.packageId === packageId &&
        g.engineId === engineId &&
        g.installedAt === installed.installedAt &&
        g.permission === enginePermissionKey(permission) &&
        g.tier === tier,
    );
    if (!grant)
      throw new PlumsError({
        code: "LOCAL_CONFIRM_REQUIRED",
        message: "此组件的本地执行需要汇总确认。",
      });
    if (tier === "project") {
      for (const directory of state.tier.projects)
        await checkProjectLinks(directory.path);
      await this.project.assertAvailable();
    }
    if (!(await s.core.getConsent(packageId)))
      throw new PlumsError({
        code: "CONSENT_REQUIRED",
        message: "组件权限需要同意。",
      });
    checkpoint.assertCurrent();
    // Consent reads may yield. Re-read local state last so a concurrent revoke cannot escape.
    const current = await s.core.localAuthorizationState();
    checkpoint.assertCurrent();
    if (
      levels[tier] > levels[current.tier.ceiling] ||
      !current.grants.some(
        (g) => enginePermissionKey(g) === enginePermissionKey(grant),
      )
    )
      throw new PlumsError({
        code: "LOCAL_CONFIRM_REQUIRED",
        message: "本地执行授权已变化。",
      });
    return { grant, fingerprint: enginePermissionKey(grant) };
  }
}
