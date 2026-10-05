import { createHash, randomUUID } from "node:crypto";
import {
  CAPABILITY_FAILED,
  CONSENT_REQUIRED,
  PERMISSION_DENIED,
  PlumsError,
} from "../errors.js";
import {
  requireInstalled,
  requireManifest,
  type InstallContext,
} from "../install/lifecycle.js";
import { knownSecrets } from "../install/settings.js";
import { isManifestV2, type ServicePermission } from "../package/types.js";
import { redact } from "../redact.js";
import { ID_PATTERN, SERVICE_NAME_PATTERN } from "../package/schema.js";
import type {
  AuditEvent,
  AuditHandler,
  BackgroundConsent,
  BackgroundConsentInput,
  HostService,
  JsonValue,
  RunCapabilityInput,
  ServiceBinding,
  ServiceEffect,
} from "./types.js";

export interface RegisteredService extends HostService {
  operations: Readonly<Record<string, ServiceEffect>>;
}
export interface ServiceContext extends InstallContext {
  instanceId: string;
  services: ReadonlyMap<string, RegisteredService>;
  onAudit?: AuditHandler;
}
export interface ServiceScope {
  service: RegisteredService;
  effect: ServiceEffect;
  fingerprint: string;
  bindingFingerprint: string;
  revision?: string;
  host?: string;
}
export function serviceDenied(reason: string, path = "/request"): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "服务调用不在当前授权范围内，没有执行。",
    path,
    details: { reason },
  });
}

/** Copies data without executing accessors, toJSON, or user-supplied methods. */
export function copyJson(value: unknown): JsonValue {
  const visit = (input: unknown, depth: number): JsonValue => {
    if (depth > 64) throw new TypeError();
    if (
      input === null ||
      typeof input === "string" ||
      typeof input === "boolean"
    )
      return input;
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input !== "object" || input === null) throw new TypeError();
    if (Object.getOwnPropertySymbols(input).length) throw new TypeError();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (Object.values(descriptors).some((d) => d.get || d.set))
      throw new TypeError();
    if (Array.isArray(input)) {
      if (
        input.length > 10_000 ||
        Object.keys(descriptors).some(
          (key) => key !== "length" && !/^(0|[1-9][0-9]*)$/.test(key),
        )
      )
        throw new TypeError();
      return Array.from({ length: input.length }, (_, i) => {
        if (descriptors[i] === undefined) throw new TypeError();
        return visit(descriptors[i]!.value, depth + 1);
      });
    }
    const proto = Object.getPrototypeOf(input);
    if (proto !== Object.prototype && proto !== null) throw new TypeError();
    const result: Record<string, JsonValue> = Object.create(null);
    for (const [key, descriptor] of Object.entries(descriptors))
      result[key] = visit(descriptor.value, depth + 1);
    return result;
  };
  try {
    const result = visit(value, 0);
    if (Buffer.byteLength(JSON.stringify(result)) > 1_048_576)
      throw new TypeError();
    return result;
  } catch {
    throw new TypeError("Service data must be bounded JSON without accessors");
  }
}

export function registerServices(
  input: Readonly<Record<string, HostService>> | undefined,
): ReadonlyMap<string, RegisteredService> {
  const services = new Map<string, RegisteredService>();
  if (input === undefined) return services;
  if (input === null || typeof input !== "object" || Array.isArray(input))
    throw new TypeError("services must be a record");
  for (const [name, service] of Object.entries(input)) {
    if (
      !new RegExp(SERVICE_NAME_PATTERN).test(name) ||
      !service ||
      (service.ownerId !== undefined &&
        (typeof service.ownerId !== "string" ||
          !new RegExp(ID_PATTERN).test(service.ownerId))) ||
      typeof service.getBinding !== "function" ||
      typeof service.invoke !== "function"
    )
      throw new TypeError("Invalid host service");
    const operations = { ...service.operations };
    if (
      !Object.keys(operations).length ||
      Object.entries(operations).some(
        ([op, effect]) =>
          !new RegExp(SERVICE_NAME_PATTERN).test(op) ||
          ![
            "read",
            "instance-write",
            "egress",
            "model-egress",
            "external-write",
          ].includes(effect),
      )
    )
      throw new TypeError("Invalid service operations");
    services.set(
      name,
      Object.freeze({
        ownerId: service.ownerId,
        operations: Object.freeze(operations),
        getBinding: service.getBinding.bind(service),
        invoke: service.invoke.bind(service),
      }),
    );
  }
  return services;
}

