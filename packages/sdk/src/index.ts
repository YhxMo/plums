import {
  createArchive,
  readArchiveDetails,
  validatePackage,
  DEFAULT_PACKAGE_LIMITS,
  IMPORT_INVALID,
  PlumsError,
  type Manifest,
  type PackageContents,
  type PackageFiles,
  type CapabilityRequest,
} from "@plums/core";
import semver from "semver";

export const SDK_VERSION = "1";

export { missingRequiredSettings } from "./settings.js";
export interface Contribution {
  name: string;
  title: string;
  inputSchema?: unknown;
}
export type ContributionKind = "commands" | "tools" | "connectors";
export interface DesktopContribution {
  sdkVersion: "1";
  runtime?: string;
  frontend?: string;
  contributes?: Partial<Record<ContributionKind, Contribution[]>>;
  credentials?: {
    permissionId: string;
    setting: string;
    header: string;
    prefix?: string;
  }[];
}
export interface AgentBundleManifest {
  bundleVersion: "1.0";
  id: string;
  name: string;
  version: string;
  character?: string;
  characters?: string[];
  extensions: string[];
  connectors: string[];
  startup?: string;
  [key: string]: unknown;
}
export interface AgentBundle {
  agent: AgentBundleManifest;
  packages: { archive: string; bytes: Uint8Array; contents: PackageContents }[];
  files: PackageFiles;
}
export interface PlumsSdk {
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
    c.sdkVersion !== SDK_VERSION ||
    !manifest.formatVersion.startsWith("2.")
  )
    invalid("可运行组件必须使用 2.x 清单与 SDK v1。");
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
    }
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
