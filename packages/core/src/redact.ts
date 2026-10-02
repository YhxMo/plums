import { PlumsError, type PlumsErrorOptions } from "./errors.js";

/** Placeholder written wherever a known secret value is removed. */
export const REDACTED = "[REDACTED]";

export function redact(value: string, secrets: readonly string[]): string;
export function redact(value: PlumsError, secrets: readonly string[]): PlumsError;
export function redact(value: unknown, secrets: readonly string[]): unknown;
export function redact(value: unknown, secrets: readonly string[]): unknown {
  const needles = [...new Set(secrets.filter((secret) => secret.length > 0))].sort(
    (a, b) => b.length - a.length,
  );
  return walk(value, needles, new WeakSet());
}

function redactPlumsError(value: PlumsError, secrets: readonly string[], seen: WeakSet<object>): PlumsError {
  const path = value.path === undefined ? undefined : replaceSecrets(value.path, secrets);
  const pointer = path !== undefined && path.startsWith("/") ? path : undefined;
  const options: PlumsErrorOptions = {
    code: value.code,
    message: replaceSecrets(value.message, secrets),
    ...(pointer !== undefined ? { path: pointer } : {}),
    ...(value.details !== undefined ? { details: walk(value.details, secrets, seen) } : {}),
  };
  const err = new PlumsError(options);
  // The constructor only accepts a JSON Pointer. Replacing the whole path leaves `[REDACTED]`.
  if (path !== undefined && pointer === undefined) {
    (err as { path: string }).path = path;
  }
  return err;
}

function replaceSecrets(input: string, secrets: readonly string[]): string {
  let out = input;
  for (const secret of secrets) {
    out = out.replaceAll(secret, REDACTED);
  }
  return out;
}

function walk(value: unknown, secrets: readonly string[], seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return replaceSecrets(value, secrets);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return REDACTED;
  }
  seen.add(value);

  if (value instanceof PlumsError) {
    return redactPlumsError(value, secrets, seen);
  }

  if (value instanceof Error) {
    const copy = new Error(replaceSecrets(value.message, secrets));
    copy.name = replaceSecrets(value.name, secrets);
    if (value.cause !== undefined) {
      copy.cause = walk(value.cause, secrets, seen);
    }
    return copy;
  }

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, secrets, seen));
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    out[replaceSecrets(key, secrets)] = walk(child, secrets, seen);
  }
  return out;
}