export function declaredService(
  ctx: ServiceContext,
  id: string,
  permissionId: string,
  operation: string,
): ServicePermission {
  const installed = requireInstalled(ctx, id);
  if (!installed.enabled) serviceDenied("NOT_ENABLED");
  const manifest = requireManifest(ctx, id);
  if (!isManifestV2(manifest))
    serviceDenied("FORMAT_API_MISMATCH", "/formatVersion");
  const index = manifest.permissions.findIndex((p) => p.id === permissionId);
  const permission = manifest.permissions[index];
  if (
    permission?.kind !== "service" ||
    !permission.operations.includes(operation)
  )
    serviceDenied("OPERATION_NOT_ALLOWED", "/request/operation");
  const consent = ctx.store.getConsent(id);
  if (
    !consent?.formatVersion.startsWith("2.") ||
    !consent.permissions.some(
      (p) =>
        "kind" in p &&
        p.kind === "service" &&
        p.id === permission.id &&
        p.target === permission.target &&
        permission.operations.every((op) =>
          (p as ServicePermission).operations.includes(op),
        ),
    )
  ) {
    throw new PlumsError({
      code: CONSENT_REQUIRED,
      message: "这项服务权限尚未得到同意。",
      path: "/permissions/" + index,
    });
  }
  return permission;
}

export async function resolveService(
  ctx: ServiceContext,
  input: RunCapabilityInput,
  permission: ServicePermission,
  requireBackground = true,
): Promise<ServiceScope> {
  if (input.request.kind !== "service") serviceDenied("KIND_MISMATCH");
  if (input.signal?.aborted) serviceDenied("REQUEST_CANCELLED");
  const request = input.request;
  const service = ctx.services.get(permission.target);
  if (!service) serviceDenied("SERVICE_NOT_BOUND");
  const effect = service.operations[request.operation];
  if (!effect || !permission.operations.includes(request.operation))
    serviceDenied("OPERATION_NOT_ALLOWED", "/request/operation");
  const owner = service.ownerId
    ? requireManifest(ctx, service.ownerId)
    : undefined;
  if (owner) {
    if (owner.kind !== "connector" && owner.kind !== "extension")
      serviceDenied("INVALID_SERVICE_OWNER");
    const provider = owner.permissions.find(
      (p) =>
        "kind" in p &&
        p.kind === "service" &&
        p.target === permission.target &&
        (p as ServicePermission).operations.includes(request.operation),
    );
    if (!provider) serviceDenied("PROVIDER_NOT_DECLARED");
    declaredService(ctx, service.ownerId!, provider.id, request.operation);
  }
  const raw = await service.getBinding(ctx.instanceId, request.binding);
  if (!raw) serviceDenied("BINDING_NOT_ACTIVE");
  const binding = copyJson(raw) as unknown as ServiceBinding;
  if (owner) {
    const currentOwner = requireManifest(ctx, service.ownerId!);
    if (JSON.stringify(currentOwner) !== JSON.stringify(owner))
      serviceDenied("PROVIDER_CHANGED");
    const provider = currentOwner.permissions.find(
      (p) =>
        "kind" in p &&
        p.kind === "service" &&
        p.target === permission.target &&
        (p as ServicePermission).operations.includes(request.operation),
    );
    if (!provider) serviceDenied("PROVIDER_NOT_DECLARED");
    declaredService(ctx, service.ownerId!, provider.id, request.operation);
  }
  if (
    typeof binding.fingerprint !== "string" ||
    !binding.fingerprint ||
    !Array.isArray(binding.sources) ||
    !binding.sources.every((s) => typeof s === "string") ||
    (binding.host !== undefined &&
      (typeof binding.host !== "string" ||
        !binding.host ||
        binding.host.length > 255 ||
        /[\r\n\0]/.test(binding.host)))
  )
    serviceDenied("INVALID_BINDING");
  if (request.sources.some((source) => !binding.sources.includes(source)))
    serviceDenied("SOURCE_NOT_ALLOWED", "/request/sources");
  const caller = requireManifest(ctx, input.extensionId);
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        caller.version,
        requireInstalled(ctx, input.extensionId).enabledAt,
        owner,
        service.ownerId
          ? requireInstalled(ctx, service.ownerId).enabledAt
          : null,
        service.operations,
        binding.fingerprint,
        permission,
      ]),
    )
    .digest("hex");
  let revision: string | undefined;
  if (requireBackground && effect !== "external-write") {
    const grant = ctx.store
      .listBackgroundConsents(input.extensionId)
      .find(
        (g) =>
          g.instanceId === ctx.instanceId &&
          g.permissionId === input.permissionId &&
          g.operation === request.operation &&
          g.binding === request.binding,
      );
    if (
      !grant ||
      grant.fingerprint !== fingerprint ||
      request.sources.some((source) => !grant.sources.includes(source))
    ) {
      throw new PlumsError({
        code: CONSENT_REQUIRED,
        message: "服务的当前绑定或数据来源需要重新授权。",
        path: "/request/binding",
        details: { reason: "BACKGROUND_CONSENT_REQUIRED" },
      });
    }
    revision = grant.revision;
  }
  return {
    service,
    effect,
    fingerprint,
    bindingFingerprint: binding.fingerprint,
    revision,
    host: binding.host,
  };
}

