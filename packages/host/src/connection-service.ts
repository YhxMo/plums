import { protocolPlan } from "./protocol-bindings.js";
import type { AgentRecord } from "./host.js";
import { createHash } from "node:crypto";
import net from "node:net";
import {
  PERMISSION_DENIED,
  SETTINGS_INVALID,
  PlumsError,
  SinkFailure,
  isManifestV2,
  type Core,
  type EgressSink,
  type HostService,
  type JsonValue,
} from "@plums/core";
import { desktopContribution, type ConnectionDeclaration } from "@plums/sdk";
import { ioContext } from "./io.js";

const digest = (v: unknown) =>
  createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function connectionURL(raw: unknown, field = "endpoint"): URL {
  const invalid = (): never => {
    throw new PlumsError({
      code: SETTINGS_INVALID,
      message: "请填写公共 HTTPS 服务的基础地址。",
      path: "/settings/" + field.replace(/~/g, "~0").replace(/\//g, "~1"),
    });
  };
  if (typeof raw !== "string" || raw.length > 2048) invalid();
  let url: URL;
  try {
    url = new URL((raw as string).trim());
  } catch {
    return invalid();
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    net.isIP(url.hostname.replace(/^\[|\]$/g, "")) ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".") ||
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost")
  )
    invalid();
  return url;
}
export async function configuredConnection(
  core: Core,
  packageId: string,
  connectionId: string,
) {
  const detail = await core.getPackage(packageId);
  const declaration = desktopContribution(detail.manifest)?.connections?.find(
    (c) => c.id === connectionId,
  );
  if (!declaration) return undefined;
  // describeSettings is presentation data: redaction can change both keys and values.
  // Missing credentials remain unconfigured so management can save them.
  const settings = await core.settingsSnapshot(packageId);
  const base = connectionURL(
    settings.values[declaration.baseURLSetting],
    declaration.baseURLSetting,
  );
  const profile = declaration.selectorSetting
    ? settings.values[declaration.selectorSetting]
    : undefined;
  const credentials = declaration.selectorSetting
    ? typeof profile === "string" &&
      Object.hasOwn(declaration.credentialProfiles!, profile)
      ? declaration.credentialProfiles![profile]
      : undefined
    : (declaration.credentials ?? []);
  if (!credentials)
    throw new PlumsError({
      code: SETTINGS_INVALID,
      message: "连接的凭据配置未选择。",
      path: "/settings",
    });
  const label = declaration.labelSetting
    ? settings.values[declaration.labelSetting]
    : undefined;
  return {
    packageId,
    declaration,
    credentials,
    binding: `${packageId}/${connectionId}`,
    baseURL: base.href,
    origin: base.origin,
    enabled: detail.installed.enabled,
    ready: credentials.every((c) => settings.secrets[c.setting]),
    label:
      base.host +
      (typeof label === "string" && label.trim() ? `（${label.trim()}）` : ""),
    fingerprint: digest([
      detail.manifest,
      detail.installed.enabled,
      detail.installed.enabledAt,
      settings.values,
      settings.secrets,
      await core.settingsRevision(packageId),
    ]),
  };
}
export async function connectionBindings(
  core: Core,
  id: string,
  record?: AgentRecord,
) {
  const result: NonNullable<
      Awaited<ReturnType<typeof configuredConnection>>
    >[] = [],
    seen = new Set<string>();
  const protocols = record
    ? (await protocolPlan(core, record)).requirements
    : [];
  const visit = async (at: string): Promise<void> => {
    if (seen.has(at)) return;
    seen.add(at);
    const { manifest } = await core.getPackage(at);
    for (const d of desktopContribution(manifest)?.connections ?? []) {
      try {
        const b = await configuredConnection(core, at, d.id);
        if (b) result.push(b);
      } catch (error) {
        if (!(error instanceof PlumsError && error.code === SETTINGS_INVALID))
          throw error;
      }
    }
    for (const d of manifest.dependencies)
      if ((await core.listInstalled()).some((p) => p.id === d.id))
        await visit(d.id);
    for (const s of protocols)
      if (
        s.consumerId === at &&
        s.selected &&
        ["bound", "disabled"].includes(s.state)
      )
        await visit(s.selected.providerId);
  };
  await visit(id);
  return result;
}
export async function connectionAccess(
  core: Core,
  id: string,
  record?: AgentRecord,
) {
  const { manifest } = await core.getPackage(id),
    bindings = await connectionBindings(core, id, record);
  const permissions = isManifestV2(manifest)
    ? manifest.permissions.filter(
        (p) =>
          p.kind === "service" &&
          p.target === "https" &&
          p.operations.includes("request"),
      )
    : [];
  const serviceTargets: Record<string, string[]> = {};
  let needsApproval = false;
  for (const p of permissions) {
    const permitted = bindings.filter(
      (b) => b.packageId !== id || b.declaration.permissionId === p.id,
    );
    serviceTargets[p.id] = permitted.map((b) => b.label);
    for (const b of permitted)
      if (
        !(await core.hasBackgroundConsent({
          extensionId: id,
          permissionId: p.id,
          binding: b.binding,
          operation: "request",
          sources: [],
        }))
      )
        needsApproval = true;
  }
  return {
    serviceTargets,
    needsApproval,
    fingerprint: digest([
      bindings.map((b) => b.fingerprint),
      await core.listBackgroundConsents(id),
    ]),
  };
}
export async function grantConnectionAccess(
  core: Core,
  id: string,
  record?: AgentRecord,
): Promise<void> {
  const { manifest } = await core.getPackage(id);
  if (!isManifestV2(manifest)) return;
  for (const p of manifest.permissions)
    if (
      p.kind === "service" &&
      p.target === "https" &&
      p.operations.includes("request")
    ) {
      for (const b of await connectionBindings(core, id, record))
        if (
          b.enabled &&
          b.ready &&
          (b.packageId !== id || b.declaration.permissionId === p.id) &&
          !(await core.hasBackgroundConsent({
            extensionId: id,
            permissionId: p.id,
            binding: b.binding,
            operation: "request",
            sources: [],
          }))
        )
          await core.grantBackgroundConsent({
            extensionId: id,
            permissionId: p.id,
            binding: b.binding,
            operation: "request",
            sources: [],
          });
    }
}
export function validateConnectionSettings(
  declarations: ConnectionDeclaration[],
  values: Record<string, unknown>,
  defaults: Record<string, { default?: unknown }>,
): void {
  for (const d of declarations)
    connectionURL(
      values[d.baseURLSetting] ?? defaults[d.baseURLSetting]?.default,
      d.baseURLSetting,
    );
}
export function httpsService(
  core: () => Core,
  egress: EgressSink,
): HostService {
  const resolve = async (binding: string) => {
    const [owner, id, extra] = binding.split("/");
    return owner && id && extra === undefined
      ? configuredConnection(core(), owner, id)
      : undefined;
  };
  return {
    operations: { request: "egress" },
    async getBinding(_agentId, id) {
      const b = await resolve(id);
      if (!b?.enabled || !b.ready) return undefined;
      return {
        fingerprint: b.fingerprint,
        sources: [],
        host: new URL(b.baseURL).host,
      };
    },
    async invoke(request) {
      const b = await resolve(request.binding),
        context = ioContext.getStore();
      if (
        !b ||
        !context ||
        request.packageId !== b.packageId ||
        context.permissionId !== b.declaration.permissionId
      )
        throw new PlumsError({
          code: PERMISSION_DENIED,
          message: "请通过声明此连接的连接器发送请求。",
        });
      const input = request.input as {
        path?: unknown;
        method?: unknown;
        headers?: unknown;
        body?: unknown;
      };
      if (
        !input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        typeof input.path !== "string" ||
        !input.path.startsWith("/") ||
        input.path.startsWith("//") ||
        input.path.includes("\\") ||
        /[\r\n\0]/.test(input.path) ||
        input.path.length > 8192 ||
        (input.method !== undefined &&
          (typeof input.method !== "string" ||
            !/^[A-Z]{1,16}$/.test(input.method))) ||
        (input.body !== undefined && typeof input.body !== "string") ||
        (input.headers !== undefined &&
          (!input.headers ||
            typeof input.headers !== "object" ||
            Array.isArray(input.headers)))
      )
        throw new SinkFailure("REQUEST_INVALID");
      const url = new URL(input.path, b.origin);
      if (url.origin !== b.origin || url.username || url.password || url.hash)
        throw new SinkFailure("REQUEST_INVALID");
      const headers: Record<string, string> = Object.create(null);
      for (const [header, value] of Object.entries(input.headers ?? {})) {
        if (
          !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(header) ||
          typeof value !== "string" ||
          /[\r\n\0]/.test(value) ||
          /^(host|content-length|connection|transfer-encoding|proxy-authorization|proxy-connection)$/i.test(
            header,
          )
        )
          throw new SinkFailure("REQUEST_INVALID");
        headers[header] = value;
      }
      for (const c of b.credentials) {
        const secret = await context.secrets.get(
          `secret:${b.packageId}/${c.setting}`,
        );
        if (secret === undefined || /[\r\n\0]/.test(secret))
          throw new SinkFailure("REQUEST_INVALID");
        for (const h of Object.keys(headers))
          if (h.toLowerCase() === c.header.toLowerCase()) delete headers[h];
        headers[c.header] = (c.prefix ?? "") + secret;
      }
      await request.assertActive();
      const reply = await ioContext.run(
        { ...context, contribution: undefined },
        () =>
          egress.send({
            url: url.href,
            method: (input.method as string | undefined) ?? "POST",
            headers,
            ...(input.body === undefined ? {} : { body: input.body as string }),
          }),
      );
      await request.assertActive();
      if (
        !Number.isInteger(reply.status) ||
        reply.status < 100 ||
        reply.status > 599 ||
        typeof reply.body !== "string"
      )
        throw Error("Invalid transport response");
      if (reply.redirectTo || (reply.status >= 300 && reply.status < 400))
        throw new SinkFailure("HTTP_REJECTED", reply.status);
      return JSON.parse(JSON.stringify(reply)) as JsonValue;
    },
  };
}
