import { ContractError, type ErrorCode } from "./errors";

/** Zero-dependency checks for persisted and declared data. Failures carry a field path. */
export type Check = { path?: string; label?: string };
export type Bounds = Check & {
  min?: number;
  max?: number;
  pattern?: RegExp;
};
function fail(code: ErrorCode, check?: Check): never {
  throw new ContractError(code, check?.path ?? "", check?.label);
}
const path = (base: string | undefined, key: string | number) =>
  base ? `${base}.${key}` : String(key);
export function object(
  value: unknown,
  code: ErrorCode,
  check?: Check,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(code, check);
  return value as Record<string, unknown>;
}
export function string(
  value: unknown,
  code: ErrorCode,
  check: Bounds = {},
): string {
  if (typeof value !== "string") fail(code, check);
  const { min = 0, max = Infinity, pattern } = check;
  if (value.length < min || value.length > max) fail(code, check);
  if (pattern && !pattern.test(value)) fail(code, check);
  return value;
}
export function array<T>(
  value: unknown,
  code: ErrorCode,
  item?: (entry: unknown, path: string) => T,
  check?: Check,
): T[] {
  if (!Array.isArray(value)) fail(code, check);
  if (!item) return value as T[];
  return Array.from(value as unknown[], (entry, index) =>
    item(entry, path(check?.path, index)),
  );
}
export function oneOf<T>(
  value: unknown,
  code: ErrorCode,
  values: readonly T[],
  check?: Check,
): T {
  if (!values.includes(value as T)) fail(code, check);
  return value as T;
}
export function optional<T>(
  value: unknown,
  check: (entry: unknown) => T,
): T | undefined {
  return value === undefined ? undefined : check(value);
}
