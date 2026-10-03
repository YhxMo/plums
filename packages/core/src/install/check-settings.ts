import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { IMPORT_INVALID, PlumsError, type PlumsErrorCode } from "../errors.js";
import { escapePointer, typeName } from "../package/manifest.js";
import { settingValueFailure, type SettingValueFailure } from "../package/schema.js";
import type { Manifest, SettingsSchema } from "../package/types.js";

/** User data and settings live in `<dataDir>/data/<id>/`. Uninstall removes that folder. */
export const PACKAGE_DATA_DIR = "data";

const SETTINGS_FILE = "settings.json";

type Settings = Record<string, unknown>;

type BoundFailure = Exclude<SettingValueFailure, "TYPE">;

export type SettingsFailureReason = BoundFailure | "REQUIRED" | "TYPE" | "NOT_JSON" | "NO_SCHEMA";

/** One place for `<dataDir>/data/<id>/settings.json`. Why: the path used to be joined twice, and the two copies could drift. */
export function settingsFilePath(dataDir: string, id: string): string {
  return path.join(dataDir, PACKAGE_DATA_DIR, id, SETTINGS_FILE);
}

/**
 * Checks `values` against `schema`.
 * Order is fixed: required and types, then fill defaults, then minimum/maximum/enum (defaults included).
 * Why that order: a missing required key is an omission, and a default must not paper over it;
 * a default is still a value, so it has to sit inside the same bounds.
 * The returned object is what should be saved. Secret fields are not judged here.
 * `code` is SETTINGS_INVALID for setSettings and IMPORT_INVALID for a leftover file.
 * Why two codes: baseline setSettings only failed secret checks, and those stay SECRET_NOT_FOUND.
 * The message and details never include the value. Field errors use `/settings/<key>`.
 */
export function checkSettings(schema: SettingsSchema, values: Settings, code: PlumsErrorCode): Settings {
  const record = values;
  const properties = schema.properties;

  for (const key of schema.required ?? []) {
    if (!Object.hasOwn(record, key)) {
      // Why: "required" means the schema's required array, checked before any default is filled in.
      throw fieldError(code, key, "REQUIRED", `设置项「${key}」是必填的，还没有值。`);
    }
  }

  for (const [key, spec] of Object.entries(properties)) {
    // Why skipped: an x-secret value is a secret ref, checked by the secret store, not by this schema.
    if (spec["x-secret"] === true || !Object.hasOwn(record, key)) continue;
    if (settingValueFailure(spec, record[key], false) === "TYPE") {
      throw fieldError(code, key, "TYPE", typeMessage(key, spec.type));
    }
  }

  const filled: Settings = { ...record };
  for (const [key, spec] of Object.entries(properties)) {
    if (!Object.hasOwn(filled, key) && spec.default !== undefined) {
      filled[key] = spec.default;
    }
  }

  for (const [key, spec] of Object.entries(properties)) {
    if (spec["x-secret"] === true || !Object.hasOwn(filled, key)) continue;
    const reason = settingValueFailure(spec, filled[key], true);
    // Why no TYPE here: a supplied value already passed the type pass, and a filled default
    // already passed assertSettingDefaults when the manifest was imported.
    if (reason === "MINIMUM" || reason === "MAXIMUM" || reason === "ENUM") {
      throw fieldError(code, key, reason, constraintMessage(key, reason));
    }
  }
  return filled;
}

/**
 * Refuses import when a package with no settingsSchema already has settings.json.
 * Why existsSync and not readFile: a package with no settings has nothing to check, so the bytes stay unread.
 * Why import only: an update still has an install record, so that file is not an orphan and is left unread.
 */
export function refuseOrphanSettings(dataDir: string, id: string): void {
  const file = settingsFilePath(dataDir, id);
  if (!existsSync(file)) return;
  throw settingsError(
    IMPORT_INVALID,
    "/settings",
    "这个包没有设置项，但已经有一份设置文件。没有读取它。要导入这个包，请先删掉这份文件。",
    { reason: "NO_SCHEMA" },
  );
}

/**
 * Checks a leftover settings file against `manifest.settingsSchema` before package files are written.
 * No schema returns without reading. Why: import uses `refuseOrphanSettings` for that case, and update leaves the file unread.
 */
export async function acceptResidualSettings(dataDir: string, manifest: Manifest): Promise<void> {
  if (manifest.settingsSchema === undefined) return;
  const file = settingsFilePath(dataDir, manifest.id);
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    // Why one reason: invalid JSON and a JSON value that is not an object both have no field to point at.
    // Why the text stays out of the error: the file may hold a secret, and this import has not stored it anywhere we could redact.
    throw settingsError(IMPORT_INVALID, "/settings", "已有的设置文件不是合法的 JSON，所以没有导入。", {
      reason: "NOT_JSON",
    });
  }
  checkSettings(manifest.settingsSchema, parsed as Settings, IMPORT_INVALID);
}

function typeMessage(key: string, type: string): string {
  return `设置项「${key}」的类型不对，应该是${typeName(type)}。`;
}

function constraintMessage(key: string, reason: BoundFailure): string {
  switch (reason) {
    case "MINIMUM":
      return `设置项「${key}」小于允许的最小值。`;
    case "MAXIMUM":
      return `设置项「${key}」大于允许的最大值。`;
    case "ENUM":
      return `设置项「${key}」不在允许的取值里。`;
  }
}

function fieldError(code: PlumsErrorCode, key: string, reason: SettingsFailureReason, message: string): PlumsError {
  return settingsError(code, `/settings/${escapePointer(key)}`, message, { key, reason });
}

function settingsError(
  code: PlumsErrorCode,
  path: string,
  message: string,
  details: { key?: string; reason: SettingsFailureReason },
): PlumsError {
  return new PlumsError({ code, message, path, details });
}
