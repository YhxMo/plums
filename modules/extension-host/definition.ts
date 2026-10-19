import type { ExtensionDefinition } from "../sdk";
import { ContractError } from "../sdk/errors";
import { array, identifier, object, string } from "../sdk/validation";
import { validateConfigurationDeclaration } from "../sdk/configuration";
import { validateCredentialBindings } from "../sdk/credential-bindings";

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
  const manifest = candidate.manifest;
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
}

/** Modules execute as trusted code in the same JS environment. Import is not sandboxed. */
export async function loadExtension(
  url: string,
  expectedId: string,
): Promise<ExtensionDefinition> {
  const module = await import(/* @vite-ignore */ url);
  validateDefinition(module.default);
  if (module.default.manifest.id !== expectedId)
    throw new ContractError(
      "extension.invalid",
      "manifest.id",
      "Module identity does not match catalog",
    );
  return module.default;
}
