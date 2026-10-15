import type { ExtensionContext, StoredState } from "./index";

export interface StateMigration {
  from: number;
  to: number;
  /** Extension-owned conversion; must not perform external side effects. */
  migrate(data: unknown, signal: AbortSignal): unknown | Promise<unknown>;
  /** Extension-owned target schema check. */
  validate(data: unknown): boolean;
}
export interface VersionedState {
  version: number;
  data: unknown;
  previous?: StoredState;
}

/** Copy JSON without silently dropping undefined, non-finite numbers or functions. */
function copy(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || !value || ancestors.has(value))
    throw Error("Migration requires JSON data");
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw Error("Migration requires plain JSON data");
  ancestors.add(value);
  const result: Record<string, unknown> | unknown[] = Array.isArray(value)
    ? []
    : {};
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (
      typeof key !== "string" ||
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key))
    )
      throw Error("Migration requires JSON properties");
    Object.defineProperty(result, key, {
      value: copy(descriptor.value, ancestors),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length)
    throw Error("Migration requires dense JSON arrays");
  ancestors.delete(value);
  return result;
}
function envelope(value: unknown): VersionedState {
  const v = value as VersionedState | null;
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    !Number.isSafeInteger(v.version) ||
    v.version < 1 ||
    !Object.hasOwn(v, "data")
  )
    throw Error("Unsupported migration state; original preserved");
  return v;
}

/** One explicit migration, one revision-checked commit. Never initializes missing state,
 * retries an unknown write, or automatically rolls back a committed target. */
export function migrateState(
  ctx: ExtensionContext,
  plan: StateMigration,
  signal?: AbortSignal,
): Promise<StoredState> {
  return ctx.task(async (lifetime) => {
    const active = signal ? AbortSignal.any([lifetime, signal]) : lifetime;
    active.throwIfAborted();
    const { from, to, migrate, validate } = plan;
    if (
      !Number.isSafeInteger(from) ||
      from < 1 ||
      !Number.isSafeInteger(to) ||
      to <= from
    )
      throw Error("Invalid migration versions");
    const source = copy(
      await ctx.platform("state.read", undefined, active),
    ) as StoredState | null;
    if (
      !source ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 1
    )
      throw Error("Migration needs existing state");
    const saved = envelope(source.value);
    if (saved.version === to) {
      if (validate(copy(saved.data)) !== true)
        throw Error("Invalid target state; original preserved");
      active.throwIfAborted();
      return source;
    }
    if (saved.version !== from)
      throw Error("Unsupported migration version; original preserved");
    const data = copy(await migrate(copy(saved.data), active));
    if (validate(copy(data)) !== true)
      throw Error("Invalid migration result; original preserved");
    active.throwIfAborted();
    // The original snapshot and target share the same atomic storage write/CAS.
    // A confirmed receipt wins even if cancellation arrives after dispatch.
    return (await ctx.platform(
      "state.write",
      {
        revision: source.revision,
        value: { version: to, data, previous: source },
      },
      active,
    )) as StoredState;
  });
}