async function consentAudit(
  ctx: ServiceContext,
  input: BackgroundConsentInput,
  phase: "grant" | "revoke",
): Promise<void> {
  const callId = randomUUID();
  try {
    if (!ctx.onAudit) throw new Error();
    const values = await knownSecrets(ctx);
    const event: AuditEvent = {
      callId,
      timestamp: new Date().toISOString(),
      extensionId: input.extensionId,
      permissionId: input.permissionId,
      kind: "service",
      phase,
      outcome: phase === "grant" ? "allowed" : "completed",
      executionState: phase === "grant" ? "not_started" : "completed",
    };
    await ctx.onAudit(Object.freeze(redact(event, values) as AuditEvent));
  } catch {
    throw new PlumsError({
      code: CAPABILITY_FAILED,
      message: "后台授权审计未能完成。",
      details: {
        callId,
        phase: "audit_" + phase,
        executionState: phase === "grant" ? "not_started" : "completed",
      },
    });
  }
}

function consentInput(raw: BackgroundConsentInput): BackgroundConsentInput {
  const value = copyJson(raw) as unknown as BackgroundConsentInput;
  if (
    !value ||
    ![
      value.extensionId,
      value.permissionId,
      value.operation,
      value.binding,
    ].every((v) => typeof v === "string" && v.trim()) ||
    !Array.isArray(value.sources) ||
    !value.sources.every((v) => typeof v === "string" && v.trim()) ||
    new Set(value.sources).size !== value.sources.length
  )
    throw new TypeError("Invalid background consent");
  return value;
}

/** Read-only check for trusted configuration/consent previews; never invokes the service. */
export async function hasBackgroundConsent(
  ctx: ServiceContext,
  raw: BackgroundConsentInput,
): Promise<boolean> {
  const value = consentInput(raw);
  try {
    const permission = declaredService(
      ctx,
      value.extensionId,
      value.permissionId,
      value.operation,
    );
    const scope = await resolveService(
      ctx,
      {
        extensionId: value.extensionId,
        permissionId: value.permissionId,
        request: {
          kind: "service",
          operation: value.operation,
          binding: value.binding,
          sources: value.sources,
          input: null,
        },
      },
      permission,
    );
    return scope.effect !== "external-write";
  } catch (error) {
    if (
      error instanceof PlumsError &&
      (error.code === CONSENT_REQUIRED || error.code === PERMISSION_DENIED)
    )
      return false;
    throw error;
  }
}

export async function grantBackgroundConsent(
  ctx: ServiceContext,
  raw: BackgroundConsentInput,
): Promise<BackgroundConsent> {
  const value = consentInput(raw);
  const installed = requireManifest(ctx, value.extensionId);
  if (installed.kind !== "extension" && installed.kind !== "connector")
    serviceDenied("NOT_EXTENSION", "/kind");
  const permission = declaredService(
    ctx,
    value.extensionId,
    value.permissionId,
    value.operation,
  );
  const input: RunCapabilityInput = {
    extensionId: value.extensionId,
    permissionId: value.permissionId,
    request: {
      kind: "service",
      operation: value.operation,
      binding: value.binding,
      sources: value.sources,
      input: null,
    },
  };
  const first = await resolveService(ctx, input, permission, false);
  const revision = ctx.store.backgroundRevision();
  if (first.effect === "external-write")
    serviceDenied("EXTERNAL_WRITE_REQUIRES_CONFIRMATION");
  await consentAudit(ctx, value, "grant");
  const nextPermission = declaredService(
    ctx,
    value.extensionId,
    value.permissionId,
    value.operation,
  );
  const next = await resolveService(ctx, input, nextPermission, false);
  if (
    next.fingerprint !== first.fingerprint ||
    ctx.store.backgroundRevision() !== revision
  )
    serviceDenied("BINDING_CHANGED");
  const grant: BackgroundConsent = {
    ...value,
    instanceId: ctx.instanceId,
    fingerprint: first.fingerprint,
    revision: randomUUID(),
    grantedAt: new Date().toISOString(),
  };
  if (!ctx.store.saveBackgroundConsentIfCurrent(grant, revision))
    serviceDenied("BINDING_CHANGED");
  return grant;
}

export async function revokeBackgroundConsent(
  ctx: ServiceContext,
  extensionId: string,
  binding?: string,
): Promise<void> {
  if (
    typeof extensionId !== "string" ||
    extensionId.length > 64 ||
    !new RegExp(ID_PATTERN).test(extensionId) ||
    (binding !== undefined && typeof binding !== "string")
  )
    throw new TypeError("Invalid background revocation");
  ctx.store.revokeBackgroundConsents(extensionId, binding);
  await consentAudit(
    ctx,
    {
      extensionId,
      binding: binding ?? "",
      permissionId: "",
      operation: "",
      sources: [],
    },
    "revoke",
  );
}
