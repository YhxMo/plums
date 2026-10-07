import { copyGrantUse } from "./grants.js";
import { copyJson } from "./services.js";
import { PERMISSION_DENIED, PlumsError } from "../errors.js";
import type {
  CapabilityRequest,
  RunCapabilityInput,
  RunDelegatedCapabilityInput,
  CapabilityCaller,
} from "./types.js";

function record(value: unknown): Record<string, unknown> {
  return fromCaller(() => {
    if (value === null || typeof value !== "object" || Array.isArray(value))
      invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const copy: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(value),
    )) {
      if (descriptor.get !== undefined || descriptor.set !== undefined)
        invalid();
      copy[key] = descriptor.value;
    }
    return copy;
  });
}
function invalid(): never {
  throw new TypeError(
    "runCapability requires valid ids and a fs, exec or egress request",
  );
}
/** Proxy traps and array accessors can throw any error, including a forged PlumsError. */
function fromCaller<T>(read: () => T): T {
  try {
    return read();
  } catch {
    return invalid();
  }
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}

/** `/` is the only separator, on every host OS. Values never appear in errors. */
function relativePath(value: unknown, path = "/request/path"): string {
  if (!text(value)) invalid();
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-z]:/i.test(value) ||
    value.split("/").includes("..")
  ) {
    throw new PlumsError({
      code: PERMISSION_DENIED,
      message: "路径必须位于绑定目录内，使用 / 分隔的相对路径。",
      path,
      details: { reason: "PATH_NOT_ALLOWED" },
    });
  }
  return value;
}

/** Copy every executable field before the first await, including the write bytes. */
export function copyInput(input: RunCapabilityInput): RunCapabilityInput {
  const value = record(input);
  if (!text(value.extensionId) || !text(value.permissionId)) invalid();
  const req = record(value.request);
  let request: CapabilityRequest;
  switch (req.kind) {
    case "service": {
      keys(req, ["kind", "operation", "binding", "sources", "input"]);
      if (!text(req.operation) || !text(req.binding)) invalid();
      const sources = copyJson(req.sources);
      if (
        !Array.isArray(sources) ||
        !sources.every((s) => text(s)) ||
        new Set(sources).size !== sources.length
      )
        invalid();
      request = {
        kind: "service",
        operation: req.operation,
        binding: req.binding,
        sources: sources as string[],
        input: copyJson(req.input),
      };
      break;
    }
    case "fs": {
      keys(
        req,
        req.operation === "write"
          ? ["kind", "operation", "path", "data"]
          : ["kind", "operation", "path"],
      );
      const at = relativePath(req.path);
      if (req.operation === "write") {
        const data = fromCaller(() => {
          if (!(req.data instanceof Uint8Array)) invalid();
          return new Uint8Array(req.data);
        });
        request = { kind: "fs", operation: "write", path: at, data };
      } else if (req.operation === "read" || req.operation === "list") {
        request = { kind: "fs", operation: req.operation, path: at };
      } else invalid();
      break;
    }
    case "exec": {
      keys(req, ["kind", "args", "cwd"]);
      const args = fromCaller(() => {
        if (!Array.isArray(req.args)) invalid();
        return Array.from(req.args);
      });
      if (!args.every((arg) => typeof arg === "string" && !arg.includes("\0")))
        invalid();
      const cwd = record(req.cwd);
      keys(cwd, ["root", "path"]);
      if (!text(cwd.root)) invalid();
      request = {
        kind: "exec",
        args,
        cwd: {
          root: cwd.root,
          path: relativePath(cwd.path, "/request/cwd/path"),
        },
      };
      break;
    }
    case "egress":
      keys(req, ["kind", "url", "method", "body", "headers", "stream"]);
      if (
        !text(req.url) ||
        (req.method !== undefined && typeof req.method !== "string") ||
        (req.body !== undefined && typeof req.body !== "string")
      )
        invalid();
      if (req.stream !== undefined && typeof req.stream !== "boolean")
        invalid();
      const headers =
        req.headers === undefined ? undefined : record(req.headers);
      if (
        headers &&
        Object.entries(headers).some(
          ([k, v]) =>
            !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) ||
            typeof v !== "string" ||
            /[\r\n\0]/.test(v),
        )
      )
        invalid();
      request = {
        kind: "egress",
        url: req.url,
        ...(req.method !== undefined ? { method: req.method as string } : {}),
        ...(req.body !== undefined ? { body: req.body as string } : {}),
        ...(headers ? { headers: headers as Record<string, string> } : {}),
        ...(req.stream !== undefined ? { stream: req.stream as boolean } : {}),
      };
      break;
    default:
      invalid();
  }
  if (
    value.grantId !== undefined &&
    (typeof value.grantId !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.grantId))
  )
    invalid();
  const grantScope =
    value.grantScope === undefined ? undefined : copyGrantUse(value.grantScope);
  if ((value.grantId === undefined) !== (grantScope === undefined)) invalid();
  if (value.signal !== undefined && !(value.signal instanceof AbortSignal))
    invalid();
  return {
    ...(value.signal ? { signal: value.signal as AbortSignal } : {}),
    extensionId: value.extensionId,
    permissionId: value.permissionId,
    request,
    ...(value.grantId ? { grantId: value.grantId as string, grantScope } : {}),
  };
}
/** Host-provided identities and tool metadata follow the same defensive copy rules. */
export function copyDelegatedInput(
  input: RunDelegatedCapabilityInput,
): RunDelegatedCapabilityInput {
  const value = record(input);
  const call = copyInput({
    extensionId: value.packageId,
    permissionId: value.permissionId,
    request: value.request,
    signal: value.signal,
    grantId: value.grantId,
    grantScope: value.grantScope,
  } as RunCapabilityInput);
  const callers = fromCaller(() => {
    if (!Array.isArray(value.callers) || value.callers.length > 16) invalid();
    return Array.from(value.callers, (raw) => {
      const caller = record(raw);
      if (!text(caller.packageId) || !text(caller.permissionId)) invalid();
      return {
        packageId: caller.packageId,
        permissionId: caller.permissionId,
      } as CapabilityCaller;
    });
  });
  const mcpTool =
    value.mcpTool === undefined
      ? undefined
      : fromCaller(
          () =>
            JSON.parse(
              JSON.stringify(record(value.mcpTool)),
            ) as RunDelegatedCapabilityInput["mcpTool"],
        );
  return {
    ...(call.signal ? { signal: call.signal } : {}),
    packageId: call.extensionId,
    permissionId: call.permissionId,
    callers,
    request: call.request,
    ...(call.grantId
      ? { grantId: call.grantId, grantScope: call.grantScope }
      : {}),
    ...(mcpTool ? { mcpTool } : {}),
  };
}
