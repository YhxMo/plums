import { ContractError } from "./errors";
import { object, string } from "./validation";
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
  if (!Array.isArray(value))
    object(value, "state.corrupt", {
      path: "migration.json",
      label: "Migration requires JSON data",
    });
  if (ancestors.has(value as object))
    throw new ContractError(
      "state.corrupt",
      "migration.json",
      "Migration requires JSON data",
    );
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new ContractError(
      "state.corrupt",
      "migration",
      "Migration requires plain JSON data",
    );
  ancestors.add(value as object);
  const result: Record<string, unknown> | unknown[] = Array.isArray(value)
    ? []
    : {};
  for (const key of Reflect.ownKeys(value as object)) {
    if (Array.isArray(value) && key === "length") continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    const name = string(key, "state.corrupt", {
      path: "migration.json.key",
      label: "Migration requires JSON properties",
    });
    if (
      !descriptor.enumerable ||
      !Object.hasOwn(descriptor, "value") ||
      (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(name))
    )
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Migration requires JSON properties",
      );
    Object.defineProperty(result, name, {
      value: copy(descriptor.value, ancestors),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  if (Array.isArray(value) && Object.keys(value).length !== value.length)
    throw new ContractError(
      "state.corrupt",
      "migration",
      "Migration requires dense JSON arrays",
    );
  ancestors.delete(value as object);
  return result;
}
function envelope(value: unknown): VersionedState {
  const v = object(value, "state.corrupt", {
    path: "migration.state",
    label: "Unsupported migration state; original preserved",
  });
  if (
    !Number.isSafeInteger(v.version) ||
    Number(v.version) < 1 ||
    !Object.hasOwn(v, "data")
  )
    throw new ContractError(
      "state.corrupt",
      "migration",
      "Unsupported migration state; original preserved",
    );
  return v as unknown as VersionedState;
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
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Invalid migration versions",
      );
    const source = copy(
      await ctx.platform("state.read", undefined, active),
    ) as StoredState | null;
    if (
      !source ||
      !Number.isSafeInteger(source.revision) ||
      source.revision < 1
    )
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Migration needs existing state",
      );
    const saved = envelope(source.value);
    if (saved.version === to) {
      if (validate(copy(saved.data)) !== true)
        throw new ContractError(
          "state.corrupt",
          "migration",
          "Invalid target state; original preserved",
        );
      active.throwIfAborted();
      return source;
    }
    if (saved.version !== from)
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Unsupported migration version; original preserved",
      );
    const data = copy(await migrate(copy(saved.data), active));
    if (validate(copy(data)) !== true)
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Invalid migration result; original preserved",
      );
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

export interface StateRestore {
  /** Revision explicitly reviewed by the caller; stale confirmation never writes. */
  revision: number;
  from: number;
  to: number;
  validate(data: unknown): boolean;
}

/** Explicitly restore one retained snapshot, retaining the replaced current state.
 * This is not a package rollback or an automatic retry after an unknown receipt. */
export function restorePreviousState(
  ctx: ExtensionContext,
  plan: StateRestore,
  signal?: AbortSignal,
): Promise<StoredState> {
  return ctx.task(async (lifetime) => {
    const active = signal ? AbortSignal.any([lifetime, signal]) : lifetime;
    active.throwIfAborted();
    const { revision, from, to, validate } = plan;
    if (
      !Number.isSafeInteger(revision) ||
      revision < 1 ||
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      to < 1 ||
      from <= to
    )
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Invalid restore confirmation",
      );
    const current = copy(
      await ctx.platform("state.read", undefined, active),
    ) as StoredState | null;
    if (!current || current.revision !== revision)
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Restore confirmation is stale or state is missing",
      );
    const saved = envelope(current.value);
    if (saved.version !== from)
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Unexpected current restore version",
      );
    const previous = saved.previous;
    if (
      !previous ||
      !Number.isSafeInteger(previous.revision) ||
      previous.revision < 1 ||
      previous.revision >= revision
    )
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Missing or invalid previous snapshot",
      );
    const target = envelope(previous.value);
    if (target.version !== to || validate(copy(target.data)) !== true)
      throw new ContractError(
        "state.corrupt",
        "migration",
        "Invalid restore target; current preserved",
      );
    active.throwIfAborted();
    return (await ctx.platform(
      "state.write",
      {
        revision,
        value: { version: to, data: copy(target.data), previous: current },
      },
      active,
    )) as StoredState;
  });
}
