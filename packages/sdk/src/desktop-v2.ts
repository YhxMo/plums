import { IMPORT_INVALID, PlumsError, isManifestV2, type Manifest, type PackageFiles } from "@plums/core";

export interface ConnectionCredential {
  setting: string;
  header: string;
  prefix?: string;
}
export interface ConnectionDeclaration {
  id: string;
  permissionId: string;
  baseURLSetting: string;
  labelSetting?: string;
  selectorSetting?: string;
  credentials?: ConnectionCredential[];
  credentialProfiles?: Record<string, ConnectionCredential[]>;
}
export interface ConnectionDescription {
  binding: string;
  baseURL: string;
  origin: string;
  basePath: string;
  fingerprint: string;
  ready: boolean;
}
export interface EngineDeclaration {
  id: string;
  title: string;
  entry: string;
  runtime: "node";
  platforms: string[];
  protocol: "jsonrpc-jsonl-v1";
}
export interface EngineStatus {
  engineId: string;
  state: "stopped" | "starting" | "running" | "stopping" | "crashed";
  trusted: boolean;
}
export interface EngineSdk {
  start(engineId: string): Promise<EngineStatus>;
  request(engineId: string, method: string, input: unknown, requestId?: string): Promise<unknown>;
  cancel(engineId: string, requestId: string): Promise<void>;
  stop(engineId: string): Promise<void>;
  status(engineId: string): Promise<EngineStatus>;
}

const name = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
function invalid(message: string): never {
  throw new PlumsError({ code: IMPORT_INVALID, message });
}
const nonSecret = (manifest: Manifest, field: unknown) =>
  typeof field === "string" && manifest.settingsSchema?.properties[field]?.type === "string" &&
  !manifest.settingsSchema.properties[field]?.["x-secret"];
function credentials(manifest: Manifest, input: unknown): void {
  if (!Array.isArray(input) || input.length > 16) invalid("连接凭据声明无效。");
  const headers = new Set<string>();
  for (const c of input as ConnectionCredential[]) {
    if (!c || typeof c.setting !== "string" || !manifest.settingsSchema?.properties[c.setting]?.["x-secret"] ||
      typeof c.header !== "string" || !/^[A-Za-z][A-Za-z0-9-]*$/.test(c.header) ||
      /^(host|content-length|connection|transfer-encoding|proxy-authorization|proxy-connection)$/i.test(c.header) ||
      headers.has(c.header.toLowerCase()) ||
      (c.prefix !== undefined && (typeof c.prefix !== "string" || c.prefix.length > 256 || /[\r\n\0]/.test(c.prefix))))
      invalid("连接凭据必须引用本组件的密钥设置和有效请求头。");
    headers.add(c.header.toLowerCase());
  }
}
export function validateDesktopV2(
  manifest: Manifest,
  c: { sdkVersion: string; connections?: ConnectionDeclaration[]; engines?: EngineDeclaration[] },
  safePath: (input: unknown) => string,
  files?: PackageFiles,
): void {
  if (c.connections === undefined && c.engines === undefined) return;
  if (c.sdkVersion !== "2" || !isManifestV2(manifest)) invalid("连接与可信引擎声明需要 SDK v2。");
  if (c.connections !== undefined) {
    if (manifest.kind !== "connector" || !Array.isArray(c.connections) || c.connections.length > 32)
      invalid("通用连接必须由连接器声明。");
    const ids = new Set<string>();
    for (const d of c.connections) {
      if (!d || typeof d.id !== "string" || !name.test(d.id) || ids.has(d.id) ||
        !nonSecret(manifest, d.baseURLSetting) || (d.labelSetting !== undefined && !nonSecret(manifest, d.labelSetting)) ||
        !manifest.permissions.some(p => p.id === d.permissionId && p.kind === "service" && p.target === "https" && p.operations.includes("request")))
        invalid("连接必须引用自己的地址设置和 HTTPS 服务权限。");
      ids.add(d.id);
      credentials(manifest, d.credentials ?? []);
      if (d.selectorSetting !== undefined || d.credentialProfiles !== undefined) {
        if (!nonSecret(manifest, d.selectorSetting) || !d.credentialProfiles ||
          typeof d.credentialProfiles !== "object" || Array.isArray(d.credentialProfiles) || d.credentials !== undefined)
          invalid("凭据选择必须绑定本组件的非密钥设置。");
        const values = manifest.settingsSchema!.properties[d.selectorSetting!]?.enum;
        if (!values?.length || values.some(value => typeof value !== "string" || !Object.hasOwn(d.credentialProfiles!, value)) ||
          Object.keys(d.credentialProfiles).some(key => !values.includes(key))) invalid("凭据配置必须覆盖选择设置的所有值。");
        for (const profile of Object.values(d.credentialProfiles)) credentials(manifest, profile);
      }
    }
  }
  if (c.engines !== undefined) {
    if (manifest.kind !== "extension" || !Array.isArray(c.engines) || c.engines.length > 16)
      invalid("可信引擎必须由扩展声明。");
    const ids = new Set<string>();
    for (const d of c.engines) {
      if (!d || typeof d.id !== "string" || !name.test(d.id) || ids.has(d.id) ||
        typeof d.title !== "string" || !d.title.trim() || d.title.length > 256 ||
        d.runtime !== "node" || d.protocol !== "jsonrpc-jsonl-v1" || !Array.isArray(d.platforms) ||
        !d.platforms.length || d.platforms.some(p => typeof p !== "string" || !/^(darwin|linux|win32)-(arm64|x64)$/.test(p)) ||
        !manifest.permissions.some(p => p.kind === "engine" && p.target === d.id)) invalid("可信引擎需要公开的执行权限、平台和协议声明。");
      ids.add(d.id);
      const entry = safePath(d.entry);
      if (!/\.(js|mjs|cjs)$/.test(entry) || (files && !Object.hasOwn(files, entry))) invalid("可信引擎入口文件不存在。");
    }
  }
}
