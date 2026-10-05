import { enablePlan, enablePrepared } from "./agent-launch.js";
import { planAssembly } from "./assembly-plan.js";
import { dispatchSdk } from "./sdk-bridge.js";
import {
  bundleExtras,
  recoverComponentMutation,
} from "./component-transactions.js";
import {
  ComponentLibrary,
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
  type ComponentBinding,
} from "./assembly.js";
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  rename,
  rm,
  mkdtemp,
  realpath,
  appendFile,
} from "node:fs/promises";
import path from "node:path";
import {
  createCore,
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
  validateAgentBundle,
  inspectAgentBundle,
  createAgentBundle,
  desktopContribution,
  safePath,
  unmetDependencies,
  type AgentBundleManifest,
  type AgentBundle,
  type ContributionKind,
} from "@plums/sdk";
import { ExtensionRuntime, type InvocationContext } from "./runtime.js";
import { HttpsSink, SecureFsSink, type DnsMode } from "./io.js";
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
}
export interface HostOptions {
  dataDir: string;
  confirm: Confirm;
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
}
export interface Session {
  record: AgentRecord;
  core: Core;
  secrets: SecretStore;
  runtimes: Map<string, ExtensionRuntime>;
  mcpTools: Map<string, { tool: McpTool; state: string }[]>;
  controller: AbortController;
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
  readonly library: ComponentLibrary;
  private dnsMode: DnsMode = "system";
  constructor(readonly options: HostOptions) {
    this.library = new ComponentLibrary(path.join(options.dataDir, "library"));
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
      if (settings.dnsMode === "cloudflare") this.dnsMode = "cloudflare";
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

  getDesktopSettings() {
    return { dnsMode: this.dnsMode };
  }
  async setDesktopSettings(dnsMode: unknown): Promise<void> {
    if (dnsMode !== "system" && dnsMode !== "cloudflare") denied();
    this.close();
    const file = path.join(this.options.dataDir, "desktop.json");
    await writeFile(file + ".pending", JSON.stringify({ dnsMode }));
    await rename(file + ".pending", file);
    this.dnsMode = dnsMode;
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
    return planAssembly(await this.library.list(), digests);
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
    if (this.recoveryErrors.has(id))
      importInvalid(this.recoveryErrors.get(id)!);
    const epoch = this.epochs.get(id) ?? 0;
    const dir = this.directory(id),
      record = JSON.parse(
        await readFile(path.join(dir, "record.json"), "utf8"),
      ) as AgentRecord;
    if (record.instanceId !== id) denied();
    const secrets = this.options.secretStore(id),
      controller = new AbortController();
    const core = createCore({
      capabilityApproval: "task-or-confirm",
      dataDir: path.join(dir, "core"),
      secrets,
      egress: this.options.egress ?? new HttpsSink(this.dnsMode),
      fs: this.options.fs ?? new SecureFsSink(),
      confirm: this.options.confirm,
      roots: { "agent-data": path.join(dir, "agent-data"), ...record.roots },
      onAudit: async (event) => {
        if (this.options.audit) await this.options.audit(id, event);
        else
          await appendFile(
            path.join(dir, "audit.jsonl"),
            JSON.stringify(event) + "\n",
            { mode: 0o600 },
          );
      },
    });
    const s: Session = {
      record,
      core,
      secrets,
      controller,
      runtimes: new Map(),
      mcpTools: new Map(),
    };
    if ((this.epochs.get(id) ?? 0) !== epoch) {
      core.close();
      denied();
    }
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
          mcpTools: s.mcpTools.get(p.id),
        };
      }),
    );
    return redact(
      { record: s.record, packages: details },
      await this.secretValues(s),
    );
  }
  async taskScopePlan(id: string) {
    const s = await this.session(id);
    return redact(
      {
        ...(await s.core.taskScopePlan()),
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
      return s.core.grantTaskScope(fingerprint, durationMs, selection);
    });
  }
  async revokeTaskScope(id: string) {
    const s = await this.session(id);
    const taskId = s.core.taskScopeState()?.taskId;
    s.core.revokeTaskScope();
    this.stopSession(id);
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
  ): Promise<void> {
    return this.serial(id, async () => {
      const s = await this.session(id);
      if (
        expected !== undefined &&
        JSON.stringify((await s.core.getPackage(packageId)).manifest) !==
          expected
      )
        denied();
      await s.core.grantConsent(packageId);
      await s.core.enable(packageId);
    });
  }
  async disable(id: string, packageId: string): Promise<void> {
    return this.serial(id, async () => {
      const s = await this.session(id);
      this.stopSession(id);
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
    this.stopRuntimes(s);
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
      this.stopSession(id);
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
      this.stopRuntimes(s);
      const { manifest } = await s.core.getPackage(packageId);
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
        this.stopSession(id);
        for (const p of await s.core.listInstalled())
          await s.core.uninstall(p.id);
        s.core.close();
        await rm(this.directory(id), { recursive: true, force: true });
      }),
    );
  }
  private stopRuntimes(s: Session): void {
    s.core.revokeTaskScope();
    s.controller.abort();
    for (const runtime of s.runtimes.values()) runtime.stop();
    s.runtimes.clear();
    s.controller = new AbortController();
  }
  private async commitRecord(id: string, record: AgentRecord): Promise<void> {
    this.stopSession(id);
    try {
      await saveAgentRecord(this.directory(id), record);
    } finally {
      // Readers may have opened the previous record while its replacement was pending.
      this.stopSession(id);
    }
  }
  stopSession(id: string): void {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1);
    const s = this.sessions.get(id);
    if (s) {
      this.stopRuntimes(s);
      s.core.close();
      this.sessions.delete(id);
    }
  }
  close(): void {
    for (const id of new Set([...this.sessions.keys(), ...this.opening.keys()]))
      this.stopSession(id);
  }
  private async runtime(
    s: Session,
    packageId: string,
  ): Promise<ExtensionRuntime> {
    await this.assertCoherent(s.record.instanceId);
    const detail = await s.core.getPackage(packageId);
    if (!detail.installed.enabled) denied();
    let runtime = s.runtimes.get(packageId);
    if (!runtime) {
      const contents = await s.core.getPackageContents(packageId),
        declaration = desktopContribution(contents.manifest, contents.files);
      if (!declaration?.runtime) denied();
      runtime = new ExtensionRuntime(
        packageId,
        declaration,
        (method, args, context) =>
          this.bridge(s, packageId, method, args, context),
        Object.fromEntries(
          Object.entries(contents.files)
            .filter(([p]) => p.endsWith(".js"))
            .map(([p, b]) => [
              p,
              new TextDecoder("utf-8", { fatal: true }).decode(b),
            ]),
        ),
        this.options.nodePath,
      );
      s.runtimes.set(packageId, runtime);
      await runtime.ready();
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
    return dispatchSdk(s, packageId, method, args, context, {
      secretValues: () => this.secretValues(s),
      event: this.options.event,
      runtime: (target) => this.runtime(s, target),
    });
  }
  async invoke(
    id: string,
    ownerId: string,
    targetId: string,
    kind: ContributionKind,
    name: string,
    input: unknown,
  ): Promise<unknown> {
    const s = await this.session(id);
    if (!(await s.core.getPackage(ownerId)).installed.enabled) denied();
    let callers: InvocationContext["callers"] = [];
    if (ownerId !== targetId) {
      const owner = (await s.core.getPackage(ownerId)).manifest;
      if (!owner.dependencies.some((d) => d.id === targetId)) denied();
      callers = [{ packageId: ownerId, permissionId: "" }];
    }
    const runtime = await this.runtime(s, targetId);
    const result = await runtime.invoke(kind, name, input, {
      callers,
      ancestry: ownerId === targetId ? [targetId] : [ownerId, targetId],
      signal: s.controller.signal,
    });
    return redact(result, await this.secretValues(s));
  }
  async frontend(id: string): Promise<{
    packageId: string;
    entry: string;
    files: PackageContents["files"];
  } | null> {
    await this.assertCoherent(id);
    const s = await this.session(id),
      startup = s.record.agent.startup;
    if (!startup) return null;
    const p = await s.core.getPackage(startup);
    if (!p.installed.enabled) return null;
    const contents = await s.core.getPackageContents(startup);
    const declaration = desktopContribution(contents.manifest, contents.files);
    if (!declaration?.frontend) return null;
    return {
      packageId: startup,
      entry: safePath(declaration.frontend),
      files: contents.files,
    };
  }
  private async assertCoherent(id: string): Promise<void> {
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
