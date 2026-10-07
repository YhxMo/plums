import { protocolPlan } from "./protocol-bindings.js";
import { digest, importInvalid } from "./library.js";
import { readFile, writeFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type Core, type PackageFiles } from "@plums/core";
import {
  createAgentBundle,
  safePath,
  portableProtocolIntent,
} from "@plums/sdk";
import type { AgentRecord } from "./host.js";
import type { LibraryItem } from "./library.js";
export function checkRecordVersion(record: AgentRecord): void {
  const version: unknown = record.recordVersion;
  if (version !== undefined && version !== 1 && version !== 2)
    importInvalid("此 Agent 的记录版本尚不受支持，原始数据已保留。");
}
interface AssemblyTransaction {
  packageId: string;
  version: string | null;
  beforeVersion: string | null;
  next: AgentRecord;
}
async function readAssemblyTransaction(
  dir: string,
): Promise<AssemblyTransaction | undefined> {
  let t: AssemblyTransaction;
  try {
    t = JSON.parse(
      await readFile(path.join(dir, "assembly-transaction.json"), "utf8"),
    );
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
    throw Error("Agent 组合恢复失败。");
  }
  checkRecordVersion(t.next);
  return t;
}
export async function checkAssemblyRecovery(dir: string): Promise<void> {
  await readAssemblyTransaction(dir);
}
export interface ComponentBinding {
  packageId: string;
  version: string;
  kind: "character" | "extension" | "connector";
  digest: string;
  archive: string;
}
export function binding(
  item: LibraryItem,
  archive = `components/${item.manifest.id}.zip`,
): ComponentBinding {
  return {
    packageId: item.manifest.id,
    version: item.manifest.version,
    kind: item.manifest.kind,
    digest: item.digest,
    archive,
  };
}
export function compose(
  record: AgentRecord,
  components: ComponentBinding[],
  preferences = {
    characterId: record.characterId,
    startup: record.agent.startup,
  },
): AgentRecord {
  const { characterId, startup } = preferences;
  const next = structuredClone(record);
  next.recordVersion = 2;
  next.components = components;
  delete next.characterId;
  if (
    components.some(
      (p) => p.kind === "character" && p.packageId === characterId,
    )
  )
    next.characterId = characterId;
  delete next.agent.character;
  delete next.agent.startup;
  const primary = components.find((p) => p.packageId === next.characterId);
  if (primary) next.agent.character = primary.archive;
  next.agent.characters = components
    .filter((p) => p.kind === "character" && p !== primary)
    .map((p) => p.archive);
  next.agent.extensions = components
    .filter((p) => p.kind === "extension")
    .map((p) => p.archive);
  next.agent.connectors = components
    .filter((p) => p.kind === "connector")
    .map((p) => p.archive);
  if (
    startup &&
    components.some((p) => p.kind === "extension" && p.packageId === startup)
  )
    next.agent.startup = startup;
  return next;
}
export async function saveRecord(dir: string, record: AgentRecord) {
  await writeFile(
    path.join(dir, "record.json.pending"),
    JSON.stringify(record, null, 2),
  );
  await rename(
    path.join(dir, "record.json.pending"),
    path.join(dir, "record.json"),
  );
}
export async function writeExtras(dir: string, files: PackageFiles) {
  for (const [p, bytes] of Object.entries(files)) {
    const file = path.join(dir, "bundle-extras", safePath(p));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
}
export async function readExtras(
  dir: string,
  record: AgentRecord,
): Promise<PackageFiles> {
  const files: PackageFiles = {};
  for (const p of record.extras ?? [])
    files[safePath(p)] = new Uint8Array(
      await readFile(path.join(dir, "bundle-extras", safePath(p))),
    );
  return files;
}
export async function exportAssembly(
  dir: string,
  record: AgentRecord,
  core: Core,
  secrets: readonly string[],
) {
  const components: Record<string, Uint8Array> = {};
  for (const p of record.components ?? [])
    components[p.archive] = await core.exportPackage(
      await core.getPackageContents(p.packageId),
    );
  const exportedDigests = new Map(
    (record.components ?? []).map((p) => [
      p.packageId,
      digest(components[p.archive]!),
    ]),
  );
  const choices = (await protocolPlan(core, record)).requirements
    .filter((s) => s.selected && ["bound", "disabled"].includes(s.state))
    .map((s) => ({
      ...portableProtocolIntent(s.selected!),
      consumerDigest: exportedDigests.get(s.consumerId)!,
      providerDigest: exportedDigests.get(s.selected!.providerId)!,
    }));
  return createAgentBundle(
    { ...record.agent, protocolBindings: choices },
    components,
    await readExtras(dir, record),
    secrets,
  );
}
export async function mutateAssembly<T>(
  dir: string,
  core: Core,
  next: AgentRecord,
  packageId: string,
  version: string | undefined,
  operation: () => Promise<T>,
): Promise<T> {
  const beforeVersion =
    (await core.listInstalled()).find((p) => p.id === packageId)?.version ??
    null;
  const journal = path.join(dir, "assembly-transaction.json");
  await writeFile(
    journal + ".pending",
    JSON.stringify({
      packageId,
      version: version ?? null,
      beforeVersion,
      next,
    }),
  );
  await rename(journal + ".pending", journal);
  let result: T | undefined, failure: unknown;
  try {
    result = await operation();
  } catch (e) {
    failure = e;
  }
  const installed = (await core.listInstalled()).find(
    (p) => p.id === packageId,
  );
  if (
    version === undefined
      ? !installed
      : installed?.version === version && version !== beforeVersion
  )
    await saveRecord(dir, next);
  await rm(journal, { force: true });
  if (failure) throw failure;
  return result as T;
}
export async function recoverAssembly(dir: string, core: Core) {
  const t = await readAssemblyTransaction(dir);
  if (!t) return;
  const installed = (await core.listInstalled()).find(
    (p) => p.id === t.packageId,
  );
  if (
    t.version === null
      ? !installed
      : installed?.version === t.version && t.version !== t.beforeVersion
  )
    await saveRecord(dir, t.next);
  await rm(path.join(dir, "assembly-transaction.json"), { force: true });
}
