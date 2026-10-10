import {
  foundationProvider,
  parseFoundationRequirement,
  parseFoundationAgent,
} from "./foundation-contract.js";
export * from "./foundation-contract.js";
import { parseCommonDeclaration } from "./common-contract.js";
import { validateContributionSchema } from "./contribution-schema.js";
export * from "./common-contract.js";
export * from "./contribution-schema.js";
import {
  validateDesktopV2,
  type ConnectionDeclaration,
  type ConnectionDescription,
  type EngineDeclaration,
  type EngineSdk,
} from "./desktop-v2.js";
export type {
  ConnectionDeclaration,
  ConnectionDescription,
  ConnectionCredential,
  EngineDeclaration,
  EngineSdk,
  EngineStatus,
  EngineRuntimeContext,
} from "./desktop-v2.js";
import {
  createArchive,
  readArchiveDetails,
  validatePackage,
  DEFAULT_PACKAGE_LIMITS,
  IMPORT_INVALID,
  PlumsError,
  isManifestV2,
  type Manifest,
  type PackageContents,
  type PackageFiles,
  type CapabilityRequest,
} from "@plumsjs/core";
import semver from "semver";
import {
  validateProtocolIntents,
  protocolArtifactDigest,
} from "./protocol-intents.js";
export {
  validateProtocolIntents,
  portableProtocolIntent,
} from "./protocol-intents.js";
import {
  validateProtocolDeclarations,
  type ProtocolDeclarations,
} from "./protocols.js";
export { checkProtocolCompatibility } from "./protocols.js";
export type {
  ProtocolProvider,
  ProtocolRequirement,
  ProtocolDeclarations,
  ProtocolCompatibility,
  ProtocolBindingIntent,
  ProtocolBindingStatus,
} from "./protocols.js";

export const SDK_VERSION = "2";

export { missingRequiredSettings } from "./settings.js";
import { validatePanelDeclarations, type PanelDeclaration } from "./panels.js";
export * from "./panels.js";
export interface Contribution {
  name: string;
  title: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}
