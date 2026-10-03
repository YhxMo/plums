import { PERMISSION_DENIED, PlumsError } from "../errors.js";
import type { CapabilityRequest, RunCapabilityInput } from "./types.js";

function record(value: unknown): Record<string, unknown> {
  return fromCaller(() => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) invalid();
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) invalid();
    const copy: Record<string, unknown> = Object.create(null);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (descriptor.get !== undefined || descriptor.set !== undefined) invalid();
      copy[key] = descriptor.value;
    }
    return copy;
  });
}
function invalid(): never {
  throw new TypeError("runCapability requires valid ids and a fs, exec or egress request");
}
/** Proxy traps and array accessors can throw any error, including a forged PlumsError. */
function fromCaller<T>(read: () => T): T {
  try { return read(); } catch { return invalid(); }
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function keys(value: Record<string, unknown>, allowed: string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid();
}

/** `/` is the only separator, on every host OS. Values never appear in errors. */
export function relativePath(value: unknown): string {
  if (!text(value)) invalid();
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/") || /^[a-z]:/i.test(value) || value.split("/").includes("..")) {
    throw new PlumsError({
      code: PERMISSION_DENIED, message: "路径必须位于绑定目录内，使用 / 分隔的相对路径。",
      path: "/request/path", details: { reason: "PATH_NOT_ALLOWED" },
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
    case "fs": {
      keys(req, req.operation === "write" ? ["kind", "operation", "path", "data"] : ["kind", "operation", "path"]);
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
      if (!args.every((arg) => typeof arg === "string" && !arg.includes("\0"))) invalid();
      const cwd = record(req.cwd);
      keys(cwd, ["root", "path"]);
      if (!text(cwd.root)) invalid();
      let at: string;
      try { at = relativePath(cwd.path); } catch (error) {
        if (error instanceof PlumsError) throw new PlumsError({ code: error.code, message: error.message, path: "/request/cwd/path", details: error.details });
        throw error;
      }
      request = { kind: "exec", args, cwd: { root: cwd.root, path: at } };
      break;
    }
    case "egress":
      keys(req, ["kind", "url", "method", "body"]);
      if (!text(req.url) || (req.method !== undefined && typeof req.method !== "string") || (req.body !== undefined && typeof req.body !== "string")) invalid();
      request = { kind: "egress", url: req.url, ...(req.method !== undefined ? { method: req.method as string } : {}), ...(req.body !== undefined ? { body: req.body as string } : {}) };
      break;
    default: invalid();
  }
  return { extensionId: value.extensionId, permissionId: value.permissionId, request };
}
