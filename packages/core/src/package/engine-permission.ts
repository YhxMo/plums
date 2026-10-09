import { MANIFEST_INVALID, PlumsError } from "../errors.js";
import { parseEgressTarget } from "./egress-target.js";
import { enginePermissionValidator } from "./schema.js";
import type { EnginePermission } from "./types.js";

/** Validates only the public declaration, never payload or execution authorization. */
export function validateEnginePermission(
  value: unknown,
  at = "",
): EnginePermission {
  const invalid = (field: string): never => {
    throw new PlumsError({
      code: MANIFEST_INVALID,
      message: "本地执行权限声明无效。",
      ...(at + field === "" ? {} : { path: at + field }),
    });
  };
  if (!enginePermissionValidator(value)) {
    const error = enginePermissionValidator.errors?.[0];
    invalid(
      (error?.instancePath ?? "") +
        (error?.keyword === "required"
          ? "/" + String(error.params.missingProperty)
          : ""),
    );
  }
  const permission = value as EnginePermission;
  if (permission.tier !== "project") {
    for (const field of ["network", "toolchains", "credentials"] as const)
      if (permission[field] !== undefined) invalid("/" + field);
  }
  const hosts = new Set<string>();
  for (const [index, host] of (permission.network?.hosts ?? []).entries()) {
    const parsed = parseEgressTarget(host);
    // Local network authorization is HTTPS CONNECT to port 443 only.
    if (!parsed || parsed.port !== "443")
      return invalid(`/network/hosts/${index}`);
    const key = `${parsed.wildcard ? "*." : ""}${parsed.host}`;
    if (hosts.has(key)) invalid(`/network/hosts/${index}`);
    hosts.add(key);
  }
  const ids = new Set<string>();
  for (const [index, credential] of (permission.credentials ?? []).entries()) {
    if (ids.has(credential.id)) invalid(`/credentials/${index}/id`);
    ids.add(credential.id);
    const parsed = parseEgressTarget(credential.host);
    if (!parsed || parsed.wildcard || parsed.port !== "443")
      return invalid(`/credentials/${index}/host`);
    if (
      !hosts.has(parsed.host) &&
      ![...hosts].some(
        (host) => host.startsWith("*.") && parsed.host.endsWith(host.slice(1)),
      )
    )
      invalid(`/credentials/${index}/host`);
  }
  return permission;
}
