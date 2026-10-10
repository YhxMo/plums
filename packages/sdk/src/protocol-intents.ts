import { createHash } from "node:crypto";
import { IMPORT_INVALID, PlumsError, type Manifest } from "@plumsjs/core";
import { desktopContribution } from "./index.js";
import {
  checkProtocolCompatibility,
  type ProtocolBindingIntent,
} from "./protocols.js";

export function validateProtocolIntents(
  value: unknown,
  packages: { manifest: Manifest; digest: string }[],
): asserts value is ProtocolBindingIntent[] | undefined {
  if (value === undefined) return;
  const invalid = (path: string): never => {
    throw new PlumsError({
      code: IMPORT_INVALID,
      message: "组合中的组件连接无效，请重新选择。",
      path,
      details: { reason: "PROTOCOL_INTENT_INVALID" },
    });
  };
  if (!Array.isArray(value) || value.length > 10000)
    invalid("/protocolBindings");
  const seen = new Set<string>();
  for (const [i, b] of (value as ProtocolBindingIntent[]).entries()) {
    const at = `/protocolBindings/${i}`;
    if (!b || typeof b !== "object" || Array.isArray(b)) invalid(at);
    for (const key of [
      "consumerId",
      "providerId",
      "requirementId",
      "provideId",
      "protocolVersion",
    ] as const)
      if (typeof b[key] !== "string") invalid(`${at}/${key}`);
    for (const key of ["consumerDigest", "providerDigest"] as const)
      if (typeof b[key] !== "string" || !/^[a-f0-9]{64}$/.test(b[key]))
        invalid(`${at}/${key}`);
    const key = JSON.stringify([b.consumerId, b.requirementId]);
    if (seen.has(key)) invalid(at);
    seen.add(key);
    const consumer = packages.find((p) => p.manifest.id === b.consumerId),
      provider = packages.find((p) => p.manifest.id === b.providerId);
    if (!consumer || consumer.digest !== b.consumerDigest)
      invalid(`${at}/consumerDigest`);
    if (
      !provider ||
      provider.digest !== b.providerDigest ||
      b.consumerId === b.providerId
    )
      invalid(`${at}/providerDigest`);
    const requirement = desktopContribution(
      consumer!.manifest,
    )?.protocols?.requires?.find((r) => r.id === b.requirementId);
    const provided = desktopContribution(
      provider!.manifest,
    )?.protocols?.provides?.find((p) => p.id === b.provideId);
    if (
      !requirement ||
      !provided ||
      !checkProtocolCompatibility(requirement, provided).compatible ||
      provided.version !== b.protocolVersion
    )
      invalid(at);
    if (
      !b.contribution ||
      b.contribution.kind !== provided!.contribution.kind ||
      b.contribution.name !== provided!.contribution.name
    )
      invalid(`${at}/contribution`);
  }
}
export function protocolArtifactDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}
/** Strip local installation and authorization fields even from untrusted imported intents. */
export function portableProtocolIntent(
  b: ProtocolBindingIntent,
): ProtocolBindingIntent {
  return {
    consumerId: b.consumerId,
    consumerDigest: b.consumerDigest,
    requirementId: b.requirementId,
    providerId: b.providerId,
    providerDigest: b.providerDigest,
    provideId: b.provideId,
    protocolVersion: b.protocolVersion,
    contribution: { kind: b.contribution.kind, name: b.contribution.name },
  };
}
