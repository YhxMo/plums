import { redact } from "../redact.js";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PlumsError, SECRET_NOT_FOUND, SETTINGS_INVALID } from "../errors.js";
import { escapePointer } from "../package/manifest.js";
import type { Manifest } from "../package/types.js";
import { secretKeys, secretRef } from "../secrets.js";
import { checkSettings, settingsFilePath } from "./check-settings.js";
import { requireInstalled, requireManifest, type InstallContext } from "./lifecycle.js";
import { DATABASE_FILE } from "./store.js";

type Settings = Record<string, unknown>;

/**
 * Checks every `x-secret` value against the SecretStore and returns the settings with
 * those refs replaced by the real values. Throws SECRET_NOT_FOUND at `/settings/<key>`.
 */
async function resolveSecrets(ctx: InstallContext, manifest: Manifest, values: Settings): Promise<Settings> {
  const out = { ...values };
  for (const key of secretKeys(manifest).filter((k) => Object.hasOwn(values, k))) {
    const ref = secretRef(manifest.id, key);
    const fail = (reason: "NOT_A_SECRET_REF" | "NOT_FOUND", message: string) =>
      new PlumsError({
        code: SECRET_NOT_FOUND,
        message,
        path: `/settings/${escapePointer(key)}`,
        details: { id: manifest.id, key, secretRef: ref, reason },
      });
    if (values[key] !== ref) {
      throw fail("NOT_A_SECRET_REF", `设置项「${key}」是密钥，只能填引用 ${ref}，不能直接写密钥本身。`);
    }
    const value = await ctx.secrets.get(ref);
    if (value === undefined) {
      throw fail("NOT_FOUND", `设置项「${key}」引用的密钥 ${ref} 还没有保存。请先把密钥存进 SecretStore。`);
    }
    out[key] = value;
  }
  return out;
}

/** Replaces the package's saved settings. Nothing is written when a value or a secret ref is rejected. */
export async function setSettings(ctx: InstallContext, id: string, values: Settings): Promise<void> {
  requireInstalled(ctx, id);
  const manifest = requireManifest(ctx, id);
  if (values === null || typeof values !== "object" || Array.isArray(values)) {
    throw new TypeError("setSettings values must be an object");
  }
  // Why SETTINGS_INVALID: the baseline only used SECRET_NOT_FOUND, and only for a bad secret ref.
  const saving = manifest.settingsSchema === undefined ? values : checkSettings(manifest.settingsSchema, values, SETTINGS_INVALID);
  await resolveSecrets(ctx, manifest, saving);
  const file = settingsFilePath(ctx.dataDir, id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(saving, null, 2));
}

/** The saved settings with secret refs replaced by their values. `{}` when none were saved. */
export async function resolveSettings(ctx: InstallContext, id: string): Promise<Settings> {
  requireInstalled(ctx, id);
  let text: string;
  try {
    text = await readFile(settingsFilePath(ctx.dataDir, id), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
  return resolveSecrets(ctx, requireManifest(ctx, id), JSON.parse(text) as Settings);
}

/** Every secret value stored for an installed package. What `redact` is given. */
export async function knownSecrets(ctx: InstallContext): Promise<string[]> {
  if (!existsSync(path.join(ctx.dataDir, DATABASE_FILE))) return [];
  const values = await Promise.all(
    ctx.store.listSecretRefs().map((ref) => ctx.secrets.get(ref)),
  );
  return values.filter((value) => value !== undefined);
}

export interface SettingsDescription {
  schema: Manifest["settingsSchema"];
  values: Record<string, unknown>;
  secrets: Record<string, boolean>;
}
/** Secret values and references never cross this read interface. */
export async function describeSettings(ctx: InstallContext, id: string): Promise<SettingsDescription> {
  requireInstalled(ctx, id);
  const manifest = requireManifest(ctx, id);
  const values: Settings = {};
  const configured: Record<string, boolean> = {};
  if (manifest.settingsSchema) {
    for (const [key, spec] of Object.entries(manifest.settingsSchema.properties)) if (spec.default !== undefined) values[key] = spec.default;
    try { Object.assign(values, JSON.parse(await readFile(settingsFilePath(ctx.dataDir, id), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new PlumsError({ code: SETTINGS_INVALID, message: "无法读取设置。", path: "/settings" }); }
    for (const key of secretKeys(manifest)) {
      delete values[key];
      configured[key] = (await ctx.secrets.get(secretRef(id, key))) !== undefined;
    }
  }
  return redact({ schema: manifest.settingsSchema, values, secrets: configured }, await knownSecrets(ctx)) as SettingsDescription;
}