export type ContributionKind = "commands" | "tools" | "connectors";
export interface DesktopContribution {
  sdkVersion: "1" | "2";
  foundation?: import("./foundation-contract.js").FoundationRequirement;
  connections?: ConnectionDeclaration[];
  engines?: EngineDeclaration[];
  runtime?: string;
  frontend?: string;
  panels?: PanelDeclaration[];
  contributes?: Partial<Record<ContributionKind, Contribution[]>>;
  protocols?: ProtocolDeclarations;
  common?: import("./common-contract.js").CommonDeclaration;
  model?: {
    protocolSetting?: string;
    endpointSetting: string;
    modelSetting: string;
    keySetting: string;
  };
  credentials?: {
    permissionId: string;
    setting: string;
    header: string;
    prefix?: string;
  }[];
}
export interface AgentBundleManifest {
  bundleVersion: "1.0";
  foundation?: import("./foundation-contract.js").FoundationAgent;
  id: string;
  name: string;
  version: string;
  character?: string;
  characters?: string[];
  extensions: string[];
  connectors: string[];
  startup?: string;
  protocolBindings?: import("./protocols.js").ProtocolBindingIntent[];
  [key: string]: unknown;
}
export interface AgentBundle {
  agent: AgentBundleManifest;
  packages: { archive: string; bytes: Uint8Array; contents: PackageContents }[];
  files: PackageFiles;
}
export interface PlumsSdk {
  common: import("./common-contract.js").CommonPlatformSdk;
  resources: import("./common-contract.js").CommonResourcesSdk;
  protocols: {
    status(
      requirementId: string,
    ): Promise<import("./protocols.js").ProtocolBindingStatus>;
    invoke(requirementId: string, input: unknown): Promise<unknown>;
  };
  register(
    kind: ContributionKind,
    name: string,
    handler: (input: unknown) => unknown | Promise<unknown>,
  ): void;
  invoke(
    packageId: string,
    kind: ContributionKind,
    name: string,
    input: unknown,
  ): Promise<unknown>;
  capability(
    permissionId: string,
    request: CapabilityRequest,
    mcpTool?: { name: string; description: string; inputSchema?: unknown },
  ): Promise<unknown>;
  character(packageId?: string): Promise<unknown | null>;
  characters(): Promise<{ id: string; name: string; version: string }[]>;
  settings(): Promise<Record<string, unknown>>;
  context(): Promise<{
    agentId: string;
    componentId: string;
    invocationId: string;
    frontend?: import("./panels.js").PanelContext;
  }>;
  connection(id: string): Promise<ConnectionDescription>;
  failResponse(
    callId: string,
    reason: "RESPONSE_INVALID" | "HTTP_REJECTED",
  ): Promise<never>;
  engine: EngineSdk;
  emit(topic: string, data: unknown): Promise<void>;
  onEvent(
    topic: string,
    handler: (event: {
      packageId: string;
      topic: string;
      data: unknown;
    }) => unknown | Promise<unknown>,
  ): () => void;
  mcpCheck(tools: unknown[]): Promise<unknown>;
}
function invalid(message: string): never {
  throw new PlumsError({ code: IMPORT_INVALID, message });
}
export function safePath(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 255 ||
    /[\\\0]/.test(value) ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").some((s) => !s || s === "." || s === "..")
  )
    invalid("包内路径无效。");
  return value;
}
export function desktopContribution(
  manifest: Manifest,
  files?: PackageFiles,
): DesktopContribution | undefined {
  if (
    isManifestV2(manifest) &&
    manifest.permissions.some((p) => p.kind === "engine") &&
    (manifest.kind !== "extension" ||
      !manifest.payload ||
      typeof manifest.payload !== "object" ||
      !Object.hasOwn(manifest.payload, "plumsDesktop"))
  )
    invalid("引擎权限必须对应扩展的 SDK v2 引擎声明。");
  foundationProvider(manifest, files);
  if (manifest.kind === "character") return undefined;
  const payload = manifest.payload;
  if (
    !payload ||
    typeof payload !== "object" ||
    !Object.hasOwn(payload, "plumsDesktop")
  )
    return undefined;
  const c = (payload as { plumsDesktop: DesktopContribution }).plumsDesktop;
  if (
    !c ||
    !["1", "2"].includes(c.sdkVersion) ||
    !manifest.formatVersion.startsWith("2.")
  )
    invalid("可运行组件必须使用 2.x 清单与支持的 SDK 版本。");
  if (c.foundation !== undefined) parseFoundationRequirement(c.foundation);
  if (c.common !== undefined) {
    if (c.sdkVersion !== "2") invalid("Common resources require SDK v2.");
    const common = parseCommonDeclaration(c.common);
    if (!isManifestV2(manifest))
      invalid("Common resources require format 2.x.");
    if (common.policy) {
      const provided = c.protocols?.provides?.find(
        (p) => p.id === common.policy!.provideId,
      );
      if (
        !provided ||
        provided.protocol !== "org.plums.policy" ||
        provided.version !== "1.0.0" ||
        provided.contribution.kind !== "tools"
      )
        invalid("Policy slots require org.plums.policy 1.0.0 tools/evaluate.");
    }
    for (const r of common.resources ?? []) {
      const permission = manifest.permissions.find(
        (p) => p.id === r.permissionId,
      );
      if (
        !permission ||
        permission.kind !== "resource" ||
        !r.operations.every((op) => permission.operations.includes(op))
      )
        invalid("Resource needs must reference public resource permissions.");
    }
  }
  for (const at of [c.runtime, c.frontend])
    if (
      at !== undefined &&
      (!safePath(at) || (files && !Object.hasOwn(files, at)))
    )
      invalid("组件入口文件不存在。");
  if (c.frontend && manifest.kind !== "extension")
    invalid("前端必须由扩展提供。");
  if (
    c.contributes !== undefined &&
    (!c.contributes ||
      typeof c.contributes !== "object" ||
      Array.isArray(c.contributes))
  )
    invalid("贡献声明无效。");
  for (const [kind, declarations] of Object.entries(c.contributes ?? {})) {
    if (
      !["commands", "tools", "connectors"].includes(kind) ||
      !Array.isArray(declarations) ||
      declarations.length > 100
    )
      invalid("贡献声明无效。");
    const names = new Set<string>();
    for (const d of declarations) {
      if (
        !d ||
        typeof d.name !== "string" ||
        !/^[a-zA-Z0-9_.-]{1,128}$/.test(d.name) ||
        typeof d.title !== "string" ||
        !d.title.trim() ||
        d.title.length > 256 ||
        names.has(d.name)
      )
        invalid("贡献名称无效或重复。");
      names.add(d.name);
      if (c.sdkVersion === "2")
        for (const field of ["inputSchema", "outputSchema"] as const) {
          if (d[field] !== undefined)
            validateContributionSchema(
              d[field],
              `/payload/plumsDesktop/contributes/${kind}/${declarations.indexOf(d)}/${field}`,
            );
        }
    }
  }
  if (c.model !== undefined) {
    const properties = manifest.settingsSchema?.properties;
    const fields = c.model && [
      c.model.endpointSetting,
      c.model.modelSetting,
      c.model.keySetting,
      ...(c.model.protocolSetting === undefined
        ? []
        : [c.model.protocolSetting]),
    ];
    if (
      !c.model ||
      manifest.kind !== "connector" ||
      !fields!.every(
        (key) =>
          typeof key === "string" && properties?.[key]?.type === "string",
      ) ||
      new Set(fields).size !== fields!.length ||
      properties?.[c.model.endpointSetting]?.["x-secret"] ||
      properties?.[c.model.modelSetting]?.["x-secret"] ||
      (c.model.protocolSetting !== undefined &&
        properties?.[c.model.protocolSetting]?.["x-secret"]) ||
      !properties?.[c.model.keySetting]?.["x-secret"] ||
      !isManifestV2(manifest) ||
      !manifest.permissions.some(
        (p) =>
          p.kind === "service" &&
          p.target === "model" &&
          p.operations.includes("complete"),
      )
    )
      invalid("模型绑定必须引用本连接器的地址、模型名称、密钥和模型服务权限。");
  }
  if (c.credentials !== undefined) {
    if (!Array.isArray(c.credentials)) invalid("凭据绑定无效。");
    for (const b of c.credentials) {
      if (
        !b ||
        !manifest.permissions.some(
          (p) => p.id === b.permissionId && p.kind === "egress",
        ) ||
        !manifest.settingsSchema?.properties[b.setting]?.["x-secret"] ||
        !/^[A-Za-z][A-Za-z0-9-]*$/.test(b.header) ||
        /^(host|content-length|connection|transfer-encoding)$/i.test(
          b.header,
        ) ||
        (b.prefix !== undefined &&
          (typeof b.prefix !== "string" || /[\r\n\0]/.test(b.prefix)))
      )
        invalid("凭据绑定必须引用本连接器声明的密钥和外发权限。");
    }
    if (manifest.kind !== "connector") invalid("只有连接器可以绑定网络凭据。");
  }
  validateDesktopV2(manifest, c, safePath, files);
  validateProtocolDeclarations(c);
  validatePanelDeclarations(manifest, c, safePath, files);
  return c;
}
export async function validateAgentBundle(
  input: Uint8Array | string,
): Promise<AgentBundle> {
  return readAgentBundle(input, false);
}
/** Validate every archive and entry while allowing absent dependencies for library import. */
export async function inspectAgentBundle(
  input: Uint8Array | string,
): Promise<AgentBundle> {
  return readAgentBundle(input, true);
}
async function readAgentBundle(
  input: Uint8Array | string,
  allowIncomplete: boolean,
): Promise<AgentBundle> {
  const archiveDetails = await readArchiveDetails(input);
  const files = archiveDetails.files;
  let agent: AgentBundleManifest;
  try {
    agent = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(files["agent.json"]),
    );
  } catch {
    return invalid("组合包根目录需要有效的 agent.json。");
  }
  if (
    !agent ||
    agent.bundleVersion !== "1.0" ||
    typeof agent.id !== "string" ||
    agent.id.length > 64 ||
    !/^[a-z0-9]+([._-][a-z0-9]+)*$/.test(agent.id) ||
    typeof agent.name !== "string" ||
    !agent.name.trim() ||
    agent.name.length > 256 ||
    typeof agent.version !== "string" ||
    !semver.valid(agent.version) ||
    !Array.isArray(agent.extensions) ||
    !Array.isArray(agent.connectors)
  )
    invalid("组合包清单无效。");
  if (agent.foundation !== undefined) parseFoundationAgent(agent.foundation);
  if (agent.characters !== undefined && !Array.isArray(agent.characters))
    invalid("附加角色卡引用无效。");
  const characters = [
    ...(agent.character === undefined ? [] : [agent.character]),
    ...(agent.characters ?? []),
  ];
  const references = [
    ...characters,
    ...agent.extensions,
    ...agent.connectors,
  ].map(safePath);
  if (new Set(references).size !== references.length)
    invalid("组件路径不能重复。");
  let totalBytes = archiveDetails.totalBytes;
  let totalFiles = archiveDetails.totalFiles;
  const packages: AgentBundle["packages"] = [];
  const ids = new Set<string>();
  for (let i = 0; i < references.length; i++) {
    const archive = references[i]!;
    const bytes = files[archive];
    if (!bytes) invalid("组合包引用的组件不存在。");
    const remaining = {
      ...DEFAULT_PACKAGE_LIMITS,
      maxTotalBytes: DEFAULT_PACKAGE_LIMITS.maxTotalBytes - totalBytes,
      maxFiles: DEFAULT_PACKAGE_LIMITS.maxFiles - totalFiles,
    };
    if (remaining.maxTotalBytes <= 0 || remaining.maxFiles <= 0)
      invalid("组合包累计解压内容超过上限。");
    const contents = await validatePackage(bytes, remaining);
    totalBytes += contents.archiveStatistics.totalBytes;
    totalFiles += contents.archiveStatistics.totalFiles;
    if (ids.has(contents.manifest.id)) invalid("组合包内组件 id 重复。");
    ids.add(contents.manifest.id);
    const expected =
      i < characters.length
        ? "character"
        : i < characters.length + agent.extensions.length
          ? "extension"
          : "connector";
    if (contents.manifest.kind !== expected)
      invalid("组件类别与组合包引用不符。");
    desktopContribution(contents.manifest, contents.files);
    packages.push({ archive, bytes, contents });
  }
  for (const { contents } of packages)
    for (const dep of contents.manifest.dependencies) {
      const target = packages.find((p) => p.contents.manifest.id === dep.id)
        ?.contents.manifest;
      if (
        (!target ||
          target.kind !== dep.kind ||
          !semver.satisfies(target.version, dep.range)) &&
        !dep.optional &&
        !allowIncomplete
      )
        invalid("组合包缺少匹配的必需依赖。");
    }
  const completed = new Set<string>();
  const visiting = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) invalid("组合包必需依赖不能循环。");
    if (completed.has(id)) return;
    visiting.add(id);
    for (const d of packages.find((p) => p.contents.manifest.id === id)!
      .contents.manifest.dependencies)
      if (!d.optional && ids.has(d.id)) visit(d.id);
    visiting.delete(id);
    completed.add(id);
  };
  for (const id of ids) visit(id);
  if (
    agent.startup !== undefined &&
    (!packages.some(
      (p) =>
        p.contents.manifest.id === agent.startup &&
        p.contents.manifest.kind === "extension",
    ) ||
      typeof agent.startup !== "string")
  )
    invalid("启动扩展不存在。");
  validateProtocolIntents(
    agent.protocolBindings,
    packages.map((p) => ({
      manifest: p.contents.manifest,
      digest: protocolArtifactDigest(p.bytes),
    })),
  );
  return { agent, packages, files };
}
export async function createAgentBundle(
  agent: AgentBundleManifest,
  packages: Record<string, Uint8Array>,
  extra: PackageFiles = {},
  secrets: readonly string[] = [],
): Promise<Uint8Array> {
  if (
    Object.hasOwn(extra, "agent.json") ||
    Object.keys(extra).some((p) => Object.hasOwn(packages, p))
  )
    invalid("组合包文件冲突。");
  const bytes = await createArchive(
    {
      ...extra,
      ...packages,
      "agent.json": new TextEncoder().encode(
        JSON.stringify(agent, null, 2) + "\n",
      ),
    },
    DEFAULT_PACKAGE_LIMITS,
    secrets,
  );
  await validateAgentBundle(bytes);
  return bytes;
}

export function unmetDependencies(
  manifest: Manifest,
  available: Manifest[],
): Manifest["dependencies"] {
  return manifest.dependencies.filter(
    (d) =>
      !d.optional &&
      !available.some(
        (m) =>
          m.id === d.id &&
          m.kind === d.kind &&
          semver.satisfies(m.version, d.range),
      ),
  );
}

export { createCommonPlatformSdk } from "./common-client.js";
