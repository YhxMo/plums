import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createCore,
  FakeModelProvider,
  MemorySecretStore,
  PACKAGE_FORMAT_VERSION,
  RecordingEgressSink,
  ScriptedConfirm,
  type Core,
  type CreateCoreOptions,
  type Manifest,
  type ManifestV1,
  type ManifestV2,
  PlumsError,
} from "@plums/core";
import { expect } from "vitest";
import { ZipFile } from "yazl";

export function makeCore(extra: Partial<CreateCoreOptions> = {}): { core: Core; dataDir: string } {
  const dataDir = mkdtempSync(path.join(tmpdir(), "plums-t2-"));
  const core = createCore({
    dataDir,
    model: new FakeModelProvider(),
    egress: new RecordingEgressSink(),
    confirm: new ScriptedConfirm(),
    secrets: new MemorySecretStore(),
    ...extra,
  });
  return { core, dataDir };
}

export function listAll(dir: string): string[] {
  return readdirSync(dir, { recursive: true }).map(String).sort();
}

/** Historical 1.x contracts remain independent of the default for new packages. */
export function validManifest(kind: Manifest["kind"] = "character"): ManifestV1 {
  return {
    formatVersion: "1.0",
    kind,
    id: `demo-${kind}`,
    name: `Demo ${kind}`,
    version: "1.2.3",
    description: "A package used by tests.",
    license: "Apache-2.0",
    author: "Plums Tests",
    dependencies: [{ kind: "extension", id: "base-pack", range: "^1.0.0", optional: false }],
    permissions: [
      { id: "read-notes", level: "read", target: "notes", reason: "Show your notes." },
      { id: "send-stats", level: "egress", target: "stats.example", reason: "Upload usage." },
    ],
    settingsSchema: {
      type: "object",
      properties: {
        nickname: { type: "string", title: "Nickname", description: "What to call you." },
        retries: { type: "integer", title: "Retries", description: "How many times to retry.", default: 3 },
      },
    },
    payload: { greeting: "hello", nested: { list: [1, 2, { three: 3 }], nothing: null } },
  };
}

export function validManifestV2(kind: Manifest["kind"] = "extension"): ManifestV2 {
  return {
    ...validManifest(kind),
    formatVersion: PACKAGE_FORMAT_VERSION,
    dependencies: [],
    permissions: [
      { id: "files", kind: "fs", target: "workspace", reason: "Use project files.", operations: ["read", "write", "list"] },
      { id: "test", kind: "exec", target: "test", reason: "Run project tests.", cwdRoots: ["workspace"] },
      { id: "send", kind: "egress", target: "api.example.com", reason: "Send a summary." },
    ],
  };
}

export interface ZipSpec {
  name: string;
  data?: Uint8Array | string;
  /** Skips the compression so the entry is stored as-is. */
  store?: boolean;
  /** Empty directory entry. A trailing slash on `name` means the same thing. */
  directory?: boolean;
}

export function buildZip(entries: ZipSpec[]): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const zip = new ZipFile();
    const chunks: Buffer[] = [];
    zip.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    zip.outputStream.on("error", reject);
    zip.outputStream.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    for (const entry of entries) {
      if (entry.directory === true || entry.name.endsWith("/")) {
        zip.addEmptyDirectory(entry.name.endsWith("/") ? entry.name : `${entry.name}/`);
      } else {
        const data = typeof entry.data === "string" ? Buffer.from(entry.data) : Buffer.from(entry.data ?? "");
        zip.addBuffer(data, entry.name, { compress: entry.store !== true });
      }
    }
    zip.end();
  });
}

export function manifestZip(manifest: unknown, extra: ZipSpec[] = []): Promise<Uint8Array> {
  return buildZip([{ name: "manifest.json", data: JSON.stringify(manifest) }, ...extra]);
}

/** Replaces a same-length name inside the zip bytes, to build names that yazl refuses to write. */
export function renameEntry(zip: Uint8Array, from: string, to: string): Uint8Array {
  if (from.length !== to.length) {
    throw new Error("names must have the same length");
  }
  const buffer = Buffer.from(zip);
  const needle = Buffer.from(from);
  let found = 0;
  for (let at = buffer.indexOf(needle); at !== -1; at = buffer.indexOf(needle, at + 1)) {
    buffer.write(to, at);
    found += 1;
  }
  expect(found).toBeGreaterThanOrEqual(2);
  return new Uint8Array(buffer);
}

export async function expectPlumsError(
  promise: Promise<unknown>,
  code: string,
  path?: string,
): Promise<PlumsError> {
  const err = await promise.then(
    () => {
      throw new Error(`expected ${code} but the call succeeded`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PlumsError);
  const plums = err as PlumsError;
  expect(plums.code).toBe(code);
  if (path !== undefined) {
    expect(plums.path).toBe(path);
  }
  expect(plums.message.length).toBeGreaterThan(0);
  return plums;
}
