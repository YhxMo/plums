import { readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createCore, type SecretStore, type EgressSink } from "@plums/core";
import { type AgentBundle, type AgentBundleManifest } from "@plums/sdk";
import type { AgentRecord } from "./host.js";
import { saveRecord } from "./assembly.js";
export function bundleExtras(bundle: AgentBundle) {
  return Object.fromEntries(
    Object.entries(bundle.files).filter(
      ([p]) =>
        p !== "agent.json" && !bundle.packages.some((c) => c.archive === p),
    ),
  );
}
export async function recoverComponentMutation(
  dir: string,
  secrets: SecretStore,
  egress: EgressSink,
): Promise<void> {
  const journal = path.join(dir, "component-transaction.json");
  let transaction: {
    packageId: string;
    version: string | null;
    beforeVersion?: string | null;
    agent: AgentBundleManifest;
  };
  try {
    transaction = JSON.parse(await readFile(journal, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw Error("Component recovery failed");
  }
  const core = createCore({
    dataDir: path.join(dir, "core"),
    secrets,
    egress,
  });
  try {
    const installed = (await core.listInstalled()).find(
      (p) => p.id === transaction.packageId,
    );
    if (
      transaction.version === null
        ? !installed
        : installed?.version === transaction.version &&
          transaction.version !== transaction.beforeVersion
    ) {
      try {
        await rename(
          path.join(dir, "component.pending.zip"),
          path.join(dir, "bundle.zip"),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const record = JSON.parse(
        await readFile(path.join(dir, "record.json"), "utf8"),
      ) as AgentRecord;
      record.agent = transaction.agent;
      record.name = transaction.agent.name;
      await saveRecord(dir, record);
    }
  } finally {
    core.close();
  }
  await rm(journal, { force: true });
  await rm(path.join(dir, "component.pending.zip"), { force: true });
}
