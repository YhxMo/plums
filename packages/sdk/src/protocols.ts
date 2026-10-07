import { IMPORT_INVALID, PlumsError } from "@plums/core";
import semver from "semver";
import type { ContributionKind, DesktopContribution } from "./index.js";

/** Metadata is a component's claim of compatibility, never an authorization. */
export interface ProtocolProvider {
  /** Unique within this component's provides array. */
  id: string;
  /** Namespaced protocol identifier, independent of the package id. */
  protocol: string;
  /** Exact stable SemVer, independent of the package and SDK versions. */
  version: string;
  contribution: {
    kind: ContributionKind;
    name: string;
    [key: string]: unknown;
  };
  features?: string[];
  [key: string]: unknown;
}

export interface ProtocolRequirement {
  /** Consumer-local binding slot, unique within its requires array. */
  id: string;
  protocol: string;
  range: string;
  features?: string[];
  /** Defaults to false. Optional does not relax compatibility of a binding. */
  optional?: boolean;
  [key: string]: unknown;
}

export interface ProtocolDeclarations {
  provides?: ProtocolProvider[];
  requires?: ProtocolRequirement[];
  [key: string]: unknown;
}

export type ProtocolCompatibility =
  | { compatible: true }
  | {
      compatible: false;
      reason: "PROTOCOL_MISMATCH" | "VERSION_MISMATCH";
    }
  | {
      compatible: false;
      reason: "FEATURES_MISSING";
      missingFeatures: string[];
    };

/** Portable choice only: no install identity, authorization or runtime handle. */
export interface ProtocolBindingIntent {
  consumerId: string;
  consumerDigest: string;
  requirementId: string;
  providerId: string;
  providerDigest: string;
  provideId: string;
  protocolVersion: string;
  contribution: { kind: ContributionKind; name: string };
}
export type ProtocolBindingStatus =
  | {
      state: "available";
      requirementId: string;
      providerId: string;
      provideId: string;
      protocolVersion: string;
    }
  | {
      state: "unbound" | "stale" | "disabled";
      requirementId: string;
      optional: boolean;
    };

const localId = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const protocolId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const contributionName = /^[a-zA-Z0-9_.-]{1,128}$/;
const kinds = new Set(["commands", "tools", "connectors"]);
const basePath = "/payload/plumsDesktop/protocols";

function invalid(path: string): never {
  throw new PlumsError({
    code: IMPORT_INVALID,
    message: "协议声明无效。",
    path,
    details: { reason: "PROTOCOL_DECLARATION_INVALID" },
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function reference(
  value: unknown,
  path: string,
): asserts value is Record<string, unknown> {
  if (!record(value)) invalid(path);
  if (typeof value.id !== "string" || !localId.test(value.id))
    invalid(`${path}/id`);
  if (
    typeof value.protocol !== "string" ||
    value.protocol.length > 256 ||
    !protocolId.test(value.protocol)
  )
    invalid(`${path}/protocol`);
  if (value.features !== undefined) {
    if (!Array.isArray(value.features) || value.features.length > 64)
      invalid(`${path}/features`);
    const seen = new Set<string>();
    for (const [i, feature] of value.features.entries()) {
      if (
        typeof feature !== "string" ||
        !localId.test(feature) ||
        seen.has(feature)
      )
        invalid(`${path}/features/${i}`);
      seen.add(feature);
    }
  }
}

function provider(
  value: unknown,
  path: string,
): asserts value is ProtocolProvider {
  reference(value, path);
  const version =
    typeof value.version === "string" && value.version.length <= 64
      ? semver.parse(value.version)
      : null;
  if (
    !version ||
    version.version !== value.version ||
    version.prerelease.length ||
    version.build.length
  )
    invalid(`${path}/version`);
  const target = value.contribution;
  if (!record(target)) invalid(`${path}/contribution`);
  if (typeof target.kind !== "string" || !kinds.has(target.kind))
    invalid(`${path}/contribution/kind`);
  if (typeof target.name !== "string" || !contributionName.test(target.name))
    invalid(`${path}/contribution/name`);
}

function requirement(
  value: unknown,
  path: string,
): asserts value is ProtocolRequirement {
  reference(value, path);
  if (
    typeof value.range !== "string" ||
    !value.range.trim() ||
    value.range.length > 256 ||
    semver.validRange(value.range) === null
  )
    invalid(`${path}/range`);
  if (value.optional !== undefined && typeof value.optional !== "boolean")
    invalid(`${path}/optional`);
}

/** Validate only generic metadata; preserve the original declarations and unknown fields. */
export function validateProtocolDeclarations(c: DesktopContribution): void {
  if (c.protocols === undefined) return;
  if (c.sdkVersion !== "2") invalid("/payload/plumsDesktop/sdkVersion");
  if (!record(c.protocols)) invalid(basePath);
  for (const key of ["provides", "requires"] as const) {
    const declarations = c.protocols[key];
    if (declarations === undefined) continue;
    const path = `${basePath}/${key}`;
    if (!Array.isArray(declarations) || declarations.length > 100)
      invalid(path);
    const ids = new Set<string>();
    for (const [i, value] of declarations.entries()) {
      const at = `${path}/${i}`;
      if (key === "provides") {
        provider(value, at);
        const target = value.contribution;
        if (!c.contributes?.[target.kind]?.some((d) => d.name === target.name))
          invalid(`${at}/contribution`);
        if (!c.runtime) invalid("/payload/plumsDesktop/runtime");
      } else {
        requirement(value, at);
      }
      if (ids.has(value.id)) invalid(`${at}/id`);
      ids.add(value.id);
    }
  }
}

/**
 * Compare claims only. This neither chooses a provider nor proves schema/behavior
 * conformance, checks package dependencies, creates a binding or grants access.
 * Invalid metadata throws IMPORT_INVALID without echoing the rejected values.
 */
export function checkProtocolCompatibility(
  required: ProtocolRequirement,
  provided: ProtocolProvider,
): ProtocolCompatibility {
  requirement(required, "/requirement");
  provider(provided, "/provider");
  if (required.protocol !== provided.protocol)
    return { compatible: false, reason: "PROTOCOL_MISMATCH" };
  if (!semver.satisfies(provided.version, required.range))
    return { compatible: false, reason: "VERSION_MISMATCH" };
  const features = new Set(provided.features ?? []);
  const missingFeatures = (required.features ?? []).filter(
    (f) => !features.has(f),
  );
  if (missingFeatures.length)
    return { compatible: false, reason: "FEATURES_MISSING", missingFeatures };
  return { compatible: true };
}
