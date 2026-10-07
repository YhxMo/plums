import { Ajv } from "ajv";
import semver from "semver";
import {
  PlumsError,
  IMPORT_INVALID,
  type Manifest,
  type PackageFiles,
} from "@plums/core";
import {
  foundationProviderSchema,
  foundationRequirementSchema,
  foundationSelectionSchema,
  foundationAgentSchema,
  foundationMessageSchema,
} from "./foundation-schema.js";
export * from "./foundation-schema.js";
export const FOUNDATION_PROTOCOL_VERSION = "1.0";
export interface FoundationProvider {
  declarationVersion: `1.${number}`;
  id: string;
  foundationVersion: `1.${number}`;
  entry: string;
  execution: "controlled-node" | "builtin-adapter";
  platforms: string[];
  features: string[];
  hostFeatures: string[];
  sdks: {
    id: string;
    range: string;
    features: string[];
    featureRanges?: {
      range: string;
      features: string[];
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  }[];
  [key: string]: unknown;
}
export interface FoundationRequirement {
  requirementVersion: `1.${number}`;
  protocolRange: string;
  sdk: { id: string; version: string; [key: string]: unknown };
  features: string[];
  optionalFeatures?: string[];
  providerId?: string;
  [key: string]: unknown;
}
export interface FoundationSelection {
  selectionVersion: `1.${number}`;
  source: "builtin" | "library";
  id: string;
  version: string;
  digest: string;
  [key: string]: unknown;
}
export interface FoundationAgent {
  requirement: FoundationRequirement;
  selection?: FoundationSelection;
  [key: string]: unknown;
}
export interface FoundationCompatibility {
  compatible: boolean;
  diagnostics: {
    reason:
      | "PROTOCOL"
      | "SDK"
      | "FEATURE"
      | "HOST_FEATURE"
      | "PLATFORM"
      | "PROVIDER";
    missing?: string[];
  }[];
  missingOptionalFeatures: string[];
  evidence: "declared";
  foundationVersion: "1.0";
}
export interface FoundationActor {
  agentId: string;
  componentId: string;
  installationId: string;
  componentVersion: string;
  componentDigest: string;
  instanceId: string;
}
export interface FoundationSession<Context> {
  readonly instanceId: string;
  readonly alive: boolean;
  ready(): Promise<void>;
  activate(): Promise<void>;
  invoke(
    kind: "commands" | "tools" | "connectors",
    name: string,
    input: unknown,
    context: Context,
  ): Promise<unknown>;
  deliverEvent(
    topic: string,
    event: unknown,
    context: Context,
  ): Promise<unknown>;
  cancel(): Promise<void>;
  stop(): void;
  close(): Promise<void>;
}
export type FoundationProviderMessage =
  | {
      foundationVersion: `1.${number}`;
      sessionId: string;
      type: "ready";
      sdk: { id: string; version: string };
      features: string[];
      [key: string]: unknown;
    }
  | {
      foundationVersion: `1.${number}`;
      sessionId: string;
      type: "activated" | "fatal";
      [key: string]: unknown;
    }
  | {
      foundationVersion: `1.${number}`;
      sessionId: string;
      type: "callback";
      callId: string;
      callbackId: string;
      method: string;
      args: Record<string, unknown>;
      [key: string]: unknown;
    }
  | {
      foundationVersion: `1.${number}`;
      sessionId: string;
      type: "result";
      callId: string;
      ok: boolean;
      value: unknown;
      [key: string]: unknown;
    };
const ajv = new Ajv({ allErrors: false, strict: false });
const validators = [
  foundationProviderSchema,
  foundationRequirementSchema,
  foundationSelectionSchema,
  foundationAgentSchema,
  foundationMessageSchema,
].map((s) => ajv.compile(s));
function invalid(path: string): never {
  throw new PlumsError({
    code: IMPORT_INVALID,
    message: "底座声明或协议无效。",
    path,
  });
}
function parse<T>(value: unknown, index: number, path: string): T {
  let copied: unknown;
  try {
    copied = JSON.parse(JSON.stringify(value));
  } catch {
    return invalid(path);
  }
  if (!validators[index]!(copied)) invalid(path);
  return copied as T;
}
function entryPath(entry: string, path: string) {
  if (
    !entry ||
    /[\\\0]/.test(entry) ||
    entry.startsWith("/") ||
    /^[a-z]:/i.test(entry) ||
    entry.split("/").some((s) => !s || s === "." || s === "..")
  )
    invalid(path);
}
export function parseFoundationProvider(value: unknown): FoundationProvider {
  const p = parse<FoundationProvider>(value, 0, "/payload/plumsFoundation");
  entryPath(p.entry, "/payload/plumsFoundation/entry");
  if (
    new Set(p.sdks.map((s) => s.id)).size !== p.sdks.length ||
    p.sdks.some(
      (s) =>
        !semver.validRange(s.range) ||
        s.featureRanges?.some((r) => !semver.validRange(r.range)),
    )
  )
    invalid("/payload/plumsFoundation/sdks");
  for (const feature of [
    "session.invoke",
    "session.callback",
    "session.cancel",
  ])
    if (!p.features.includes(feature))
      invalid("/payload/plumsFoundation/features");
  return p;
}
export function parseFoundationRequirement(
  value: unknown,
): FoundationRequirement {
  const r = parse<FoundationRequirement>(value, 1, "/foundation/requirement");
  if (!semver.validRange(r.protocolRange) || !semver.valid(r.sdk.version))
    invalid("/foundation/requirement");
  if (r.optionalFeatures?.some((f) => r.features.includes(f)))
    invalid("/foundation/requirement/optionalFeatures");
  return r;
}
export function parseFoundationSelection(value: unknown): FoundationSelection {
  const s = parse<FoundationSelection>(value, 2, "/foundation/selection");
  if (!semver.valid(s.version)) invalid("/foundation/selection/version");
  return s;
}
export function parseFoundationAgent(value: unknown): FoundationAgent {
  const a = parse<FoundationAgent>(value, 3, "/foundation");
  a.requirement = parseFoundationRequirement(a.requirement);
  if (a.selection) a.selection = parseFoundationSelection(a.selection);
  return a;
}
export function parseFoundationMessage(
  value: unknown,
): FoundationProviderMessage {
  return parse<FoundationProviderMessage>(value, 4, "/foundation/message");
}
export function foundationProvider(
  manifest: Manifest,
  files?: PackageFiles,
): FoundationProvider | undefined {
  const payload = manifest.payload as Record<string, unknown> | undefined;
  if (!payload || !Object.hasOwn(payload, "plumsFoundation")) return undefined;
  if (
    manifest.kind !== "extension" ||
    !manifest.formatVersion.startsWith("2.") ||
    manifest.permissions.length ||
    Object.hasOwn(payload, "plumsDesktop")
  )
    invalid("/payload/plumsFoundation");
  const p = parseFoundationProvider(payload.plumsFoundation);
  if (p.execution !== "controlled-node")
    invalid("/payload/plumsFoundation/execution");
  if (p.id !== manifest.id || (files && !Object.hasOwn(files, p.entry)))
    invalid("/payload/plumsFoundation/entry");
  return p;
}
export function checkFoundationCompatibility(
  provider: unknown,
  requirement: unknown,
  platform: string,
  hostFeatures: readonly string[],
): FoundationCompatibility {
  const p = parseFoundationProvider(provider),
    r = parseFoundationRequirement(requirement),
    diagnostics: FoundationCompatibility["diagnostics"] = [];
  if (!semver.satisfies(FOUNDATION_PROTOCOL_VERSION + ".0", r.protocolRange))
    diagnostics.push({ reason: "PROTOCOL" });
  if (r.providerId && r.providerId !== p.id)
    diagnostics.push({ reason: "PROVIDER" });
  if (!p.platforms.includes(platform)) diagnostics.push({ reason: "PLATFORM" });
  const sdk = p.sdks.find(
    (s) => s.id === r.sdk.id && semver.satisfies(r.sdk.version, s.range),
  );
  if (!sdk) diagnostics.push({ reason: "SDK" });
  const features = [
    ...(sdk?.features ?? []),
    ...(sdk?.featureRanges ?? [])
      .filter((s) => semver.satisfies(r.sdk.version, s.range))
      .flatMap((s) => s.features),
  ];
  const missing = r.features.filter((f) => !features.includes(f));
  if (missing.length) diagnostics.push({ reason: "FEATURE", missing });
  const hostMissing = p.hostFeatures.filter((f) => !hostFeatures.includes(f));
  if (hostMissing.length)
    diagnostics.push({ reason: "HOST_FEATURE", missing: hostMissing });
  return {
    compatible: diagnostics.length === 0,
    diagnostics,
    missingOptionalFeatures: (r.optionalFeatures ?? []).filter(
      (f) => !features.includes(f),
    ),
    evidence: "declared",
    foundationVersion: FOUNDATION_PROTOCOL_VERSION,
  };
}

/** Public host-to-provider JSONL protocol. Call identity belongs to the transport,
 * never to business input or a provider-chosen context. All frames are <= 1 MiB. */
export type FoundationHostMessage =
  | {
      foundationVersion: "1.0";
      sessionId: string;
      type: "prepare";
      binding: FoundationActor;
      provider: FoundationSelection;
      sdk: { id: string; version: string };
      features: string[];
      extension: {
        entry: string;
        files: Record<string, string>;
        contributes: Partial<
          Record<
            "commands" | "tools" | "connectors",
            {
              name: string;
              title: string;
              inputSchema?: unknown;
              outputSchema?: unknown;
            }[]
          >
        >;
      };
      limits: {
        maxFrameBytes: number;
        maxCallbacks: number;
        synchronousMs: number;
        memoryMiB: number;
      };
    }
  | {
      foundationVersion: "1.0";
      sessionId: string;
      type: "activate" | "stop" | "cancel";
    }
  | {
      foundationVersion: "1.0";
      sessionId: string;
      type: "invoke";
      callId: string;
      kind: "commands" | "tools" | "connectors";
      name: string;
      input: unknown;
    }
  | {
      foundationVersion: "1.0";
      sessionId: string;
      type: "event";
      callId: string;
      topic: string;
      event: unknown;
    }
  | {
      foundationVersion: "1.0";
      sessionId: string;
      type: "reply";
      callId: string;
      callbackId: string;
      ok: boolean;
      value: unknown;
    };
