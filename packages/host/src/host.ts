import { WorkspaceLayouts } from "./workspace-layout.js";
import {
  PolicyService,
  operationFingerprint,
  type PolicyBinding,
  type PolicyScopeSelection,
} from "./policy-service.js";
import { ControlledExecution } from "./controlled-execution.js";
import { CommonService } from "./common-service.js";
import { ResourceStore } from "./resource-store.js";
import {
  ResourceService,
  resourceInstallation,
  validOperations,
  type ResourceRangeSelection,
} from "./resource-service.js";
import { resourceFailure } from "./resource-error.js";
import { invokeComponent } from "./invocation.js";
import { PanelSessions, type PanelDelivery } from "./panels.js";
import type { PanelLayout, PanelPost } from "@plums/sdk";
import {
  protocolPlan,
  protocolStatus,
  protocolFingerprint,
  protocolDenied,
  fixProtocolBinding,
  assemblyProtocols,
  requireProtocolSelections,
  protocolOrder,
  type ProtocolBinding,
} from "./protocol-bindings.js";
import type { GrantConfirm } from "./engine-grants.js";
import semver from "semver";
import {
  ComponentDrafts,
  checkDraftText,
  draftError,
  type ComponentSource,
  type ComponentInspection,
  type ComponentEditorState,
} from "./component-drafts.js";
import { EngineCoordinator } from "./engine-coordinator.js";
import { enablePlan, enablePrepared } from "./agent-launch.js";
import {
  httpsService,
  connectionAccess,
  grantConnectionAccess,
  validateConnectionSettings,
} from "./connection-service.js";
import { planAssembly } from "./assembly-plan.js";
import { dispatchSdk } from "./sdk-bridge.js";
import {
  bundleExtras,
  recoverComponentMutation,
} from "./component-transactions.js";
import {
  ComponentLibrary,
  digest,
  componentArtifact,
  rawCharacter,
  inputBytes,
  importInvalid,
  type LibraryItem,
  type ComponentArtifact,
} from "./library.js";
import {
  compose,
  binding,
  saveRecord as saveAgentRecord,
  writeExtras,
  readExtras,
  exportAssembly,
  mutateAssembly,
  recoverAssembly,
  checkRecordVersion,
  checkAssemblyRecovery,
  type ComponentBinding,
} from "./assembly.js";
import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  rm,
  mkdtemp,
  realpath,
  lstat,
  appendFile,
} from "node:fs/promises";
import path from "node:path";
import {
  createCore,
  isManifestV2,
  redact,
  secretRef,
  PlumsError,
  PERMISSION_DENIED,
  type Core,
  type SecretStore,
  type Confirm,
  type AuditEvent,
  type McpTool,
  type PackageContents,
  type EgressSink,
  type FsSink,
  readArchive,
  validatePackage,
  createArchive,
  DEFAULT_PACKAGE_LIMITS,
} from "@plums/core";
import {
  negotiateCommonContract,
  validateAgentBundle,
  inspectAgentBundle,
  createAgentBundle,
  desktopContribution,
  safePath,
  unmetDependencies,
  type AgentBundleManifest,
  type AgentBundle,
  type ContributionKind,
  type ProtocolBindingIntent,
  validateProtocolIntents,
} from "@plums/sdk";
import type {
  HostFoundationSession,
  InvocationContext,
} from "./foundation-runtime.js";
import {
  FoundationRegistry,
  createFoundationSession,
} from "./foundation-factory.js";
import {
  createOfficialFoundationRegistry,
  OFFICIAL_FOUNDATION_REFERENCE,
} from "./official-foundation.js";
import { HttpsSink, SecureFsSink, ioContext, type DnsMode } from "./io.js";
export type DesktopTheme = "system" | "light" | "dark";
export interface DesktopSettings {
  dnsMode: DnsMode;
  theme: DesktopTheme;
}
export interface AgentRecord {
  instanceId: string;
  name: string;
  agent: AgentBundleManifest;
  characterId?: string;
  recordVersion?: 2;
  components?: ComponentBinding[];
  extras?: string[];
  createdAt: string;
  roots: Record<string, string>;
  recoveryError?: string;
  protocolBindings?: ProtocolBinding[];
  backgroundComponents?: string[];
  policy?: PolicyBinding;
  controlledPrograms?: Record<
    string,
    {
      program: string;
      digest: string;
      reads: string[];
      writes: string[];
      rootIdentities: Record<string, { dev: number; ino: number }>;
    }
  >;
}
export interface HostOptions {
  dataDir: string;
  confirm: Confirm;
  grantConfirm?: GrantConfirm;
  secretStore: (instanceId: string) => SecretStore;
  nodePath?: string;
  egress?: EgressSink;
  fs?: FsSink;
  audit?: (instanceId: string, event: Readonly<AuditEvent>) => Promise<void>;
  event?: (
    instanceId: string,
    packageId: string,
    topic: string,
    data: unknown,
  ) => void;
  /** Internal fault-injection seam, never exposed to components. */
  resourceCommitFault?: (phase: "before-commit" | "after-commit") => void;
  panelEvent?: (event: PanelDelivery) => void | Promise<void>;
}
export interface Session {
  record: AgentRecord;
  core: Core;
  secrets: SecretStore;
  runtimes: Map<string, HostFoundationSession>;
  engineRuntimes: Map<string, Map<string, HostFoundationSession>>;
  mcpTools: Map<string, { tool: McpTool; state: string }[]>;
  controller: AbortController;
  engineController: AbortController;
  receipts: Map<
    string,
    {
      packageId: string;
      invocationId: string;
      status: number;
      engineScope?: string;
    }
  >;
}
function denied(): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "请求不属于当前 Agent 或已声明接口。",
  });
}
function uuid(id: string): void {
  if (typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id)) denied();
}
export class DesktopHost {
  private policy: PolicyService;
  private policyRuntimes = new WeakMap<
    Session,
    Map<string, HostFoundationSession>
  >();
  private controlled: ControlledExecution;
  private foundations: FoundationRegistry;
  private commonRuntimes = new WeakSet<HostFoundationSession>();
  private common: CommonService;
  private businessResources: ResourceService;
  private sessions = new Map<string, Session>();
  private recoveryErrors = new Map<string, string>();
  private opening = new Map<string, Promise<Session>>();
  private epochs = new Map<string, number>();
  private queues = new Map<string, Promise<unknown>>();
  private componentPreviews = new Map<
    string,
    { instanceId: string; bytes: Uint8Array; contents: PackageContents }
  >();
  private previews = new Map<string, AgentBundle>();
  private drafts: ComponentDrafts;
  private draftSnapshots = new Map<
    string,
    {
      draftToken: string;
      source: ComponentSource;
      baseDigest: string;
      artifact: ComponentArtifact;
    }
  >();
  readonly library: ComponentLibrary;
  private engines: EngineCoordinator;
  private panels: PanelSessions;
  private workspaceLayouts: WorkspaceLayouts;
  private runtimeClosing = new WeakMap<Session, Set<Promise<void>>>();
  private closing = new Map<string, Promise<void>>();
  private dnsMode: DnsMode = "auto";
  private theme: DesktopTheme = "system";
  private desktopSettingsQueue: Promise<void> = Promise.resolve();
  constructor(readonly options: HostOptions) {
    this.controlled = new ControlledExecution(
      options.nodePath ?? process.execPath,
    );
    this.foundations = createOfficialFoundationRegistry(
      options.nodePath ?? process.execPath,
      this.controlled,
    );
    this.common = new CommonService(
      path.join(options.dataDir, "common-tasks"),
      {
        active: (s) => {
          if (this.sessions.get(s.record.instanceId) !== s) denied();
        },
        controlledAllowed: async (s) => {
          if (this.engines.hasActive(s))
            throw resourceFailure("NOT_AUTHORIZED");
        },
        context: (s, pkg, signal) => this.invocationContext(s, pkg, signal),
        invoke: (s, pkg, requirementId, input, context) =>
          invokeComponent(s, pkg, { requirementId, input }, context, {
            active: () => {
              if (
                this.sessions.get(s.record.instanceId) !== s ||
                context.signal.aborted
              )
                denied();
            },
            runtime: (target) => this.runtime(s, target, undefined, context),
            retain: (target) =>
              this.common.retainComponent(s, target, context.taskId),
          }),
        takeoverQualified: async (s, owner, viewer) => {
          const from = await s.core.getPackage(owner),
            to = await s.core.getPackage(viewer),
            consent = await s.core.getConsent(viewer);
          if (!consent) return false;
          const normalized = (p: object) =>
            Object.fromEntries(
              Object.entries(p)
                .filter(([key]) => key !== "id" && key !== "reason")
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => [
                  key,
                  Array.isArray(value) ? [...value].sort() : value,
                ]),
            );
          if (
            !from.manifest.permissions.every((p) =>
              to.manifest.permissions.some(
                (v) =>
                  JSON.stringify(normalized(v)) ===
                    JSON.stringify(normalized(p)) &&
                  consent.permissions.some(
                    (c) => JSON.stringify(c) === JSON.stringify(v),
                  ),
              ),
            )
          )
            return false;
          return this.businessResources.takeoverQualified(s, owner, viewer);
        },
        sanitize: (s, value) =>
          this.secretValues(s).then((secrets) => redact(value, secrets)),
        audit: (s, callId, taskId, outcome, executionState) =>
          this.writeAudit(
            s.record.instanceId,
            Object.freeze({
              callId,
              taskId,
              timestamp: new Date().toISOString(),
              phase: outcome === "allowed" ? "allow" : "result",
              outcome,
              executionState,
            }),
          ),
      },
    );
    this.policy = new PolicyService({
      active: (s) => {
        if (this.sessions.get(s.record.instanceId) !== s)
          throw resourceFailure("STALE_BINDING");
      },
      expired: (s) => this.stopRuntimes(s),
      deadline: (s, taskId) =>
        taskId
          ? this.common.tasks.deadlineFor(s.record.instanceId, taskId)
          : undefined,
      actor: async (s, id) => (await this.common.identity(s, id)).actor,
      snapshot: (s) =>
        operationFingerprint([
          s.core.taskScopeState(),
          this.businessResources.range(s),
          this.businessResources.store.epoch(s.record.instanceId),
          s.record.roots,
          s.record.protocolBindings,
          s.record.controlledPrograms,
        ]),
      resources: (s) => this.businessResources.range(s),
      evaluate: async (s, binding, input, signal, check) => {
        const d = desktopContribution(
          (await s.core.getPackage(binding.providerId)).manifest,
        )!;
        const provided = d.protocols!.provides!.find(
          (p) => p.id === binding.provideId,
        )!;
        const runtime = await this.runtime(
          s,
          binding.providerId,
          undefined,
          undefined,
          true,
        );
        await check();
        return runtime.invoke(
          "tools",
          provided.contribution.name,
          { operation: "evaluate", input },
          {
            callers: [],
            ancestry: [binding.providerId],
            signal,
            assertActive: check,
            policyEvaluation: true,
          },
        );
      },
      secrets: (s) => this.secretValues(s),
      audit: (s, event) => this.writeAudit(s.record.instanceId, event),
      confirm: (message, signal) => this.policyConfirm(message, signal),
    });
    this.businessResources = new ResourceService(
      new ResourceStore(path.join(options.dataDir, "business-resources")),
      {
        active: (s) => {
          if (this.sessions.get(s.record.instanceId) !== s)
            throw resourceFailure("STALE_BINDING");
        },
        coreFile: (s) =>
          path.join(this.directory(s.record.instanceId), "core", "plums.db"),
        audit: (s, e) => this.writeAudit(s.record.instanceId, e),
        secrets: (s) => this.secretValues(s),
        confirm: async (_s, message, signal) => {
          if (signal.aborted) return false;
          return new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => finish(false), 120_000);
            const finish = (v: boolean) => {
              clearTimeout(timer);
              signal.removeEventListener("abort", cancel);
              resolve(v === true);
            };
            const cancel = () => finish(false);
            signal.addEventListener("abort", cancel, { once: true });
            Promise.resolve()
              .then(() => options.confirm.ask({ message }))
              .then(
                (v) => finish(v === true),
                () => finish(false),
              );
          });
        },
        policy: (s, op) => this.policy.assess(s, op),
        fault: options.resourceCommitFault,
      },
    );
    this.workspaceLayouts = new WorkspaceLayouts(
      path.join(options.dataDir, "ui-layouts"),
    );
    this.panels = new PanelSessions({
      current: (s) => this.sessions.get(s.record.instanceId) === s,
      files: (s, pkg, entry) => this.frontendFiles(s, pkg, entry),
      sanitize: async (s, data) => redact(data, await this.secretValues(s)),
      deliver: (event) => options.panelEvent?.(event),
      closedEndpoint: (s, componentId, handle) => {
        this.common.closeOrigin(handle);
        // Common providers serve multiple qualified containers. Legacy panel
        // runtimes retain their close-to-clear lifecycle.
        const runtime = s.runtimes.get(componentId);
        if (
          runtime &&
          !this.commonRuntimes.has(runtime) &&
          !this.common.usesComponent(s, componentId)
        ) {
          this.retireRuntime(s, runtime);
          s.runtimes.delete(componentId);
        }
      },
      closed: (s) => {
        if (
          !s.controller.signal.aborted &&
          !this.common.tasks.hasBackground(s.record.instanceId)
        )
          this.stopOrdinary(s);
      },
    });
    this.drafts = new ComponentDrafts(
      path.join(options.dataDir, "component-drafts"),
    );
    this.library = new ComponentLibrary(path.join(options.dataDir, "library"));
    this.engines = new EngineCoordinator({
      canRun: (s) => this.assertLegacyEngine(s),
      nodePath: options.nodePath,
      library: this.library,
      confirm: options.confirm,
      grantConfirm: options.grantConfirm,
      cleanupRuntime: async (s, scope) => {
        const runtimes = s.engineRuntimes.get(scope);
        if (runtimes)
          for (const runtime of runtimes.values())
            this.retireRuntime(s, runtime);
        s.engineRuntimes.delete(scope);
        for (const [id, receipt] of s.receipts)
          if (receipt.engineScope === scope) s.receipts.delete(id);
        await this.awaitRuntimeCleanup(s);
      },
      audit: (id, event) => this.writeAudit(id, event),
      sanitize: async (s, value) => redact(value, await this.secretValues(s)),
      event: (id, pkg, topic, data) => {
        const s = this.sessions.get(id);
        if (s)
          void this.secretValues(s)
            .then((values) =>
              options.event?.(id, pkg, topic, redact(data, values)),
            )
            .catch(() => {});
      },
      invoke: (
        id,
        owner,
        target,
        kind,
        name,
        input,
        signal,
        authorization,
        engineScope,
      ) =>
        this.invoke(
          id,
          owner,
          target,
          kind,
          name,
          input,
          signal,
          authorization,
          engineScope,
        ),
      protocolStatus: (id, owner, requirementId) =>
        this.protocolStatus(id, owner, requirementId),
      invokeProtocol: (
        id,
        owner,
        requirementId,
        input,
        signal,
        authorization,
        engineScope,
      ) =>
        this.invokeProtocol(
          id,
          owner,
          requirementId,
          input,
          signal,
          authorization,
          engineScope,
        ),
    });
  }
  private directory(id: string): string {
    uuid(id);
    return path.join(this.options.dataDir, "instances", id);
  }
  async initialize(): Promise<void> {
    try {
      const settings = JSON.parse(
        await readFile(path.join(this.options.dataDir, "desktop.json"), "utf8"),
      );
      if (["auto", "system", "cloudflare"].includes(settings.dnsMode))
        this.dnsMode = settings.dnsMode;
      this.theme = ["system", "light", "dark"].includes(settings.theme)
        ? settings.theme
        : "system";
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw Error("Desktop settings unavailable");
    }
    await this.library.initialize();
    const root = path.join(this.options.dataDir, "instances");
    await mkdir(root, { recursive: true });
    // The desktop holds a single-instance lock. Only unpublished staging trees are recovered.
    for (const name of await readdir(root))
      if (name.startsWith(".staging-"))
        await rm(path.join(root, name), { recursive: true, force: true });
    for (const name of await readdir(root))
      if (/^[a-f0-9-]{36}$/.test(name)) {
        const dir = this.directory(name),
          secrets = this.options.secretStore(name);
        try {
          checkRecordVersion(
            JSON.parse(
              await readFile(path.join(dir, "record.json"), "utf8"),
            ) as AgentRecord,
          );
          await checkAssemblyRecovery(dir);
          await recoverComponentMutation(
            dir,
            secrets,
            this.options.egress ?? new HttpsSink(),
          );
          const core = createCore({
            capabilityApproval: "task-or-confirm",
            dataDir: path.join(dir, "core"),
            secrets,
            egress: this.options.egress ?? new HttpsSink(),
          });
          try {
            await recoverAssembly(dir, core);
            await this.migrateRecord(dir, core);
          } finally {
            core.close();
          }
          this.recoveryErrors.delete(name);
        } catch {
          this.recoveryErrors.set(
            name,
            "此 Agent 的组合迁移或恢复失败，原始数据已保留。",
          );
        }
      }
  }
  private async migrateRecord(dir: string, core: Core): Promise<void> {
    const record = JSON.parse(
      await readFile(path.join(dir, "record.json"), "utf8"),
    ) as AgentRecord;
    checkRecordVersion(record);
    if (record.recordVersion === 2) return;
    const old = await validateAgentBundle(path.join(dir, "bundle.zip"));
    const artifacts: ComponentArtifact[] = [];
    for (const p of await core.listInstalled())
      artifacts.push(
        await componentArtifact(
          await core.exportPackage(await core.getPackageContents(p.id)),
        ),
      );
    const items = await this.library.put(artifacts),
      bindings = items.map((item) =>
        binding(
          item,
          old.packages.find((p) => p.contents.manifest.id === item.manifest.id)
            ?.archive,
        ),
      );
    const next = compose(record, bindings),
      extras = bundleExtras(old);
    await writeExtras(dir, extras);
    next.extras = Object.keys(extras);
    await saveAgentRecord(dir, next);
  }

  getDesktopSettings(): DesktopSettings {
    return { dnsMode: this.dnsMode, theme: this.theme };
  }
  async setDesktopSettings(dnsMode: unknown): Promise<void> {
    if (dnsMode !== "auto" && dnsMode !== "system" && dnsMode !== "cloudflare")
      denied();
    await this.saveDesktopSettings({ dnsMode });
  }
  async setDesktopTheme(theme: unknown): Promise<void> {
    if (theme !== "system" && theme !== "light" && theme !== "dark") denied();
    await this.saveDesktopSettings({ theme });
  }
  private saveDesktopSettings(patch: Partial<DesktopSettings>): Promise<void> {
    const save = this.desktopSettingsQueue.then(async () => {
      const settings = { ...this.getDesktopSettings(), ...patch };
      if (patch.dnsMode !== undefined) await this.close();
      const file = path.join(this.options.dataDir, "desktop.json");
      await writeFile(file + ".pending", JSON.stringify(settings));
      await rename(file + ".pending", file);
      this.dnsMode = settings.dnsMode;
      this.theme = settings.theme;
    });
    this.desktopSettingsQueue = save.catch(() => {});
    return save;
  }
  async listAgents(): Promise<AgentRecord[]> {
    const root = path.join(this.options.dataDir, "instances");
    await mkdir(root, { recursive: true });
    const result: AgentRecord[] = [];
    for (const name of await readdir(root))
      if (/^[a-f0-9-]{36}$/.test(name)) {
        try {
          const record = JSON.parse(
            await readFile(path.join(root, name, "record.json"), "utf8"),
          ) as AgentRecord;
          if (record.instanceId === name)
            result.push({
              ...record,
              recoveryError: this.recoveryErrors.get(name),
            });
        } catch {
          /* Uncommitted/corrupt instances are not executable. */
        }
      }
    return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async preview(input: string | Uint8Array): Promise<unknown> {
    const bytes = await inputBytes(input);
    if (bytes[0] !== 80 || bytes[1] !== 75)
      return this.previewLibraryArtifact(
        await rawCharacter(bytes, typeof input === "string" ? input : "角色卡"),
      );
    const files = await readArchive(bytes);
    if (!Object.hasOwn(files, "agent.json"))
      return this.previewLibraryArtifact(await componentArtifact(bytes));
    const bundle = await inspectAgentBundle(bytes);
    if (this.previews.size >= 4)
      this.previews.delete(this.previews.keys().next().value!);
    const token = randomUUID();
    this.previews.set(token, bundle);
    return {
      token,
      type: "agent",
      agent: bundle.agent,
      incomplete: bundle.packages.some(
        (p) =>
          unmetDependencies(
            p.contents.manifest,
            bundle.packages.map((p) => p.contents.manifest),
          ).length > 0,
      ),
      components: bundle.packages.map((p) => this.previewDetails(p.contents)),
    };
  }
  private libraryPreviews = new Map<string, ComponentArtifact>();
  private previewDetails(contents: PackageContents) {
    const m = contents.manifest;
    return {
      id: m.id,
      name: m.name,
      kind: m.kind,
      version: m.version,
      permissions: m.permissions,
      dependencies: m.dependencies,
      code: !!desktopContribution(m)?.runtime,
    };
  }
  private previewLibraryArtifact(artifact: ComponentArtifact) {
    if (this.libraryPreviews.size >= 4)
      this.libraryPreviews.delete(this.libraryPreviews.keys().next().value!);
    const token = randomUUID();
    this.libraryPreviews.set(token, artifact);
    return {
      token,
      type: "component",
      components: [this.previewDetails(artifact.contents)],
    };
  }
  async importLibrary(token: string): Promise<LibraryItem> {
    return this.serial("library", async () => {
      const artifact = this.libraryPreviews.get(token);
      if (!artifact) importInvalid("导入预览已失效。");
      this.libraryPreviews.delete(token);
      return (await this.library.put([artifact]))[0]!;
    });
  }
  async importBundleComponents(token: string): Promise<LibraryItem[]> {
    return this.serial("library", async () => {
      const bundle = this.previews.get(token);
      if (!bundle) importInvalid("导入预览已失效。");
      const items = await this.library.put(bundle.packages);
      this.previews.delete(token);
      return items;
    });
  }
  async listLibrary() {
    const items = await this.library.list(),
      agents = await this.listAgents();
    return items.map((item) => ({
      ...item,
      usedBy: agents
        .filter((a) => a.components?.some((p) => p.digest === item.digest))
        .map((a) => a.name),
      missingDependencies: unmetDependencies(
        item.manifest,
        items.map((i) => i.manifest),
      ),
    }));
  }
  async planAssembly(digests: string[]) {
    const items = await this.library.list(),
      plan = planAssembly(items, digests);
    return {
      ...plan,
      protocols: assemblyProtocols(
        items.filter((p) => plan.digests.includes(p.digest)),
      ),
    };
  }
  private async componentSource(source: ComponentSource) {
    if (!source || !["library", "agent"].includes(source.kind)) denied();
    if (source.kind === "library") {
      const artifact = await this.library.get(source.digest);
      return {
        source: { kind: "library", digest: source.digest } as ComponentSource,
        hash: source.digest,
        artifact,
      };
    }
    const s = await this.session(source.instanceId);
    await this.assertCoherent(source.instanceId);
    const bound = s.record.components?.find(
      (c) => c.packageId === source.packageId,
    );
    if (!bound) draftError("组件已从 Agent 移出。", "SOURCE_CHANGED");
    const installed = await s.core.getPackage(source.packageId);
    if (installed.installed.version !== bound.version)
      draftError("组件版本已变化，请重新打开。", "SOURCE_CHANGED");
    const artifact = await this.library.get(bound.digest);
    return {
      source: {
        kind: "agent",
        instanceId: source.instanceId,
        packageId: source.packageId,
      } as ComponentSource,
      hash: bound.digest,
      artifact,
    };
  }
  private async componentSecrets(): Promise<string[]> {
    const values: string[] = [];
    for (const a of await this.listAgents())
      values.push(
        ...(await this.secretValues(await this.session(a.instanceId))),
      );
    return values;
  }
  private async checkComponentSecrets(p: ComponentArtifact) {
    const secrets = await this.componentSecrets();
    await createArchive(
      {
        "manifest.json": Buffer.from(JSON.stringify(p.contents.manifest)),
        ...p.contents.files,
      },
      DEFAULT_PACKAGE_LIMITS,
      secrets,
    );
    return secrets;
  }
  async inspectComponent(
    source: ComponentSource,
  ): Promise<ComponentInspection> {
    const {
      source: bound,
      hash,
      artifact,
    } = await this.componentSource(source);
    await this.checkComponentSecrets(artifact);
    const manifestText = new TextDecoder("utf-8", { fatal: true }).decode(
      (await validatePackage(artifact.bytes)).manifestBytes,
    );
    return {
      source: bound,
      baseDigest: hash,
      manifestText,
      suggestedVersion: semver.inc(
        artifact.contents.manifest.version,
        "patch",
      )!,
      files: [
        { path: "manifest.json", size: Buffer.byteLength(manifestText) },
        ...Object.entries(artifact.contents.files).map(([path, bytes]) => ({
          path,
          size: bytes.length,
        })),
      ].sort((a, b) => a.path.localeCompare(b.path)),
    };
  }
  async openComponentDraft(source: ComponentSource) {
    return this.serial(`draft-source:${JSON.stringify(source)}`, async () => {
      const {
        source: bound,
        hash,
        artifact,
      } = await this.componentSource(source);
      const secrets = await this.checkComponentSecrets(artifact);
      const existing = await this.drafts.find(bound);
      if (existing)
        return this.drafts.serial(existing, () =>
          this.drafts.view(existing, secrets),
        );
      const token = await this.drafts.create(
        {
          source: bound,
          baseDigest: hash,
          suggestedVersion: semver.inc(
            artifact.contents.manifest.version,
            "patch",
          )!,
        },
        artifact,
      );
      return this.drafts.view(token, secrets);
    });
  }
  async readComponentDraft(token: string) {
    return this.drafts.serial(token, async () =>
      this.drafts.view(token, await this.componentSecrets()),
    );
  }
  async retainComponentDraft(token: string, editor: ComponentEditorState) {
    return this.drafts.serial(token, async () => {
      if (
        !editor ||
        !["manifest", "payload", "files"].includes(editor.tab) ||
        typeof editor.revision !== "string" ||
        !/^[a-f0-9]{64}$/.test(editor.revision)
      )
        denied();
      const secrets = await this.componentSecrets();
      checkDraftText(editor.manifestText, secrets);
      checkDraftText(editor.payloadText, secrets);
      await this.drafts.setEditor(token, editor);
    });
  }
  async writeComponentDraft(token: string, text: string, revision: string) {
    return this.drafts.serial(token, async () => {
      const secrets = await this.componentSecrets();
      checkDraftText(text, secrets);
      await this.drafts.writeManifest(token, text, revision);
      return this.drafts.view(token, secrets);
    });
  }
  async revealComponentDraft(token: string, relative?: string) {
    return this.drafts.serial(token, async () => {
      await this.drafts.view(token, await this.componentSecrets());
      return this.drafts.reveal(token, relative);
    });
  }
  async discardComponentDraft(token: string) {
    return this.drafts.serial(token, async () => {
      await this.drafts.discard(token);
      for (const [key, value] of this.draftSnapshots)
        if (value.draftToken === token) this.draftSnapshots.delete(key);
    });
  }
  private async assertDraftSource(source: ComponentSource, expected: string) {
    if ((await this.componentSource(source)).hash !== expected)
      draftError(
        "原组件已更新，请保留草稿并重新打开当前版本。",
        "SOURCE_CHANGED",
      );
  }
  private async checkDraftVersion(
    p: ComponentArtifact,
    base: import("@plums/core").Manifest,
  ) {
    const m = p.contents.manifest;
    for (const field of ["id", "kind"] as const)
      if (m[field] !== base[field])
        draftError(
          "新制品必须保持原组件的标识和类型。",
          "IDENTITY_CHANGED",
          `/${field}`,
        );
    if (!semver.gt(m.version, base.version))
      draftError("新版本必须高于基版。", "VERSION_NOT_HIGHER", "/version");
    const hash = digest(p.bytes);
    if (
      (await this.library.list()).some(
        (i) =>
          i.manifest.id === m.id &&
          i.manifest.version === m.version &&
          i.digest !== hash,
      )
    )
      draftError(
        "公共库已有同版本的其他内容，请更换版本号。",
        "VERSION_CONFLICT",
        "/version",
      );
  }
  private async draftComposition(
    source: ComponentSource,
    p: ComponentArtifact,
  ) {
    if (source.kind !== "agent") return;
    const s = await this.session(source.instanceId),
      c = s.record.components!.find((c) => c.packageId === source.packageId)!;
    const item = {
      digest: digest(p.bytes),
      manifest: p.contents.manifest,
      createdAt: new Date().toISOString(),
    };
    const next = compose(
      s.record,
      s.record.components!.map((existing) =>
        existing === c ? binding(item, c.archive) : existing,
      ),
    );
    await this.validateComposition(source.instanceId, s, next, p);
  }
  async validateComponentDraft(token: string) {
    return this.drafts.serial(token, async () => {
      const meta = await this.drafts.metadata(token);
      await this.assertDraftSource(meta.source, meta.baseDigest);
      const original = await this.componentSource(meta.source);
      const bytes = await createArchive(
        await this.drafts.files(token),
        DEFAULT_PACKAGE_LIMITS,
        await this.componentSecrets(),
      );
      const artifact = await componentArtifact(bytes);
      await this.checkDraftVersion(
        artifact,
        original.artifact.contents.manifest,
      );
      await this.draftComposition(meta.source, artifact);
      if (this.draftSnapshots.size >= 16)
        this.draftSnapshots.delete(this.draftSnapshots.keys().next().value!);
      const validationToken = randomUUID();
      this.draftSnapshots.set(validationToken, {
        draftToken: token,
        source: structuredClone(meta.source),
        baseDigest: meta.baseDigest,
        artifact,
      });
      return {
        validationToken,
        manifest: structuredClone(artifact.contents.manifest),
        source: meta.source,
      };
    });
  }
  async componentDraftSnapshot(token: string, validationToken: string) {
    const snapshot = this.draftSnapshots.get(validationToken);
    if (!snapshot || snapshot.draftToken !== token)
      draftError("校验快照已失效，请重新校验。", "SNAPSHOT_MISSING");
    await this.checkComponentSecrets(snapshot.artifact);
    return {
      source: structuredClone(snapshot.source),
      manifest: structuredClone(snapshot.artifact.contents.manifest),
    };
  }
  async saveComponentDraft(
    token: string,
    validationToken: string,
    consent = false,
  ) {
    return this.drafts.serial(token, async () => {
      const snapshot = this.draftSnapshots.get(validationToken);
      if (!snapshot || snapshot.draftToken !== token)
        draftError("校验快照已失效，请重新校验。", "SNAPSHOT_MISSING");
      return this.serial("library", async () => {
        const run = async () => {
          await this.drafts.metadata(token);
          const p = snapshot.artifact,
            source = snapshot.source;
          await this.assertDraftSource(source, snapshot.baseDigest);
          const secrets = await this.checkComponentSecrets(p);
          await this.checkDraftVersion(
            p,
            (await this.componentSource(source)).artifact.contents.manifest,
          );
          await this.draftComposition(source, p);
          const item = (await this.library.put([p]))[0]!;
          if (source.kind === "library") {
            await this.drafts.rebase(
              token,
              p,
              semver.inc(item.manifest.version, "patch")!,
            );
            return { librarySaved: true, applied: false, item };
          }
          try {
            const s = await this.session(source.instanceId),
              c = s.record.components!.find(
                (c) => c.packageId === source.packageId,
              )!;
            const next = compose(
              s.record,
              s.record.components!.map((existing) =>
                existing === c ? binding(item, c.archive) : existing,
              ),
            );
            await this.changeComponent(
              source.instanceId,
              s,
              next,
              source.packageId,
              item.manifest.version,
              () => s.core.updatePackage(p.bytes, { consent }),
            );
            await this.drafts.rebase(
              token,
              p,
              semver.inc(item.manifest.version, "patch")!,
            );
            return { librarySaved: true, applied: true, item };
          } catch (error) {
            // Cleanup errors can follow a committed update. Report its actual binding.
            let current: AgentRecord | undefined;
            let values = secrets;
            try {
              current = (await this.listAgents()).find(
                (a) => a.instanceId === source.instanceId,
              );
              values = [...secrets, ...(await this.componentSecrets())];
            } catch {
              /* Preserve the committed library result even when recovery is pending. */
            }
            return {
              librarySaved: true,
              applied:
                current?.components?.some(
                  (c) =>
                    c.packageId === source.packageId &&
                    c.digest === item.digest,
                ) === true,
              item,
              error:
                error instanceof PlumsError
                  ? redact(
                      {
                        code: error.code,
                        message: error.message,
                        path: error.path,
                        details: error.details,
                      },
                      values,
                    )
                  : {
                      code: "DESKTOP_FAILED",
                      message: "新版本已入公共库，当前 Agent 更新未完成。",
                    },
            };
          }
        };
        return snapshot.source.kind === "agent"
          ? this.serial(snapshot.source.instanceId, run)
          : run();
      });
    });
  }
  async exportLibrary(hash: string): Promise<Uint8Array> {
    return this.serial("library", async () => {
      const p = await this.library.get(hash),
        secrets: string[] = [];
      for (const a of await this.listAgents())
        secrets.push(
          ...(await this.secretValues(await this.session(a.instanceId))),
        );
      return createArchive(
        {
          "manifest.json": new TextEncoder().encode(
            JSON.stringify(p.contents.manifest),
          ),
          ...p.contents.files,
        },
        DEFAULT_PACKAGE_LIMITS,
        secrets,
      );
    });
  }
  async removeLibrary(hash: string) {
    return this.serial("library", () =>
      this.library.remove(hash, async () =>
        (await this.listAgents()).some((a) =>
          a.components?.some((p) => p.digest === hash),
        ),
      ),
    );
  }
  async install(token: string): Promise<AgentRecord> {
    return this.serial("library", async () => {
      const bundle = this.previews.get(token);
      if (!bundle) importInvalid("导入预览已失效。");
      if (
        bundle.packages.some(
          (p) =>
            unmetDependencies(
              p.contents.manifest,
              bundle.packages.map((p) => p.contents.manifest),
            ).length,
        )
      )
        importInvalid("这份 ZIP 还缺少匹配组件，请选择继续组装后补齐。");
      this.previews.delete(token);
      return this.installAssembly(bundle);
    });
  }
  private async installAssembly(bundle: AgentBundle): Promise<AgentRecord> {
    const instanceId = randomUUID(),
      root = path.join(this.options.dataDir, "instances");
    await mkdir(root, { recursive: true });
    const staging = await mkdtemp(path.join(root, ".staging-"));
    const core = createCore({
      capabilityApproval: "task-or-confirm",
      dataDir: path.join(staging, "core"),
      secrets: this.options.secretStore(instanceId),
      egress: new HttpsSink(),
    });
    try {
      for (const p of bundle.packages) await core.importPackage(p.bytes);
      const items = await this.library.put(bundle.packages),
        components = items.map((item, i) =>
          binding(item, bundle.packages[i]!.archive),
        );
      const primary = bundle.packages.find(
        (p) => p.archive === bundle.agent.character,
      )?.contents.manifest.id;
      const record = compose(
        {
          instanceId,
          name: bundle.agent.name,
          agent: bundle.agent,
          characterId: primary,
          createdAt: new Date().toISOString(),
          roots: {},
        },
        components,
      );
      const importedChoices = bundle.agent.protocolBindings ?? [];
      delete record.agent.protocolBindings;
      record.protocolBindings = [];
      for (const choice of importedChoices)
        record.protocolBindings.push(
          await fixProtocolBinding(core, record, choice),
        );
      protocolOrder(
        bundle.packages.map((p) => p.contents.manifest),
        (await protocolPlan(core, record)).requirements,
      );
      const extras = bundleExtras(bundle);
      record.extras = Object.keys(extras);
      await writeExtras(staging, extras);
      await saveAgentRecord(staging, record);
      await mkdir(path.join(staging, "agent-data"), { recursive: true });
      core.close();
      await rename(staging, this.directory(instanceId));
      return record;
    } catch (e) {
      core.close();
      await rm(staging, { recursive: true, force: true });
      throw e;
    }
  }
  async createAgent(
    name: string,
    digests: string[] = [],
    characterId?: string,
    startup?: string,
    protocolBindings: ProtocolBindingIntent[] = [],
  ): Promise<AgentRecord> {
    return this.serial("library", async () => {
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 256 ||
        !Array.isArray(digests)
      )
        importInvalid("Agent 名称或组件选择无效。");
      const components: Record<string, Uint8Array> = {},
        agent: AgentBundleManifest = {
          bundleVersion: "1.0",
          id: "agent-" + randomUUID(),
          name: name.trim(),
          version: "1.0.0",
          characters: [],
          extensions: [],
          connectors: [],
        };
      for (const hash of digests) {
        const p = await this.library.get(hash),
          m = p.contents.manifest,
          archive = `components/${m.id}.zip`;
        if (components[archive])
          importInvalid("同一 Agent 不能选择重复包 id。");
        components[archive] = p.bytes;
        if (m.kind === "character") {
          if (m.id === characterId) agent.character = archive;
          else agent.characters!.push(archive);
        } else if (m.kind === "extension") agent.extensions.push(archive);
        else agent.connectors.push(archive);
      }
      if (characterId && !agent.character)
        importInvalid("默认角色卡未被选择。");
      if (startup) agent.startup = startup;
      const selectedItems = (await this.library.list()).filter((p) =>
        digests.includes(p.digest),
      );
      validateProtocolIntents(protocolBindings, selectedItems);
      const protocols = assemblyProtocols(selectedItems, protocolBindings);
      requireProtocolSelections(protocols);
      protocolOrder(
        selectedItems.map((p) => p.manifest),
        protocols,
      );
      agent.protocolBindings = structuredClone(protocolBindings);
      const bundle = await validateAgentBundle(
        await createAgentBundle(agent, components),
      );
      if (
        startup &&
        !desktopContribution(
          bundle.packages.find((p) => p.contents.manifest.id === startup)!
            .contents.manifest,
        )?.frontend
      )
        importInvalid("工作界面需要前端扩展。");
      return this.installAssembly(bundle);
    });
  }
  private session(id: string): Promise<Session> {
    const cached = this.sessions.get(id);
    if (cached) return Promise.resolve(cached);
    let opening = this.opening.get(id);
    if (!opening) {
      opening = this.openSession(id);
      this.opening.set(id, opening);
      void opening.finally(() => this.opening.delete(id)).catch(() => {});
    }
    return opening;
  }
  private async openSession(id: string): Promise<Session> {
    const epoch = this.epochs.get(id) ?? 0;
    await this.closing.get(id);
    if (this.recoveryErrors.has(id))
      importInvalid(this.recoveryErrors.get(id)!);
    const dir = this.directory(id),
      record = JSON.parse(
        await readFile(path.join(dir, "record.json"), "utf8"),
      ) as AgentRecord;
    if (record.instanceId !== id) denied();
    checkRecordVersion(record);
    const secrets = this.options.secretStore(id),
      controller = new AbortController();
    const egress = this.options.egress ?? new HttpsSink(this.dnsMode);
    const core: Core = createCore({
      capabilityApproval: "task-or-confirm",
      capabilityGate: (input) => this.capabilityPolicy(s, input),
      instanceId: id,
      services: { https: httpsService(() => core, egress) },
      dataDir: path.join(dir, "core"),
      secrets,
      egress,
      fs: this.options.fs ?? new SecureFsSink(),
      programs: Object.fromEntries(
        Object.entries(record.controlledPrograms ?? {}).map(([id, b]) => [
          id,
          b.program,
        ]),
      ),
      exec: {
        run: async (req) => {
          const context = ioContext.getStore();
          if (!context?.execCheck) denied();
          await context.execCheck();
          const b = record.controlledPrograms?.[context.programTarget!];
          if (!b) denied();
          const check = async () => {
            await context.execCheck!();
            const platform = await realpath(this.options.dataDir);
            for (const logical of [...b.reads, ...b.writes]) {
              const directory = record.roots[logical];
              if (!directory) denied();
              const actual = await realpath(directory),
                identity = await lstat(directory),
                saved = b.rootIdentities?.[logical];
              if (
                actual !== directory ||
                !identity.isDirectory() ||
                identity.isSymbolicLink() ||
                !saved ||
                saved.dev !== identity.dev ||
                saved.ino !== identity.ino ||
                actual === platform ||
                actual.startsWith(platform + path.sep) ||
                platform.startsWith(actual + path.sep)
              )
                denied();
            }
            await context.execCheck!();
          };
          return this.controlled.run(
            req.program,
            req.args,
            req.cwd,
            b.reads.map((r) => record.roots[r]!),
            b.writes.map((r) => record.roots[r]!),
            context.signal,
            check,
            b.digest,
            [await realpath(this.options.dataDir)],
          );
        },
      },
      confirm: this.options.confirm,
      roots: { "agent-data": path.join(dir, "agent-data"), ...record.roots },
      onAudit: (event) => this.writeAudit(id, event),
    });
    const s: Session = {
      record,
      core,
      secrets,
      controller,
      engineController: new AbortController(),
      runtimes: new Map(),
      engineRuntimes: new Map(),
      receipts: new Map(),
      mcpTools: new Map(),
    };
    if ((this.epochs.get(id) ?? 0) !== epoch) {
      core.close();
      denied();
    }
    this.businessResources.store.ensureAgent(id, record.name);
    this.sessions.set(id, s);
    return s;
  }
  private serial<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(id) ?? Promise.resolve()).then(fn, fn);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    this.queues.set(id, settled);
    void settled.then(() => {
      if (this.queues.get(id) === settled) this.queues.delete(id);
    });
    return run;
  }
  async resources(id: string): Promise<unknown> {
    if (this.recoveryErrors.has(id)) {
      const record = (await this.listAgents()).find((a) => a.instanceId === id);
      if (!record) denied();
      return { record, packages: [] };
    }
    const s = await this.session(id);
    const packages = await s.core.listInstalled();
    const details = await Promise.all(
      packages.map(async (p) => {
        const { manifest } = await s.core.getPackage(p.id);
        return {
          ...p,
          manifest,
          settings: await s.core.describeSettings(p.id),
          desktop: desktopContribution(manifest),
          ...(await connectionAccess(s.core, p.id, s.record)),
          mcpTools: s.mcpTools.get(p.id),
          engines: await Promise.all(
            (desktopContribution(manifest)?.engines ?? []).map((d) =>
              this.engines.status(s, p.id, d.id),
            ),
          ),
          compatibility: desktopContribution(manifest)?.model
            ? "This component requires an explicit upgrade to an external SDK v2 connector."
            : undefined,
        };
      }),
    );
    return redact(
      { record: s.record, packages: details },
      await this.secretValues(s),
    );
  }
  private async policyConfirm(
    message: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted) return false;
    return new Promise((resolve) => {
      const finish = (value: boolean) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        resolve(value === true);
      };
      const abort = () => finish(false);
      const timer = setTimeout(() => finish(false), 120_000);
      signal.addEventListener("abort", abort, { once: true });
      Promise.resolve()
        .then(() => this.options.confirm.ask({ message }))
        .then(
          (v) => finish(v === true),
          () => finish(false),
        );
    });
  }
  private credentialFree(input: unknown): import("@plums/sdk").CommonJson {
    const clean = (value: any): any => {
      if (value instanceof Uint8Array)
        return {
          bytes: value.byteLength,
          sha256: createHash("sha256").update(value).digest("hex"),
        };
      if (Array.isArray(value)) return value.map(clean);
      if (value && typeof value === "object" && value.headers) {
        const { headers, ...rest } = value;
        return clean({ ...rest, headerNames: Object.keys(headers) });
      }
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .filter(
              ([key]) =>
                !/^(authorization|proxy-authorization|cookie|set-cookie|api[-_]?key|password|secret|token|credentials)$/i.test(
                  key,
                ),
            )
            .map(([key, value]) => [key, clean(value)]),
        );
      return value ?? null;
    };
    return clean(input);
  }
  private async capabilityPolicy(
    s: Session,
    input: Parameters<
      NonNullable<import("@plums/core").CreateCoreOptions["capabilityGate"]>
    >[0],
  ) {
    const io = ioContext.getStore(),
      context = io?.invocation;
    if (!context) {
      if (s.record.policy)
        throw resourceFailure("POLICY_UNAVAILABLE", input.callId);
      return undefined;
    }
    const request = input.request;
    const principals = [
      ...input.callers,
      { packageId: input.packageId, permissionId: input.permissionId },
    ];
    if (
      s.record.policy &&
      s.core.taskScopeState() &&
      request.kind !== "exec" &&
      !s.core.taskScopeCovers(principals, request)
    )
      throw resourceFailure("NOT_AUTHORIZED", input.callId);
    const required: import("./policy-service.js").PolicyOperation["required"] =
      [];
    if (request.kind === "exec") {
      const program = s.record.controlledPrograms?.[input.target];
      for (const target of program?.reads ?? [])
        required.push({ category: "fs", operation: "read", target });
      for (const target of program?.writes ?? [])
        required.push({ category: "fs", operation: "write", target });
    }
    if (io?.mcpTool)
      required.push({
        category: "https",
        operation:
          request.kind === "egress"
            ? "send"
            : request.kind === "service"
              ? request.operation
              : "request",
        target: input.target,
      });
    const gate = await this.policy.assess(s, {
      required,
      permissionId: input.permissionId,
      packageId: input.packageId,
      callId: input.callId,
      category: io?.mcpTool
        ? "tool"
        : request.kind === "service" || request.kind === "egress"
          ? "https"
          : request.kind,
      operation: io?.mcpTool
        ? "invoke"
        : request.kind === "exec"
          ? "run"
          : request.kind === "egress"
            ? "send"
            : request.operation,
      target: io?.mcpTool
        ? input.packageId + "/" + io.mcpTool.name
        : input.target,
      intent: this.credentialFree(
        io?.mcpTool ? { request, tool: io.mcpTool } : request,
      ),
      fingerprintInput: { request, mcpTool: io?.mcpTool ?? null },
      context,
    });
    if (gate && io) {
      io.signal = gate.signal;
      const before = io.assertActive;
      io.assertActive = async () => {
        await before?.();
        await gate.recheck();
      };
      if (io.execCheck) {
        const original = io.execCheck;
        io.execCheck = async () => {
          await original();
          await gate.recheck();
        };
      }
      return { assertCurrent: gate.recheck };
    }
    return undefined;
  }
  async policyPlan(id: string) {
    const s = await this.session(id),
      packages = await s.core.listInstalled(),
      candidates = [],
      available: PolicyScopeSelection[] = [];
    for (const p of packages) {
      const manifest = (await s.core.getPackage(p.id)).manifest,
        d = desktopContribution(manifest);
      if (p.enabled && d?.common?.policy) {
        try {
          candidates.push({
            name: p.name,
            binding: await this.policy.candidate(
              s,
              p.id,
              d.common.policy.provideId,
              "custom",
            ),
          });
        } catch {}
      }
      if (!p.enabled) continue;
      if (!isManifestV2(manifest)) continue;
      for (const permission of manifest.permissions) {
        if (!("kind" in permission)) continue;
        if (permission.kind === "fs")
          for (const operation of permission.operations)
            available.push({
              componentId: p.id,
              category: "fs",
              operation,
              target: permission.target,
            });
        if (
          permission.kind === "exec" &&
          s.record.controlledPrograms?.[permission.target]
        )
          available.push({
            componentId: p.id,
            category: "exec",
            operation: "run",
            target: permission.target,
          });
        if (permission.kind === "egress")
          available.push({
            componentId: p.id,
            category: "https",
            operation: "send",
            target: permission.target,
          });
        if (permission.kind === "service")
          for (const operation of permission.operations)
            available.push({
              componentId: p.id,
              category: "https",
              operation,
              target: permission.target,
            });
      }
    }
    for (const p of packages.filter((p) => p.enabled))
      for (const target of packages.filter((p) => p.enabled)) {
        const d = desktopContribution(
          (await s.core.getPackage(target.id)).manifest,
        );
        if (d?.common?.policy) continue;
        for (const tool of d?.contributes?.tools ?? [])
          available.push({
            componentId: p.id,
            category: "tool",
            operation: "invoke",
            target: target.id + "/" + tool.name,
          });
      }
    for (const p of packages.filter((p) => p.enabled))
      for (const [connector, tools] of s.mcpTools)
        for (const tool of tools)
          if (tool.state === "APPROVED")
            available.push({
              componentId: p.id,
              category: "tool",
              operation: "invoke",
              target: connector + "/" + tool.tool.name,
            });
    const resourceRange = this.businessResources.range(s);
    for (const row of resourceRange?.selection ?? [])
      for (const operation of row.operations)
        available.push({
          componentId: row.componentId,
          category: "resource",
          operation,
          target: row.resourceId,
        });
    const unique = [
      ...new Map(available.map((v) => [operationFingerprint(v), v])).values(),
    ];
    const plan = {
      selected: s.record.policy ?? null,
      candidates,
      available: unique,
      active: this.policy.state(s),
      componentNames: Object.fromEntries(packages.map((p) => [p.id, p.name])),
      targetNames: Object.fromEntries(
        this.businessResources.store.spaces().map((s) => [s.id, s.name]),
      ),
    };
    return {
      ...plan,
      fingerprint: operationFingerprint([
        s.record,
        packages,
        plan.candidates,
        unique,
        this.businessResources.store.epoch(id),
      ]),
    };
  }
  async selectPolicy(
    id: string,
    fingerprint: string,
    providerId?: string,
    provideId?: string,
    mode = "custom",
  ) {
    return this.serial(id, async () => {
      const plan = await this.policyPlan(id);
      if (plan.fingerprint !== fingerprint)
        throw resourceFailure("STALE_BINDING");
      const s = await this.session(id);
      const binding = providerId
        ? await this.policy.candidate(s, providerId, provideId!, mode)
        : undefined;
      await this.stopRuntimes(s);
      await this.commitRecord(id, { ...s.record, policy: binding });
    });
  }
  async grantPolicyScope(
    id: string,
    fingerprint: string,
    durationMs: number,
    selection: PolicyScopeSelection[],
  ) {
    const copied = structuredClone(selection);
    return this.serial(id, async () => {
      const s = await this.session(id);
      // A live lease must be explicitly revoked; do not let an async plan silently replace it.
      if (this.policy.state(s)) throw resourceFailure("NOT_AUTHORIZED");
      await this.policy.settled(id);
      const plan = await this.policyPlan(id);
      if (plan.fingerprint !== fingerprint)
        throw resourceFailure("STALE_BINDING");
      if (plan.active || this.engines.hasActive(s))
        throw resourceFailure("NOT_AUTHORIZED");
      return this.policy.grant(s, durationMs, copied, plan.available);
    });
  }
  async revokePolicyScope(id: string) {
    const s = await this.session(id);
    this.policy.invalidate(id);
    await this.stopRuntimes(s);
    await this.writeAudit(
      id,
      Object.freeze({
        callId: randomUUID(),
        timestamp: new Date().toISOString(),
        phase: "revoke",
        outcome: "denied",
        executionState: "not_started",
        reason: "POLICY_SCOPE_REVOKED",
      }),
    );
  }
  async policyStatus(id: string) {
    const s = await this.session(id);
    return {
      selected: s.record.policy
        ? { mode: s.record.policy.mode, providerId: s.record.policy.providerId }
        : null,
      active: this.policy.state(s),
    };
  }
  async taskScopePlan(id: string) {
    const s = await this.session(id);
    const plan = await s.core.taskScopePlan();
    const entries = await Promise.all(
      plan.entries.map(async (entry) => ({
        ...entry,
        serviceTargets: (
          await connectionAccess(s.core, entry.packageId, s.record)
        ).serviceTargets,
      })),
    );
    return redact(
      {
        ...plan,
        entries: entries
          .map((e) => ({
            ...e,
            permissions: e.permissions.filter(
              (p) =>
                p.kind !== "service" ||
                p.target !== "https" ||
                e.serviceTargets[p.id]?.length,
            ),
          }))
          .filter((e) => e.permissions.length),
        name: s.record.name,
        active: s.core.taskScopeState(),
      },
      await this.secretValues(s),
    );
  }
  async grantTaskScope(
    id: string,
    fingerprint: string,
    durationMs: number,
    selection?: import("@plums/core").TaskScopeSelection[],
  ) {
    return this.serial(id, async () => {
      const s = await this.session(id);
      await this.assertCoherent(id);
      await this.engines.stopAgent(s);
      return s.core.grantTaskScope(fingerprint, durationMs, selection);
    });
  }
  async revokeTaskScope(id: string) {
    const s = await this.session(id);
    const taskId = s.core.taskScopeState()?.taskId;
    s.core.revokeTaskScope();
    this.stopOrdinary(s);
    await this.common.stopAgent(s);
    await Promise.allSettled([
      ...(this.pendingRuntimes.get(s)?.values() ?? []),
    ]);
    const cleanup = await Promise.allSettled([
      this.foundations.settleCleanup(s.record.instanceId),
      this.awaitRuntimeCleanup(s),
    ]);
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    const event: AuditEvent = {
      callId: randomUUID(),
      timestamp: new Date().toISOString(),
      phase: "task",
      outcome: "denied",
      executionState: "not_started",
      reason: "TASK_REVOKED",
      ...(taskId ? { taskId } : {}),
    };
    if (this.options.audit) await this.options.audit(id, event);
    else
      await appendFile(
        path.join(this.directory(id), "audit.jsonl"),
        JSON.stringify(event) + "\n",
        { mode: 0o600 },
      );
  }
  async protocolPlan(id: string) {
    const s = await this.session(id);
    return redact(
      await protocolPlan(s.core, s.record),
      await this.secretValues(s),
    );
  }
  async setProtocolBinding(
    id: string,
    fingerprint: string,
    consumerId: string,
    requirementId: string,
    choice?: ProtocolBindingIntent,
  ) {
    const copied = choice === undefined ? undefined : structuredClone(choice);
    return this.serial(id, async () => {
      const s = await this.session(id),
        plan = await protocolPlan(s.core, s.record);
      if (
        fingerprint !== plan.fingerprint ||
        !plan.requirements.some(
          (p) =>
            p.consumerId === consumerId && p.requirement.id === requirementId,
        )
      )
        protocolDenied("PROTOCOL_SELECTION_CHANGED");
      if (
        copied &&
        (copied.consumerId !== consumerId ||
          copied.requirementId !== requirementId)
      )
        protocolDenied();
      const next = structuredClone(s.record);
      next.protocolBindings = (next.protocolBindings ?? []).filter(
        (b) => b.consumerId !== consumerId || b.requirementId !== requirementId,
      );
      if (copied)
        next.protocolBindings.push(
          await fixProtocolBinding(s.core, s.record, copied),
        );
      protocolOrder(
        await Promise.all(
          (await s.core.listInstalled()).map(
            async (p) => (await s.core.getPackage(p.id)).manifest,
          ),
        ),
        (await protocolPlan(s.core, next)).requirements,
      );
      for (const grant of await s.core.listGrants())
        await s.core.revokeGrant(grant.id);
      await this.commitRecord(id, next);
    });
  }
  async protocolStatus(id: string, owner: string, requirementId: string) {
    const s = await this.session(id);
    if (
      desktopContribution((await s.core.getPackage(owner)).manifest)
        ?.sdkVersion !== "2"
    )
      denied();
    return protocolStatus(s.core, s.record, owner, requirementId);
  }
  async agentEnablePlan(id: string) {
    const s = await this.session(id);
    return redact(
      await enablePlan(s.core, s.record),
      await this.secretValues(s),
    );
  }
  async enableAgent(id: string, fingerprint: string) {
    return this.serial(id, async () => {
      const s = await this.session(id);
      await this.assertCoherent(id);
      await enablePrepared(s.core, s.record, fingerprint);
    });
  }
  async enable(
    id: string,
    packageId: string,
    expected?: string,
    expectedAccess?: string,
  ): Promise<void> {
    return this.serial(id, async () => {
      const s = await this.session(id);
      if (
        expected !== undefined &&
        JSON.stringify((await s.core.getPackage(packageId)).manifest) !==
          expected
      )
        denied();
      if (
        expectedAccess !== undefined &&
        (await connectionAccess(s.core, packageId, s.record)).fingerprint !==
          expectedAccess
      )
        denied();
      const protocols = (await protocolPlan(s.core, s.record)).requirements;
      requireProtocolSelections(protocols, packageId);
      protocolOrder(
        await Promise.all(
          (await s.core.listInstalled()).map(
            async (p) => (await s.core.getPackage(p.id)).manifest,
          ),
        ),
        protocols,
      );
      for (const binding of protocols.filter(
        (p) =>
          p.consumerId === packageId &&
          p.selected &&
          ["bound", "disabled"].includes(p.state),
      ))
        if (
          !(await s.core.getPackage(binding.selected!.providerId)).installed
            .enabled
        )
          protocolDenied("PROTOCOL_PROVIDER_DISABLED");
      await s.core.grantConsent(packageId);
      await s.core.enable(packageId);
      await grantConnectionAccess(s.core, packageId, s.record);
    });
  }
  async disable(id: string, packageId: string): Promise<void> {
    return this.serial(id, async () => {
      const s = await this.session(id);
      await this.stopSession(id);
      await s.core.disable(packageId);
    });
  }
  async uninstallPackage(id: string, packageId: string): Promise<void> {
    return this.serial("library", () =>
      this.serial(id, async () => {
        const s = await this.session(id),
          component = s.record.components?.find(
            (p) => p.packageId === packageId,
          );
        if (!component) denied();
        const next = compose(
          s.record,
          s.record.components!.filter((p) => p !== component),
        );
        await this.validateComposition(id, s, next);
        await this.changeComponent(id, s, next, packageId, undefined, () =>
          s.core.uninstall(packageId),
        );
      }),
    );
  }
  async previewComponent(
    id: string,
    input: string | Uint8Array,
  ): Promise<unknown> {
    const s = await this.session(id),
      bytes = await inputBytes(input),
      contents = await validatePackage(bytes);
    desktopContribution(contents.manifest, contents.files);
    if (this.componentPreviews.size >= 4)
      this.componentPreviews.delete(
        this.componentPreviews.keys().next().value!,
      );
    const token = randomUUID();
    this.componentPreviews.set(token, { instanceId: id, bytes, contents });
    return redact(
      { token, manifest: contents.manifest },
      await this.secretValues(s),
    );
  }
  private componentPreview(id: string, token: string) {
    const p = this.componentPreviews.get(token);
    if (!p || p.instanceId !== id) importInvalid("组件预览已失效。");
    this.componentPreviews.delete(token);
    return p;
  }
  async importComponent(id: string, token: string): Promise<void> {
    const p = this.componentPreview(id, token);
    await this.addArtifact(id, p);
  }
  async addLibraryComponent(id: string, hash: string): Promise<void> {
    await this.addArtifact(id, await this.library.get(hash));
  }
  private async addArtifact(id: string, p: ComponentArtifact): Promise<void> {
    return this.serial("library", () =>
      this.serial(id, async () => {
        const s = await this.session(id);
        if (
          s.record.components!.some(
            (c) => c.packageId === p.contents.manifest.id,
          )
        )
          importInvalid("组件已安装；换版本请使用更新。");
        const item = (await this.library.put([p]))[0]!,
          next = compose(s.record, [...s.record.components!, binding(item)]);
        await this.validateComposition(id, s, next, p);
        await this.changeComponent(
          id,
          s,
          next,
          item.manifest.id,
          item.manifest.version,
          () => s.core.importPackage(p.bytes),
        );
      }),
    );
  }
  async editAgent(
    id: string,
    name: string,
    characterId?: string,
    startup?: string,
  ): Promise<void> {
    return this.serial(id, async () => {
      const s = await this.session(id);
      if (typeof name !== "string" || !name.trim() || name.length > 256)
        importInvalid("Agent 名称无效。");
      if (
        characterId &&
        !s.record.components!.some(
          (p) => p.packageId === characterId && p.kind === "character",
        )
      )
        denied();
      if (startup) {
        const p = await s.core.getPackageContents(startup);
        if (!desktopContribution(p.manifest, p.files)?.frontend) denied();
      }
      const next = compose(s.record, s.record.components!, {
        characterId,
        startup,
      });
      next.name = name.trim();
      next.agent.name = next.name;
      await this.commitRecord(id, next);
    });
  }
  async setStartup(id: string, packageId?: string): Promise<void> {
    const s = await this.session(id);
    await this.editAgent(id, s.record.name, s.record.characterId, packageId);
  }
  async setCharacter(id: string, packageId?: string): Promise<void> {
    const s = await this.session(id);
    await this.editAgent(id, s.record.name, packageId, s.record.agent.startup);
  }
  async updatePackage(
    id: string,
    token: string,
    packageId: string,
    consent = false,
  ): Promise<unknown> {
    const p = this.componentPreview(id, token);
    return this.serial("library", () =>
      this.serial(id, async () => {
        const s = await this.session(id);
        if (p.contents.manifest.id !== packageId) denied();
        const component = s.record.components!.find(
          (c) => c.packageId === packageId,
        );
        if (!component) denied();
        const item = (await this.library.put([p]))[0]!,
          next = compose(
            s.record,
            s.record.components!.map((c) =>
              c === component ? binding(item, component.archive) : c,
            ),
          );
        await this.validateComposition(id, s, next, p);
        return this.changeComponent(
          id,
          s,
          next,
          packageId,
          item.manifest.version,
          () => s.core.updatePackage(p.bytes, { consent }),
        );
      }),
    );
  }
  async previewLibraryUpdate(id: string, hash: string): Promise<unknown> {
    const p = await this.library.get(hash),
      token = randomUUID();
    if (this.componentPreviews.size >= 4)
      this.componentPreviews.delete(
        this.componentPreviews.keys().next().value!,
      );
    this.componentPreviews.set(token, { instanceId: id, ...p });
    return { token, manifest: p.contents.manifest };
  }
  private async validateComposition(
    id: string,
    s: Session,
    next: AgentRecord,
    replacement?: ComponentArtifact,
  ) {
    const components: Record<string, Uint8Array> = {};
    for (const c of next.components!) {
      if (replacement?.contents.manifest.id === c.packageId)
        components[c.archive] = replacement.bytes;
      else
        components[c.archive] = await s.core.exportPackage(
          await s.core.getPackageContents(c.packageId),
        );
    }
    await createAgentBundle(
      next.agent,
      components,
      await readExtras(this.directory(id), next),
      await this.secretValues(s),
    );
  }
  private async changeComponent<T>(
    id: string,
    s: Session,
    next: AgentRecord,
    packageId: string,
    version: string | undefined,
    operation: () => Promise<T>,
  ): Promise<T> {
    await this.assertCoherent(id);
    await this.stopRuntimes(s);
    try {
      return await mutateAssembly(
        this.directory(id),
        s.core,
        next,
        packageId,
        version,
        operation,
      );
    } finally {
      await this.stopSession(id);
    }
  }
  async bindRoot(id: string, name: string, selected: string): Promise<void> {
    return this.serial(id, async () => {
      if (!/^[a-zA-Z0-9_.-]{1,64}$/.test(name) || name === "agent-data")
        denied();
      const s = await this.session(id);
      const root = await realpath(selected);
      const protectedDir = await realpath(this.options.dataDir);
      const within = (parent: string, child: string) =>
        child === parent ||
        child.startsWith(
          parent.endsWith(path.sep) ? parent : parent + path.sep,
        );
      if (within(root, protectedDir) || within(protectedDir, root)) denied();
      await this.commitRecord(id, {
        ...s.record,
        roots: { ...s.record.roots, [name]: root },
      });
    });
  }
  async unbindRoot(id: string, name: string): Promise<void> {
    return this.serial(id, async () => {
      if (
        typeof name !== "string" ||
        !/^[a-zA-Z0-9_.-]{1,64}$/.test(name) ||
        name === "agent-data"
      )
        denied();
      const s = await this.session(id);
      const roots = { ...s.record.roots };
      delete roots[name];
      await this.commitRecord(id, { ...s.record, roots });
    });
  }
  async setSettings(
    id: string,
    packageId: string,
    values: Record<string, unknown>,
    secretValues: Record<string, string>,
  ): Promise<void> {
    return this.serial(id, async () => {
      const s = await this.session(id);
      const { manifest } = await s.core.getPackage(packageId);
      const connections = desktopContribution(manifest)?.connections ?? [];
      validateConnectionSettings(
        connections,
        values,
        manifest.settingsSchema?.properties ?? {},
      );
      await this.stopRuntimes(s);
      const description = await s.core.describeSettings(packageId);
      const saving = { ...values };
      const undo = new Map<string, string | undefined>();
      try {
        for (const [key, spec] of Object.entries(
          manifest.settingsSchema?.properties ?? {},
        ))
          if (spec["x-secret"]) {
            const ref = secretRef(packageId, key);
            if (Object.hasOwn(secretValues, key)) {
              undo.set(ref, await s.secrets.get(ref));
              await s.secrets.set(ref, secretValues[key]!);
              saving[key] = ref;
            } else if (description.secrets[key]) saving[key] = ref;
          }
        await s.core.setSettings(packageId, saving);
      } catch (error) {
        for (const [ref, value] of undo) {
          if (value === undefined) await s.secrets.delete(ref);
          else await s.secrets.set(ref, value);
        }
        throw error;
      }
      if (connections.length) {
        let failure: unknown;
        for (const owner of new Set(
          (await s.core.listBackgroundConsents())
            .filter((g) => g.binding.startsWith(packageId + "/"))
            .map((g) => g.extensionId),
        )) {
          try {
            for (const connection of connections)
              await s.core.revokeBackgroundConsent(
                owner,
                packageId + "/" + connection.id,
              );
          } catch (error) {
            failure ??= error;
          }
        }
        if (failure) throw failure;
      }
    });
  }
  async audit(id: string): Promise<unknown[]> {
    await this.session(id);
    try {
      return (
        await readFile(path.join(this.directory(id), "audit.jsonl"), "utf8")
      )
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw Error("Audit unavailable");
    }
  }
  private async secretValues(s: Session): Promise<string[]> {
    const refs = (
      await Promise.all(
        (await s.core.listInstalled()).map((p) =>
          s.core.getSecretReferences(p.id),
        ),
      )
    ).flat();
    return (await Promise.all(refs.map((r) => s.secrets.get(r)))).filter(
      (v): v is string => v !== undefined,
    );
  }
  async exportAgent(id: string): Promise<Uint8Array> {
    return this.serial(id, async () => {
      const s = await this.session(id);
      return exportAssembly(
        this.directory(id),
        s.record,
        s.core,
        await this.secretValues(s),
      );
    });
  }
  async removeAgent(id: string): Promise<void> {
    return this.serial("library", () =>
      this.serial(id, async () => {
        const s = await this.session(id);
        await this.stopSession(id);
        for (const p of await s.core.listInstalled())
          await s.core.uninstall(p.id);
        s.core.close();
        this.businessResources.store.detachAgent(id);
        await rm(this.directory(id), { recursive: true, force: true });
      }),
    );
  }
  private retireRuntime(s: Session, runtime: HostFoundationSession): void {
    runtime.stop();
    let closing = this.runtimeClosing.get(s);
    if (!closing) {
      closing = new Set();
      this.runtimeClosing.set(s, closing);
    }
    const pending = runtime.close();
    closing.add(pending);
    // Successful cleanup can be discarded. Keep a failed cleanup observable by
    // the next awaited management shutdown; synchronous close callbacks cannot throw it away.
    void pending.then(
      () => closing!.delete(pending),
      () => {},
    );
  }
  private async awaitRuntimeCleanup(s: Session): Promise<void> {
    const settled = await Promise.allSettled([
      ...(this.runtimeClosing.get(s) ?? []),
    ]);
    const failed = settled.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  private stopOrdinary(s: Session): void {
    this.policy.invalidate(s.record.instanceId);
    for (const runtime of this.policyRuntimes.get(s)?.values() ?? [])
      this.retireRuntime(s, runtime);
    this.policyRuntimes.delete(s);
    this.businessResources.invalidate(s.record.instanceId);
    s.core.revokeTaskScope();
    s.controller.abort();
    for (const runtime of s.runtimes.values()) this.retireRuntime(s, runtime);
    s.runtimes.clear();
    for (const [id, receipt] of s.receipts)
      if (!receipt.engineScope) s.receipts.delete(id);
    s.controller = new AbortController();
  }
  private async stopRuntimes(s: Session): Promise<void> {
    this.stopOrdinary(s);
    s.engineController.abort();
    for (const collection of s.engineRuntimes.values())
      for (const runtime of collection.values()) this.retireRuntime(s, runtime);
    s.engineRuntimes.clear();
    s.receipts.clear();
    try {
      const services = await Promise.allSettled([
        this.common.stopAgent(s),
        this.engines.stopAgent(s),
      ]);
      await Promise.allSettled([
        ...(this.pendingRuntimes.get(s)?.values() ?? []),
      ]);
      const cleanup = await Promise.allSettled([
        this.foundations.settleCleanup(s.record.instanceId),
        this.awaitRuntimeCleanup(s),
      ]);
      const failed = [...services, ...cleanup].find(
        (r) => r.status === "rejected",
      );
      if (failed?.status === "rejected") throw failed.reason;
    } finally {
      s.engineController = new AbortController();
    }
  }
  private async commitRecord(id: string, record: AgentRecord): Promise<void> {
    await this.stopSession(id);
    try {
      await saveAgentRecord(this.directory(id), record);
    } finally {
      await this.stopSession(id);
    }
  }
  stopSession(id: string): Promise<void> {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    const s = this.sessions.get(id);
    this.sessions.delete(id);
    if (!s) {
      const opening = this.opening.get(id),
        closing = this.closing.get(id);
      if (!opening) return closing ?? Promise.resolve();
      return Promise.allSettled([opening]).then(async () => {
        await closing;
        if (this.sessions.has(id)) await this.stopSession(id);
      });
    }
    const stopping = this.stopRuntimes(s).finally(() => s.core.close());
    this.closing.set(id, stopping);
    void stopping.then(
      () => {
        if (this.closing.get(id) === stopping) this.closing.delete(id);
      },
      () => {},
    );
    return stopping;
  }
  async close(): Promise<void> {
    const settled = await Promise.allSettled(
      [
        ...new Set([
          ...this.sessions.keys(),
          ...this.opening.keys(),
          ...this.closing.keys(),
        ]),
      ].map((id) => this.stopSession(id)),
    );
    try {
      await this.controlled.close();
    } finally {
      this.businessResources.close();
    }
    const failed = settled.find((r) => r.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  private async writeAudit(id: string, event: AuditEvent): Promise<void> {
    if (this.options.audit) await this.options.audit(id, event);
    else
      await appendFile(
        path.join(this.directory(id), "audit.jsonl"),
        JSON.stringify(event) + "\n",
        { mode: 0o600 },
      );
  }
  async resourcePlan(id: string) {
    const s = await this.session(id),
      store = this.businessResources.store;
    const requirements = [];
    const packages = await s.core.listInstalled();
    for (const installed of packages) {
      const manifest = (await s.core.getPackage(installed.id)).manifest;
      for (const requirement of desktopContribution(manifest)?.common
        ?.resources ?? []) {
        const permission = manifest.permissions.find(
          (p) => p.id === requirement.permissionId,
        );
        requirements.push({
          ...requirement,
          componentId: installed.id,
          componentName: installed.name,
          target: permission?.target,
          installation: resourceInstallation(s, installed.id, installed),
          enabled: installed.enabled,
        });
      }
    }
    const plan = {
      epoch: store.epoch(id),
      spaces: store.spaces(),
      qualifications: store.qualifications().filter((q) => q.agentId === id),
      bindings: store.bindings(id),
      requirements,
      active: await this.businessResources.status(s),
    };
    return {
      ...plan,
      fingerprint: protocolFingerprint([
        plan.epoch,
        plan.spaces,
        plan.qualifications,
        plan.bindings,
        requirements,
        s.record.components,
      ]),
    };
  }
  private async resourcePlanCheck(id: string, fingerprint: string) {
    const plan = await this.resourcePlan(id);
    if (plan.fingerprint !== fingerprint)
      throw resourceFailure("STALE_BINDING");
    return plan;
  }
  async createResourceGroup(
    id: string,
    fingerprint: string,
    name: string,
    contentContract = "opaque-json/1",
  ) {
    return this.serial(id, async () => {
      await this.resourcePlanCheck(id, fingerprint);
      if (
        typeof name !== "string" ||
        !name.trim() ||
        name.length > 128 ||
        typeof contentContract !== "string" ||
        !contentContract ||
        contentContract.length > 128
      )
        throw resourceFailure("INVALID_REQUEST");
      return this.businessResources.store.createShared(
        name.trim(),
        contentContract,
      );
    });
  }
  async setResourceQualification(
    id: string,
    fingerprint: string,
    resourceId: string,
    componentId: string,
    operations: import("@plums/sdk").ResourceOperation[],
  ) {
    const copied = validOperations(operations);
    return this.serial(id, async () => {
      const plan = await this.resourcePlanCheck(id, fingerprint),
        s = await this.session(id),
        space = this.businessResources.store.space(resourceId);
      if (
        typeof componentId !== "string" ||
        (componentId &&
          !plan.requirements.some((r) => r.componentId === componentId)) ||
        (space.scope === "agent" && space.ownerAgentId !== id)
      )
        throw resourceFailure("NOT_AUTHORIZED");
      this.businessResources.store.setQualification(
        {
          agentId: id,
          resourceId,
          componentId,
          operations: copied,
        },
        plan.epoch,
      );
      await this.stopRuntimes(s);
    });
  }
  async setResourceBinding(
    id: string,
    fingerprint: string,
    componentId: string,
    requirementId: string,
    resourceId?: string,
  ) {
    return this.serial(id, async () => {
      const plan = await this.resourcePlanCheck(id, fingerprint),
        s = await this.session(id);
      const r = plan.requirements.find(
        (r) => r.componentId === componentId && r.id === requirementId,
      );
      if (!r) throw resourceFailure("INVALID_REQUEST");
      if (resourceId !== undefined) {
        const space = this.businessResources.store.space(resourceId);
        if (r.target !== "business" && r.target !== space.scope)
          throw resourceFailure("NOT_AUTHORIZED");
        this.businessResources.store.bind(
          {
            agentId: id,
            componentId,
            requirementId,
            resourceId,
            installation: r.installation,
          },
          plan.epoch,
        );
      } else
        this.businessResources.store.unbind(
          id,
          componentId,
          requirementId,
          plan.epoch,
        );
      await this.stopRuntimes(s);
    });
  }
  async removeResourceGroup(
    id: string,
    fingerprint: string,
    resourceId: string,
  ) {
    return this.serial(id, async () => {
      await this.resourcePlanCheck(id, fingerprint);
      this.businessResources.store.remove(resourceId);
    });
  }
  async grantResourceRange(
    id: string,
    fingerprint: string,
    mode: "task" | "full-access",
    durationMs: number,
    selection: ResourceRangeSelection[],
  ) {
    const copied = structuredClone(selection);
    return this.serial(id, async () => {
      await this.resourcePlanCheck(id, fingerprint);
      const s = await this.session(id);
      await this.stopRuntimes(s);
      return this.businessResources.grant(s, mode, durationMs, copied);
    });
  }
  async revokeResourceRange(id: string) {
    const s = await this.session(id),
      range = this.businessResources.range(s),
      callId = randomUUID();
    await this.stopRuntimes(s);
    try {
      await this.writeAudit(
        id,
        Object.freeze({
          callId,
          ...(range ? { taskId: range.id } : {}),
          timestamp: new Date().toISOString(),
          kind: "resource",
          phase: "revoke",
          outcome: "denied",
          executionState: "not_started",
          reason: "RESOURCE_RANGE_REVOKED",
        }),
      );
    } catch {
      throw resourceFailure("PROVIDER_FAILED", callId, "not_started", "revoke");
    }
  }
  async bindControlledProgram(
    id: string,
    target: string,
    program: string,
    reads: string[],
    writes: string[],
  ) {
    return this.serial(id, async () => {
      const s = await this.session(id);
      if (
        typeof target !== "string" ||
        !Array.isArray(reads) ||
        !Array.isArray(writes)
      )
        denied();
      if (
        !(
          await Promise.all(
            (await s.core.listInstalled()).map((p) => s.core.getPackage(p.id)),
          )
        ).some((p) =>
          p.manifest.permissions.some(
            (q) => "kind" in q && q.kind === "exec" && q.target === target,
          ),
        )
      )
        denied();
      const root = await realpath(this.options.dataDir),
        rootIdentities: Record<string, { dev: number; ino: number }> = {};
      for (const logical of [...reads, ...writes]) {
        const dir = s.record.roots[logical];
        if (!dir || logical === "agent-data") denied();
        const actual = await realpath(dir),
          identity = await lstat(dir);
        if (
          !identity.isDirectory() ||
          identity.isSymbolicLink() ||
          actual !== dir ||
          actual === root ||
          root.startsWith(actual + path.sep) ||
          actual.startsWith(root + path.sep)
        )
          denied();
        rootIdentities[logical] = { dev: identity.dev, ino: identity.ino };
      }
      const chosen = await realpath(program);
      const next = {
        ...s.record,
        controlledPrograms: {
          ...s.record.controlledPrograms,
          [target]: {
            program: chosen,
            digest: createHash("sha256")
              .update(await readFile(chosen))
              .digest("hex"),
            reads: [...new Set(reads)],
            writes: [...new Set(writes)],
            rootIdentities,
          },
        },
      };
      await this.commitRecord(id, next);
    });
  }
  async permitTaskTakeover(
    id: string,
    taskId: string,
    pkg: string,
    enabled: boolean,
  ) {
    return this.common.permitTakeover(
      await this.session(id),
      taskId,
      pkg,
      enabled,
    );
  }
  async commonTasks(id: string) {
    const s = await this.session(id);
    return Promise.all(
      this.common.tasks.list(id).map(async (t) => ({
        ...t,
        takeoverCandidates: await this.common.takeoverPlan(
          s,
          t.description.taskId,
        ),
      })),
    );
  }
  async stopCommonTask(id: string, taskId: string) {
    const s = await this.session(id),
      t = this.common.tasks
        .list(id)
        .find((t) => t.description.taskId === taskId);
    if (!t) denied();
    const owner = await this.common.identity(
      s,
      t.description.owner.componentId,
    );
    await this.common.tasks.stop(taskId, owner.actor, owner.signature);
  }
  async setComponentBackground(id: string, pkg: string, enabled: boolean) {
    return this.serial(id, async () => {
      const s = await this.session(id);
      if (
        !desktopContribution((await s.core.getPackage(pkg)).manifest)?.common
          ?.background
      )
        denied();
      await this.stopRuntimes(s);
      const next = {
        ...s.record,
        backgroundComponents: [
          ...(s.record.backgroundComponents ?? []).filter((p) => p !== pkg),
          ...(enabled ? [pkg] : []),
        ],
      };
      await this.commitRecord(id, next);
    });
  }
  async frontendCommon(
    sessionId: string,
    source: string,
    method: string,
    args: Record<string, unknown>,
  ) {
    const copied = structuredClone(args);
    const p = await this.panels.principal(sessionId, source);
    const base = await this.invocationContext(
      p.agent,
      p.context.componentId,
      p.signal,
    );
    if (method === "policyStatus") {
      await p.assertActive();
      return this.policyStatus(p.agent.record.instanceId);
    }
    return this.common.call(p.agent, p.context.componentId, method, copied, {
      ...base,
      frontend: p.context,
      resourceInstanceId: p.context.handle,
      assertActive: async () => {
        await p.assertActive();
        await base.assertActive!();
      },
    });
  }
  async frontendResource(
    sessionId: string,
    source: string,
    method: string,
    args: Record<string, unknown>,
  ) {
    const copied = structuredClone(args),
      p = await this.panels.principal(sessionId, source),
      owner = p.context.componentId;
    const base = await this.invocationContext(p.agent, owner, p.signal);
    return this.businessResources.call(p.agent, owner, method, copied, {
      ...base,
      resourceInstanceId: p.context.handle,
      frontend: p.context,
      assertActive: async () => {
        await p.assertActive();
        await base.assertActive!();
      },
    });
  }
  async engineCall(
    id: string,
    pkg: string,
    method: string,
    args: Record<string, unknown>,
  ) {
    const s = await this.session(id);
    if (
      desktopContribution((await s.core.getPackage(pkg)).manifest)
        ?.sdkVersion !== "2"
    )
      denied();
    const result = await this.dispatchEngine(s, pkg, method, args);
    return method === "request"
      ? redact(result, await this.secretValues(s))
      : result;
  }
  private async dispatchEngine(
    s: Session,
    pkg: string,
    method: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    if (method === "start" || method === "request")
      await this.assertLegacyEngine(s);
    const engine = args.engineId as string;
    switch (method) {
      case "start":
        return this.engines.start(s, pkg, engine);
      case "request":
        return this.engines.request(
          s,
          pkg,
          engine,
          args.method as string,
          args.input,
          args.requestId as string | undefined,
        );
      case "cancel":
        return this.engines.cancel(s, pkg, engine, args.requestId as string);
      case "stop":
        return this.engines.stop(s, pkg, engine);
      case "status":
        return this.engines.status(s, pkg, engine);
      default:
        return denied();
    }
  }
  async engineStatus(id: string, pkg: string, engine: string) {
    return this.engines.status(await this.session(id), pkg, engine);
  }
  async startEngine(id: string, pkg: string, engine: string) {
    const s = await this.session(id);
    await this.assertLegacyEngine(s);
    return this.engines.start(s, pkg, engine);
  }
  async stopEngine(id: string, pkg: string, engine: string) {
    return this.serial(id, async () =>
      this.engines.stop(await this.session(id), pkg, engine),
    );
  }
  async revokeEngine(id: string, pkg: string, engine: string) {
    return this.serial(id, async () =>
      this.engines.revoke(await this.session(id), pkg, engine),
    );
  }
  private pendingRuntimes = new WeakMap<
    Session,
    Map<string, Promise<HostFoundationSession>>
  >();
  private async runtime(
    s: Session,
    packageId: string,
    engineScope?: string,
    context?: InvocationContext,
    policyEvaluation = false,
  ): Promise<HostFoundationSession> {
    let pending = this.pendingRuntimes.get(s);
    if (!pending) {
      pending = new Map();
      this.pendingRuntimes.set(s, pending);
    }
    const key = JSON.stringify([engineScope, packageId, policyEvaluation]);
    let creation = pending.get(key);
    if (!creation) {
      creation = this.createRuntime(
        s,
        packageId,
        engineScope,
        context,
        policyEvaluation,
      );
      pending.set(key, creation);
      void creation.finally(() => pending!.delete(key)).catch(() => {});
    }
    return creation;
  }
  private async createRuntime(
    s: Session,
    packageId: string,
    engineScope?: string,
    context?: InvocationContext,
    policyEvaluation = false,
  ): Promise<HostFoundationSession> {
    const controller = engineScope ? s.engineController : s.controller;
    await this.assertCoherent(s.record.instanceId);
    const detail = await s.core.getPackage(packageId);
    if (!detail.installed.enabled) denied();
    let policyRuntimes = this.policyRuntimes.get(s);
    if (policyEvaluation && !policyRuntimes) {
      policyRuntimes = new Map();
      this.policyRuntimes.set(s, policyRuntimes);
    }
    const runtimes = policyEvaluation
      ? policyRuntimes!
      : engineScope
        ? (s.engineRuntimes.get(engineScope) ??
          new Map<string, HostFoundationSession>())
        : s.runtimes;
    if (engineScope) s.engineRuntimes.set(engineScope, runtimes);
    let runtime = runtimes.get(packageId);
    if (runtime && !runtime.alive) {
      this.retireRuntime(s, runtime);
      runtimes.delete(packageId);
      runtime = undefined;
    }
    if (!runtime) {
      const contents = await s.core.getPackageContents(packageId),
        declaration = desktopContribution(contents.manifest, contents.files);
      if (!declaration?.runtime) denied();
      if (
        declaration.common &&
        !negotiateCommonContract(declaration.common, [
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

      const pin = s.record.components?.find((p) => p.packageId === packageId);
      if (!pin) denied();
      const expected = (await this.library.get(pin.digest)).contents;
      if (
        JSON.stringify(expected.manifest) !==
          JSON.stringify(contents.manifest) ||
        Object.keys(expected.files).length !==
          Object.keys(contents.files).length ||
        Object.entries(expected.files).some(
          ([p, b]) =>
            !contents.files[p] ||
            !Buffer.from(b).equals(Buffer.from(contents.files[p]!)),
        )
      )
        denied();
      if (declaration.common && this.engines.hasActive(s))
        throw resourceFailure("NOT_AUTHORIZED");
      const lifecycle = s.core.runtimeAccessCheckpoint([packageId]);
      let created: HostFoundationSession | undefined;
      const assertCurrent = () => {
        try {
          lifecycle.assertCurrent();
        } catch {
          throw resourceFailure("STALE_BINDING");
        }
        if (
          controller !== (engineScope ? s.engineController : s.controller) ||
          controller.signal.aborted ||
          (declaration.common && this.engines.hasActive(s)) ||
          this.sessions.get(s.record.instanceId) !== s ||
          context?.signal.aborted
        )
          denied();
      };
      try {
        created = await createFoundationSession(
          this.foundations,
          OFFICIAL_FOUNDATION_REFERENCE,
          {
            component: contents,
            actor: {
              agentId: s.record.instanceId,
              componentId: packageId,
              installationId: resourceInstallation(
                s,
                packageId,
                detail.installed,
              ),
              componentVersion: contents.manifest.version,
              componentDigest: pin.digest,
            },
            assertCurrent,
            assertActive: async () => {
              assertCurrent();
            },
            bridge: (method, args, context) => {
              if (
                policyEvaluation &&
                !["context", "settings"].includes(method)
              ) {
                created?.stop();
                throw resourceFailure("POLICY_UNAVAILABLE");
              }
              return this.bridge(
                s,
                packageId,
                method,
                args,
                policyEvaluation
                  ? { ...context, policyEvaluation: true }
                  : context,
              );
            },
            beforeInvoke: async (kind, name, input, invocation) => {
              if (
                kind !== "tools" ||
                policyEvaluation ||
                invocation.policyEvaluation
              )
                return undefined;
              const gate = await this.policy.assess(s, {
                packageId,
                callId: invocation.commonCallId ?? randomUUID(),
                category: "tool",
                operation: "invoke",
                target: packageId + "/" + name,
                intent: {
                  contribution: name,
                  input: this.credentialFree(input),
                },
                fingerprintInput: input,
                context: invocation,
              });
              if (!gate) return undefined;
              invocation.signal = gate.signal;
              return gate.recheck;
            },
          },
        );
        runtime = created;
        if (declaration.common) this.commonRuntimes.add(created);
        runtimes.set(packageId, created);
        await created.ready();
        await created.activate();
        assertCurrent();
      } catch (error) {
        if (created) {
          if (runtimes.get(packageId) === created) runtimes.delete(packageId);
          this.retireRuntime(s, created);
          await this.awaitRuntimeCleanup(s);
        }
        throw error;
      }
    }
    return runtime;
  }
  private bridge(
    s: Session,
    packageId: string,
    method: string,
    args: Record<string, unknown>,
    context: InvocationContext,
  ): Promise<unknown> {
    if (method === "common.policyStatus")
      return this.policyStatus(s.record.instanceId);
    if (context.policyEvaluation && !["context", "settings"].includes(method))
      throw resourceFailure("POLICY_UNAVAILABLE");
    if (method.startsWith("common."))
      return this.common.call(s, packageId, method.slice(7), args, context);
    if (method === "emit" && context.taskId)
      return this.common.call(
        s,
        packageId,
        "emit",
        { channel: args.topic, data: args.data },
        context,
      );
    return dispatchSdk(s, packageId, method, args, context, {
      active: () => {
        if (this.sessions.get(s.record.instanceId) !== s) denied();
      },
      invoke: (owner, request, context) =>
        invokeComponent(s, owner, request, context, {
          retain: (target) =>
            this.common.retainComponent(s, target, context.taskId),
          active: () => {
            if (
              this.sessions.get(s.record.instanceId) !== s ||
              context.signal.aborted
            )
              denied();
          },
          runtime: (target) => this.runtime(s, target, context.engineScope),
        }),
      secretValues: () => this.secretValues(s),
      event: this.options.event,
      runtimes: context.engineScope
        ? s.engineRuntimes.get(context.engineScope)
        : s.runtimes,
      audit: (event) => this.writeAudit(s.record.instanceId, event),
      resource: (method, args, context) =>
        this.businessResources.call(s, packageId, method, args, context),
      engine: (method, args) =>
        this.dispatchEngine(s, packageId, method.slice("engine.".length), args),
    });
  }
  async invoke(
    id: string,
    ownerId: string,
    targetId: string,
    kind: ContributionKind,
    name: string,
    input: unknown,
    signal?: AbortSignal,
    authorization?: Pick<InvocationContext, "grantId" | "grantScope">,
    engineScope?: string,
  ): Promise<unknown> {
    const copied = structuredClone(input),
      copiedAuthorization = authorization && structuredClone(authorization);
    const s = await this.session(id);
    const context = await this.invocationContext(
      s,
      ownerId,
      signal,
      copiedAuthorization,
      engineScope,
    );
    if (ownerId !== targetId)
      return redact(
        await invokeComponent(
          s,
          ownerId,
          { packageId: targetId, kind, name, input: copied },
          context,
          {
            active: () => {
              if (this.sessions.get(id) !== s || context.signal.aborted)
                denied();
            },
            runtime: (target) => this.runtime(s, target, engineScope),
          },
        ),
        await this.secretValues(s),
      );
    const runtime = await this.runtime(s, targetId, engineScope);
    await context.assertActive!();
    return redact(
      await runtime.invoke(kind, name, copied, context),
      await this.secretValues(s),
    );
  }
  private async invocationContext(
    s: Session,
    owner: string,
    signal?: AbortSignal,
    authorization?: Pick<InvocationContext, "grantId" | "grantScope">,
    engineScope?: string,
  ): Promise<InvocationContext> {
    const combined = AbortSignal.any([
      ...(signal ? [signal] : []),
      engineScope ? s.engineController.signal : s.controller.signal,
    ]);
    const checkpoint = s.core.runtimeAccessCheckpoint([owner]);
    const initial = await s.core.getPackage(owner),
      settingsRevision = await s.core.settingsRevision(owner);
    const assertActive = async () => {
      if (this.sessions.get(s.record.instanceId) !== s || combined.aborted)
        denied();
      checkpoint.assertCurrent();
      const current = await s.core.getPackage(owner);
      if (
        !current.installed.enabled ||
        protocolFingerprint(current.installed) !==
          protocolFingerprint(initial.installed) ||
        (await s.core.settingsRevision(owner)) !== settingsRevision ||
        protocolFingerprint(current.manifest) !==
          protocolFingerprint(initial.manifest)
      )
        denied();
      if (
        engineScope &&
        !(
          await s.core.engineTrustSnapshot(
            owner,
            engineScope.slice(owner.length + 1),
          )
        ).trusted
      )
        denied();
      if (combined.aborted || this.sessions.get(s.record.instanceId) !== s)
        denied();
    };
    await assertActive();
    return {
      ...authorization,
      engineScope,
      callers: [],
      ancestry: [owner],
      signal: combined,
      assertActive,
    };
  }
  async invokeProtocol(
    id: string,
    owner: string,
    requirementId: string,
    input: unknown,
    signal?: AbortSignal,
    authorization?: Pick<InvocationContext, "grantId" | "grantScope">,
    engineScope?: string,
  ): Promise<unknown> {
    const copied = structuredClone(input),
      copiedAuthorization = authorization && structuredClone(authorization),
      s = await this.session(id);
    if (
      desktopContribution((await s.core.getPackage(owner)).manifest)
        ?.sdkVersion !== "2"
    )
      denied();
    const context = await this.invocationContext(
      s,
      owner,
      signal,
      copiedAuthorization,
      engineScope,
    );
    return redact(
      await invokeComponent(
        s,
        owner,
        { requirementId, input: copied },
        context,
        {
          active: () => {
            if (this.sessions.get(id) !== s || context.signal.aborted) denied();
          },
          runtime: (target) => this.runtime(s, target, engineScope),
        },
      ),
      await this.secretValues(s),
    );
  }
  async frontend(
    id: string,
    componentId?: string,
  ): Promise<{
    packageId: string;
    entry: string;
    files: PackageContents["files"];
    legacyAgentEvents: boolean;
  } | null> {
    await this.assertCoherent(id);
    const s = await this.session(id),
      startup = componentId ?? s.record.agent.startup;
    if (!startup) return null;
    const p = await s.core.getPackage(startup);
    if (!p.installed.enabled) return null;
    const contents = await s.core.getPackageContents(startup);
    const declaration = desktopContribution(contents.manifest, contents.files);
    if (!declaration?.frontend) return null;
    return {
      packageId: startup,
      entry: safePath(declaration.frontend),
      files: await this.frontendFiles(s, startup, declaration.frontend),
      legacyAgentEvents:
        startup === s.record.agent.startup && !declaration.common,
    };
  }
  private async frontendFiles(s: Session, pkg: string, entry: string) {
    await this.assertCoherent(s.record.instanceId);
    const pin = s.record.components?.find((p) => p.packageId === pkg);
    if (!pin || this.sessions.get(s.record.instanceId) !== s) denied();
    const contents = await s.core.getPackageContents(pkg),
      expected = (await this.library.get(pin.digest)).contents;
    desktopContribution(contents.manifest, contents.files);
    if (
      JSON.stringify(contents.manifest) !== JSON.stringify(expected.manifest) ||
      Object.keys(contents.files).length !==
        Object.keys(expected.files).length ||
      Object.entries(expected.files).some(
        ([p, b]) =>
          !contents.files[p] ||
          !Buffer.from(b).equals(Buffer.from(contents.files[p]!)),
      )
    )
      denied();
    if (!Object.hasOwn(contents.files, safePath(entry))) denied();
    return contents.files;
  }
  async openFrontend(id: string, componentId?: string) {
    const s = await this.session(id);
    const frontend = await this.frontend(id, componentId);
    if (this.sessions.get(id) !== s) denied();
    return frontend ? this.panels.open(s, frontend) : null;
  }
  closeFrontend(sessionId: string) {
    this.panels.close(sessionId);
  }
  openPanel(
    sessionId: string,
    source: string,
    requirementId: string,
    panelId: string,
  ) {
    return this.panels.openPanel(sessionId, source, requirementId, panelId);
  }
  async closePanel(sessionId: string, source: string, handle: string) {
    const p = await this.panels.principal(sessionId, source);
    const target = await this.panels.principal(sessionId, handle);
    await this.panels.closePanel(sessionId, source, handle);
    if (handle === source && !p.context.parentHandle) return;
    await this.serial(p.context.agentId, async () => {
      const root = await this.panels.principal(
        sessionId,
        p.context.parentHandle ?? source,
      );
      const rootId = root.context.componentId;
      const saved = (
        await this.workspaceLayouts.read(p.context.agentId, rootId)
      ).layout;
      if (saved) {
        const v = saved.views.find((v) => v.id === target.context.viewId);
        if (v) {
          v.visible = false;
          await this.workspaceLayouts.save(p.context.agentId, saved);
        }
      }
    });
  }
  async panelLayout(sessionId: string, source: string, layout: PanelLayout) {
    const copied = await this.panels.layout(sessionId, source, layout);
    const p = await this.panels.principal(sessionId, source);
    return this.serial(p.context.agentId, async () => {
      const contexts = await this.panels.contexts(sessionId, source);
      const pin = (componentId: string) =>
        p.agent.record.components!.find((c) => c.packageId === componentId)!
          .digest;
      const old = (
        await this.workspaceLayouts.read(
          p.context.agentId,
          p.context.componentId,
        )
      ).layout;
      await p.assertActive();
      await this.workspaceLayouts.save(p.context.agentId, {
        version: 1,
        componentId: p.context.componentId,
        digest: pin(p.context.componentId),
        root: copied.root,
        views: contexts
          .filter((c) => c.handle !== source)
          .map((c) => {
            const shown = copied.panels.find((v) => v.handle === c.handle);
            return {
              id: c.viewId!,
              componentId: c.componentId,
              digest: pin(c.componentId),
              panelId: c.panelId,
              requirementId: c.requirementId,
              visible: !!shown,
              rect: shown ??
                old?.views.find((v) => v.id === c.viewId)?.rect ?? {
                  x: 0,
                  y: 0,
                  width: 1,
                  height: 1,
                },
            };
          }),
      });
      await p.assertActive();
      return copied;
    });
  }
  async workspacePlan(id: string, componentId?: string) {
    const s = await this.session(id),
      root = componentId ?? s.record.agent.startup;
    const frontends = [];
    const protocols = await protocolPlan(s.core, s.record);
    for (const pin of s.record.components ?? []) {
      const pkg = await s.core.getPackage(pin.packageId);
      if (!desktopContribution(pkg.manifest)?.frontend) continue;
      const requirements = protocols.requirements.filter(
        (r) => r.consumerId === pin.packageId,
      );
      frontends.push({
        componentId: pin.packageId,
        name: pkg.manifest.name,
        digest: pin.digest,
        enabled: pkg.installed.enabled,
        requirements: requirements.map((r) => ({
          id: r.requirement.id,
          state: r.state,
        })),
      });
    }
    const saved = root
      ? await this.workspaceLayouts.read(id, root)
      : { layout: null };
    const diagnostics: { viewId: string; reason: string }[] = [];
    if (saved.diagnostic)
      diagnostics.push({ viewId: "root", reason: saved.diagnostic });
    if (saved.layout) {
      if (
        !frontends.some(
          (f) =>
            f.componentId === root &&
            f.digest === saved.layout!.digest &&
            f.enabled,
        )
      )
        diagnostics.push({ viewId: "root", reason: "COMPONENT_CHANGED" });
      for (const v of saved.layout.views) {
        const pin = s.record.components?.find(
          (c) => c.packageId === v.componentId,
        );
        if (!pin || pin.digest !== v.digest)
          diagnostics.push({ viewId: v.id, reason: "COMPONENT_CHANGED" });
        else {
          const pkg = await s.core.getPackage(v.componentId);
          const declaration = desktopContribution(pkg.manifest);
          if (!pkg.installed.enabled)
            diagnostics.push({ viewId: v.id, reason: "COMPONENT_DISABLED" });
          else if (v.panelId) {
            const binding = protocols.requirements.find(
              (r) =>
                r.consumerId === root && r.requirement.id === v.requirementId,
            )?.selected;
            if (
              !binding ||
              binding.providerId !== v.componentId ||
              binding.providerDigest !== v.digest ||
              !declaration?.panels?.some(
                (p) => p.id === v.panelId && p.provideId === binding.provideId,
              )
            )
              diagnostics.push({ viewId: v.id, reason: "VIEW_INCOMPATIBLE" });
          } else if (!declaration?.frontend)
            diagnostics.push({ viewId: v.id, reason: "VIEW_INCOMPATIBLE" });
        }
      }
    }
    return {
      componentId: root ?? null,
      frontends,
      layout: saved.layout,
      diagnostics,
      fingerprint: protocolFingerprint([
        protocols.fingerprint,
        s.record.components,
        frontends,
      ]),
    };
  }
  async setWorkspaceViews(
    id: string,
    componentId: string,
    components: string[],
    fingerprint: string,
  ) {
    return this.serial(id, async () => {
      const plan = await this.workspacePlan(id, componentId);
      if (
        plan.fingerprint !== fingerprint ||
        !Array.isArray(components) ||
        components.length > 8 ||
        new Set(components).size !== components.length ||
        components.includes(componentId)
      )
        denied();
      const root = plan.frontends.find(
        (f) => f.componentId === componentId && f.enabled,
      );
      if (!root) denied();
      const width = 1 / (components.length + 1);
      const views = components.map((pkg, i) => {
        const f = plan.frontends.find(
          (f) => f.componentId === pkg && f.enabled,
        );
        if (!f) denied();
        return {
          id: `frontend:${pkg}`,
          componentId: pkg,
          digest: f.digest,
          visible: true,
          rect: { x: width * (i + 1), y: 0, width, height: 1 },
        };
      });
      await this.workspaceLayouts.save(id, {
        version: 1,
        componentId,
        digest: root.digest,
        root: { x: 0, y: 0, width, height: 1 },
        views,
      });
      this.panels.closeAgent(id);
    });
  }
  /** Trusted restore revalidates pinned declarations; unavailable choices remain diagnostics. */
  async restoreWorkspace(sessionId: string, source: string) {
    const p = await this.panels.principal(sessionId, source);
    if (p.context.parentHandle) denied();
    const plan = await this.workspacePlan(
      p.context.agentId,
      p.context.componentId,
    );
    const resources = [];
    const diagnostics = [...plan.diagnostics];
    let layout: PanelLayout = {
      root: { x: 0, y: 0, width: 1, height: 1 },
      panels: [],
    };
    if (plan.layout && !diagnostics.some((d) => d.viewId === "root")) {
      layout = { root: plan.layout.root, panels: [] };
      for (const v of plan.layout.views) {
        if (!v.visible || diagnostics.some((d) => d.viewId === v.id)) continue;
        try {
          let resource;
          if (v.panelId) {
            resource = await this.panels.openPanel(
              sessionId,
              source,
              v.requirementId!,
              v.panelId,
            );
            if (resource.context.componentId !== v.componentId) {
              await this.panels.closePanel(
                sessionId,
                source,
                resource.context.handle,
              );
              throw Error();
            }
          } else {
            const frontend = await this.frontend(
              p.context.agentId,
              v.componentId,
            );
            if (!frontend) throw Error();
            resource = await this.panels.openView(sessionId, source, frontend);
          }
          await p.assertActive();
          resources.push(resource);
          layout.panels.push({ ...v.rect, handle: resource.context.handle });
        } catch {
          diagnostics.push({ viewId: v.id, reason: "VIEW_INCOMPATIBLE" });
        }
      }
    }
    await p.assertActive();
    return { resources, layout, diagnostics };
  }
  postPanel(sessionId: string, source: string, message: PanelPost) {
    return this.panels.post(sessionId, source, message);
  }
  async frontendContext(sessionId: string, source: string) {
    return (await this.panels.principal(sessionId, source)).context;
  }
  async frontendInvoke(
    sessionId: string,
    source: string,
    request: {
      kind?: ContributionKind;
      name?: string;
      packageId?: string;
      requirementId?: string;
      input: unknown;
      messageId?: string;
    },
  ): Promise<unknown> {
    const copied = structuredClone(request),
      p = await this.panels.principal(sessionId, source, copied.messageId),
      owner = p.context.componentId;
    const baseContext = await this.invocationContext(p.agent, owner, p.signal);
    const context: InvocationContext = {
      ...baseContext,
      frontend: p.context,
      callers: p.sender ? [{ packageId: p.sender, permissionId: "" }] : [],
      ancestry: p.sender ? [p.sender, owner] : [owner],
      assertActive: async () => {
        await p.assertActive();
        await baseContext.assertActive!();
      },
    };
    await context.assertActive!();
    let result: unknown;
    if (
      copied.requirementId !== undefined ||
      (copied.packageId !== undefined && copied.packageId !== owner)
    ) {
      result = await invokeComponent(
        p.agent,
        owner,
        copied.requirementId !== undefined
          ? { requirementId: copied.requirementId, input: copied.input }
          : {
              packageId: copied.packageId!,
              kind: copied.kind!,
              name: copied.name!,
              input: copied.input,
            },
        context,
        {
          active: () => {
            if (
              p.signal.aborted ||
              this.sessions.get(p.context.agentId) !== p.agent
            )
              denied();
          },
          runtime: (target) => this.runtime(p.agent, target),
        },
      );
    } else {
      if (
        !["commands", "tools", "connectors"].includes(copied.kind!) ||
        typeof copied.name !== "string"
      )
        denied();
      const runtime = await this.runtime(p.agent, owner);
      await context.assertActive!();
      result = await runtime.invoke(
        copied.kind!,
        copied.name,
        copied.input,
        context,
      );
    }
    return redact(result, await this.secretValues(p.agent));
  }
  async frontendProtocolStatus(
    sessionId: string,
    source: string,
    requirementId: string,
  ) {
    const p = await this.panels.principal(sessionId, source);
    const result = await this.protocolStatus(
      p.context.agentId,
      p.context.componentId,
      requirementId,
    );
    await p.assertActive();
    return result;
  }
  private async assertLegacyEngine(s: Session) {
    for (const key of this.pendingRuntimes.get(s)?.keys() ?? []) {
      const [scope, pkg] = JSON.parse(key) as [string | null, string];
      if (
        scope === null &&
        desktopContribution((await s.core.getPackage(pkg)).manifest)?.common
      )
        throw resourceFailure("NOT_AUTHORIZED");
    }
    if (
      s.record.policy ||
      this.businessResources.range(s) ||
      s.core.taskScopeState() ||
      this.common.tasks
        .list(s.record.instanceId)
        .some((t) =>
          ["starting", "running", "cancelling"].includes(
            t.snapshot.status.state,
          ),
        ) ||
      (await s.core.listInstalled()).some(
        (p) =>
          p.enabled &&
          s.record.components?.some((c) => c.packageId === p.id) &&
          s.runtimes.get(p.id)?.alive &&
          this.commonRuntimes.has(s.runtimes.get(p.id)!),
      )
    )
      throw resourceFailure("NOT_AUTHORIZED");
  }
  async frontendEngine(
    sessionId: string,
    source: string,
    operation: string,
    args: Record<string, unknown>,
  ) {
    const copied = structuredClone(args),
      p = await this.panels.principal(sessionId, source);
    const requestId =
      typeof copied.requestId === "string" ? copied.requestId : randomUUID();
    const cancel = () => {
      if (operation === "request")
        void this.engines
          .cancel(
            p.agent,
            p.context.componentId,
            copied.engineId as string,
            requestId,
          )
          .catch(() => {});
    };
    p.signal.addEventListener("abort", cancel, { once: true });
    try {
      await p.assertActive();
      if (operation === "start" || operation === "request")
        await this.assertLegacyEngine(p.agent);
      const result =
        operation === "start"
          ? await this.engines.start(
              p.agent,
              p.context.componentId,
              copied.engineId as string,
              { signal: p.signal, assertActive: p.assertActive },
            )
          : await this.engineCall(
              p.context.agentId,
              p.context.componentId,
              operation,
              { ...copied, requestId },
            );
      await p.assertActive();
      return result;
    } finally {
      p.signal.removeEventListener("abort", cancel);
    }
  }
  private async assertCoherent(id: string): Promise<void> {
    if (this.recoveryErrors.has(id))
      importInvalid(this.recoveryErrors.get(id)!);
    for (const file of [
      "component-transaction.json",
      "assembly-transaction.json",
    ]) {
      try {
        await readFile(path.join(this.directory(id), file));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      denied();
    }
  }
  async approveMcp(
    id: string,
    packageId: string,
    permissionId: string,
    tools: McpTool[],
  ): Promise<unknown> {
    const s = await this.session(id);
    const approved = await s.core.approveMcpToolsV2(
      packageId,
      permissionId,
      tools,
    );
    for (const t of s.mcpTools.get(packageId) ?? [])
      if (approved.some((a) => a.tool === t.tool.name)) t.state = "APPROVED";
    return approved;
  }
}
