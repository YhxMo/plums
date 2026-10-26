import type { Agent } from "@modules/agents/contract";
import {
  bundleNotes,
  writeBundle,
  type ReadBundle,
} from "@modules/agents/agent-bundle";
import { bytesToBase64 } from "@modules/agents/card-png";
import type { BundleExtension, PackageOutcome } from "@modules/sdk";
import { fileName, roleCardFile, roleCardPng } from "./cardFile";

/** What the interface does with files and packages through the host. */
export type AgentFiles = {
  /** Saves a file where the person chooses; base64 bytes. */
  save(name: string, data: string): Promise<{ saved: boolean }>;
  /** The installed extensions among `ids`, with third-party packages. */
  bundle(ids: string[]): Promise<BundleExtension[]>;
  /** Offers a bundle's packages for installation, one answer each in order. */
  offer(
    packages: { manifest: string; main: string }[],
  ): Promise<PackageOutcome[]>;
};

/** Saves the Agent as a picture role card; false when the person cancels. */
export async function exportRoleCard(agent: Agent, files: AgentFiles) {
  const { name, data } = await roleCardFile(agent);
  return (await files.save(name, data)).saved;
}

/**
 * Saves the Agent with `extensions`, the ones among its `parts` that are
 * installed, as one `.plums` file; false when the person cancels.
 */
export async function exportBundle(
  agent: Agent,
  parts: readonly string[],
  extensions: BundleExtension[],
  files: AgentFiles,
) {
  const bundle = await writeBundle({
    card: await roleCardPng(agent),
    extensions,
    off: (agent.off ?? []).filter((id) => parts.includes(id)),
  });
  return (
    await files.save(fileName(agent.name, ".plums"), bytesToBase64(bundle))
  ).saved;
}

/**
 * Offers a whole-Agent file's packages, then says which of its parts stay
 * off here and why: not installed, declined or of an incompatible version.
 */
export async function importBundle(bundle: ReadBundle, files: AgentFiles) {
  const outcomes = bundle.packages.length
    ? (await files.offer(bundle.packages)).map((outcome, i) => ({
        ...outcome,
        id: bundle.packages[i].id,
      }))
    : [];
  return bundleNotes(
    bundle.extensions,
    await files.bundle(bundle.extensions.map(({ id }) => id)),
    outcomes,
  );
}
