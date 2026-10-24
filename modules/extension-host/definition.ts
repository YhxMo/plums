import type { ExtensionDefinition, Manifest } from "@modules/sdk";
import { ContractError } from "@modules/sdk/errors";
import { array, identifier, object, string } from "@modules/sdk/validation";
import { validateConfigurationDeclaration } from "@modules/sdk/configuration";
import {
  validateCredentialBindings,
  validateCredentialProtocols,
} from "@modules/sdk/credential-bindings";
import { validateNetworkSources } from "@modules/sdk/network";

export function validateDefinition(
  value: unknown,
): asserts value is ExtensionDefinition {
  const candidate = value as Partial<ExtensionDefinition> | null;
  if (
    !candidate ||
    !candidate.manifest ||
    typeof candidate.activate !== "function"
  )
    throw new ContractError(
      "extension.invalid",
      "manifest",
      "Invalid extension module",
    );
  validateManifest(candidate.manifest);
}

/** Checks a manifest on its own, as read from a package before any code runs. */
export function validateManifest(value: unknown): asserts value is Manifest {
  object(value, "extension.invalid", {
    path: "manifest",
    label: "Invalid extension module",
  });
  const manifest = value as Manifest;
  validateConfigurationDeclaration(manifest.configuration);
  const identity = {
    path: "manifest.id",
    label: "Unsupported extension identity or SDK version",
  };
  identifier(manifest.id, "extension.invalid", identity);
  string(manifest.version, "extension.invalid", {
    ...identity,
    path: "manifest.version",
    min: 1,
  });
  if (manifest.apiVersion !== 1)
    throw new ContractError("extension.invalid", "manifest.id", identity.label);
  for (const [field, max] of [
    ["name", 40],
    ["description", 500],
  ] as const)
    if (manifest[field] !== undefined)
      string(manifest[field], "extension.invalid", {
        path: `manifest.${field}`,
        label: "Invalid extension name or description",
        min: 1,
        max,
      });
  for (const [name, declarations] of Object.entries({
    requires: manifest.requires,
    optional: manifest.optional,
    provides: manifest.provides,
  })) {
    if (declarations !== undefined)
      object(declarations, "extension.invalid", {
        path: `manifest.${name}`,
        label: "Invalid service declarations",
      });
    if (
      declarations &&
      Object.entries(declarations).some(
        ([key, version]) => !key || !Number.isInteger(version) || version < 1,
      )
    )
      throw new ContractError(
        "extension.invalid",
        `manifest.${name}`,
        "Invalid service contract version",
      );
  }
  if (
    Object.keys(manifest.optional ?? {}).some(
      (name) => manifest.requires?.[name],
    )
  )
    throw new ContractError(
      "extension.invalid",
      "manifest.optional",
      "Invalid service declarations",
    );
  if (manifest.capabilities)
    array(manifest.capabilities, "extension.invalid", undefined, {
      path: "manifest.capabilities",
      label: "Invalid capability declaration",
    }).forEach((value, index) =>
      string(value, "extension.invalid", {
        path: `manifest.capabilities.${index}`,
        label: "Invalid capability declaration",
      }),
    );
  validateCredentialBindings(
    manifest.credentialBindings,
    manifest.capabilities,
  );
  validateCredentialProtocols(
    manifest.credentialProtocols,
    manifest.capabilities,
  );
  validateNetworkSources(manifest.networkSources, manifest.capabilities);
}

/**
 * Pairs a package's main.js default export with the manifest it came with:
 * the export must hold `activate`, and a manifest it also exports must name
 * the same extension.
 */
export function definitionOf(
  manifest: Manifest,
  exported: unknown,
  expectedId?: string,
): ExtensionDefinition {
  const main = exported as {
    manifest?: { id?: unknown };
    activate?: unknown;
  } | null;
  if (typeof main?.activate !== "function")
    throw new ContractError(
      "extension.invalid",
      "activate",
      "main.js must export default { activate }",
    );
  if (main.manifest && main.manifest.id !== manifest.id)
    throw new ContractError(
      "extension.invalid",
      "manifest.id",
      "main.js names another extension than manifest.json",
    );
  if (expectedId !== undefined && manifest.id !== expectedId)
    throw new ContractError(
      "extension.invalid",
      "manifest.id",
      "Module identity does not match catalog",
    );
  const definition = {
    manifest,
    activate: main.activate as ExtensionDefinition["activate"],
  };
  validateDefinition(definition);
  return definition;
}

export type FolderAccess = {
  /** manifest.json, parsed. */
  read?: (url: string) => Promise<unknown>;
  importModule?: (url: string) => Promise<{ default?: unknown }>;
};
const readJson = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) throw Error(`扩展清单读取失败（${response.status}）。`);
  return response.json();
};

/**
 * Loads an extension folder served with the app or by the development
 * server: manifest.json first, then main.js. A query on the folder (such as
 * a retry marker) is kept for both. Modules execute as trusted code in the
 * same JS environment; import is not sandboxed.
 */
export async function loadExtension(
  url: string,
  expectedId?: string,
  {
    read = readJson,
    importModule = (url) => import(/* @vite-ignore */ url),
  }: FolderAccess = {},
): Promise<ExtensionDefinition> {
  const folder = new URL(url);
  if (!folder.pathname.endsWith("/"))
    throw Error("扩展路径须是以 / 结尾的文件夹。");
  const child = (name: string) => {
    const file = new URL(name, folder);
    file.search = folder.search;
    return file.href;
  };
  const manifest = await read(child("manifest.json"));
  validateManifest(manifest);
  const module = await importModule(child("main.js"));
  return definitionOf(manifest, module.default, expectedId);
}
