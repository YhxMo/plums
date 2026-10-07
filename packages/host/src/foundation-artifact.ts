import {
  readFile,
  mkdir,
  readdir,
  writeFile,
  chmod,
  mkdtemp,
  link,
} from "node:fs/promises";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { createHash, randomUUID, verify as verifySignature } from "node:crypto";
import { readArchive, type PackageFiles } from "@plums/core";
import type { FoundationSelection } from "@plums/sdk";
import { digest } from "./library.js";
import {
  OFFICIAL_FOUNDATION_PROVIDER,
  OFFICIAL_FOUNDATION_REFERENCE,
} from "./official-foundation.js";
import { foundationFailure } from "./foundation-factory.js";
import { open, rename, rm } from "node:fs/promises";
/** Verify current trusted application inputs separately from preserved provider code. */
async function officialAdapterFiles(): Promise<PackageFiles> {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url)),
    dist =
      path.basename(moduleDir) === "src"
        ? path.resolve(moduleDir, "../dist")
        : moduleDir,
    dir =
      path.basename(dist) === "host-adapter"
        ? dist
        : path.join(dist, "host-adapter");
  if (dir !== dist) {
    const source = JSON.parse(
      readFileSync(path.join(dir, "source-inputs.json"), "utf8"),
    ) as { formatVersion: number; inputs: Record<string, string> };
    if (
      source.formatVersion !== 1 ||
      !source.inputs ||
      !Object.keys(source.inputs).length
    )
      throw foundationFailure("FOUNDATION_UNAVAILABLE");
    const names: string[] = [];
    for (const pkg of ["host", "core", "sdk"]) {
      const base =
        pkg === "host" ? dist : path.resolve(dist, "../../", pkg, "dist");
      for (const name of readdirSync(base))
        if (
          name.endsWith(".js") ||
          name.endsWith(".cjs") ||
          ["secure-fs", "controlled-probe"].includes(name)
        )
          names.push(pkg + "/" + name);
    }
    if (
      JSON.stringify(names.sort()) !==
      JSON.stringify(Object.keys(source.inputs).sort())
    )
      throw foundationFailure("FOUNDATION_UNAVAILABLE");
    for (const [name, hash] of Object.entries(source.inputs)) {
      const match = /^(host|core|sdk)\/([a-zA-Z0-9_.-]+)$/.exec(name);
      if (!match || !/^[a-f0-9]{64}$/.test(hash))
        throw foundationFailure("FOUNDATION_UNAVAILABLE");
      const file =
        match[1] === "host"
          ? path.join(dist, match[2]!)
          : path.resolve(dist, "../../", match[1]!, "dist", match[2]!);
      if (
        createHash("sha256").update(readFileSync(file)).digest("hex") !== hash
      )
        throw foundationFailure("FOUNDATION_UNAVAILABLE");
    }
  }
  const files: PackageFiles = {
    "adapter.json": Buffer.from(
      JSON.stringify({
        version: OFFICIAL_FOUNDATION_REFERENCE.version,
        provider: OFFICIAL_FOUNDATION_PROVIDER,
        artifactKind: "installed-builtin-adapter",
      }),
    ),
  };
  for (const file of readdirSync(dir).sort())
    files["code/" + file] = readFileSync(path.join(dir, file));
  return files;
}

import { tmpdir } from "node:os";
import {
  parseFoundationProvider,
  parseFoundationSelection,
  type FoundationProvider,
} from "@plums/sdk";
import {
  FoundationRegistry,
  type FoundationReference,
} from "./foundation-factory.js";
import { PlumsError, validatePackage } from "@plums/core";
import type {
  FoundationAdapterOptions,
  HostFoundationSession,
} from "./foundation-runtime.js";
// The stage-4 trusted canonical archive is a single explicit migration identity.
// Arbitrary unsigned archives are never accepted as builtin code.
const LEGACY_DIGEST =
  "07c70fc4764038c99fbda29e3bfa5ebe5e69aa3b7fe951a77e40e2f518fcc11c";
function installedDirectory() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  return path.basename(dir) === "src" ? path.resolve(dir, "../dist") : dir;
}
function resourceDirectory() {
  const dir = installedDirectory();
  return path.join(
    path.basename(dir) === "host-adapter" ? path.dirname(dir) : dir,
    "foundation-resources",
  );
}
async function trust() {
  const value = JSON.parse(
    await readFile(path.join(resourceDirectory(), "trust.json"), "utf8"),
  );
  if (
    value.trustVersion !== 1 ||
    !Array.isArray(value.publicKeys) ||
    !value.publicKeys.length
  )
    throw foundationFailure("FOUNDATION_UNAVAILABLE");
  return {
    publicKeys: value.publicKeys as string[],
    current: parseFoundationSelection(value.current),
  };
}
export interface OfficialFoundationArtifact {
  selection: FoundationSelection;
  provider: FoundationProvider;
  files: PackageFiles;
  legacy: boolean;
  bytes: Uint8Array;
}
async function verifyArtifactSignature(files: PackageFiles): Promise<void> {
  const signature = JSON.parse(
    Buffer.from(files["signature.json"]!).toString(),
  );
  if (signature.signatureVersion !== 1)
    throw foundationFailure("FOUNDATION_INCOMPATIBLE");
  const inventory = Object.fromEntries(
    Object.keys(files)
      .filter((k) => k !== "signature.json")
      .sort()
      .map((k) => [k, digest(files[k]!)]),
  );
  if (
    !(await trust()).publicKeys.some((key) =>
      verifySignature(
        null,
        Buffer.from(JSON.stringify(inventory)),
        key,
        Buffer.from(signature.signature, "base64"),
      ),
    )
  )
    throw foundationFailure("FOUNDATION_INVALID");
}
async function signedArtifact(
  bytes: Uint8Array,
): Promise<OfficialFoundationArtifact> {
  const contents = await validatePackage(bytes),
    files: PackageFiles = {
      ...contents.files,
      "manifest.json": contents.manifestBytes,
    },
    metadata = JSON.parse(Buffer.from(files["official.json"]!).toString()),
    signature = JSON.parse(Buffer.from(files["signature.json"]!).toString());
  if (
    metadata.artifactVersion !== 1 ||
    metadata.adapterAbi !== 1 ||
    metadata.nodeVersion !== "26.5.1" ||
    metadata.platform !== process.platform + "-" + process.arch ||
    signature.signatureVersion !== 1
  )
    throw foundationFailure("FOUNDATION_INCOMPATIBLE");
  await verifyArtifactSignature(files);
  const provider = parseFoundationProvider(metadata.provider);
  if (
    provider.id !== OFFICIAL_FOUNDATION_REFERENCE.id ||
    provider.execution !== "builtin-adapter" ||
    provider.entry !== "code/adapter.mjs" ||
    contents.manifest.kind !== "extension" ||
    contents.manifest.permissions.length ||
    contents.manifest.id !== provider.id ||
    contents.manifest.version !== metadata.version ||
    JSON.stringify(
      (contents.manifest.payload as Record<string, unknown>).plumsFoundation,
    ) !== JSON.stringify(provider) ||
    !files[provider.entry]
  )
    throw foundationFailure("FOUNDATION_INVALID");
  return {
    selection: {
      selectionVersion: "1.0",
      source: "builtin",
      id: provider.id,
      version: metadata.version,
      digest: digest(bytes),
    },
    provider,
    files,
    legacy: false,
    bytes: new Uint8Array(bytes),
  };
}
async function installedArtifact() {
  // Current application integrity is independent of which historical runtime is selected.
  const canonical = await officialAdapterFiles(),
    bytes = await readFile(path.join(resourceDirectory(), "official.zip")),
    artifact = await signedArtifact(bytes),
    expected = (await trust()).current;
  if (JSON.stringify(artifact.selection) !== JSON.stringify(expected))
    throw foundationFailure("FOUNDATION_UNAVAILABLE");
  const metadata = JSON.parse(
    Buffer.from(artifact.files["official.json"]!).toString(),
  );
  if (
    digest(canonical["code/index.mjs"]!) !== metadata.hostDigest ||
    JSON.stringify(
      Object.fromEntries(
        Object.keys(canonical)
          .filter((k) => k.startsWith("code/"))
          .sort()
          .map((k) => [k.slice(5), digest(canonical[k]!)]),
      ),
    ) !== JSON.stringify(metadata.hostFiles)
  )
    throw foundationFailure("FOUNDATION_UNAVAILABLE");
  return { bytes, artifact };
}
export async function officialAdapterArchive(): Promise<Uint8Array> {
  return (await installedArtifact()).bytes;
}
function publicError(error: unknown, foreign?: any) {
  if (error instanceof PlumsError) return error;
  if (error instanceof Error && error.message === "Extension stopped")
    return new Error("Extension stopped");
  if (foreign && error instanceof foreign) {
    const e = error as PlumsError;
    return new PlumsError({
      code: e.code,
      message: e.message,
      path: e.path,
      details: e.details,
    });
  }
  return foundationFailure("FOUNDATION_UNAVAILABLE");
}
export class OfficialAdapterArtifacts {
  constructor(private root: string) {}
  private cleanupFailures = new Map<string, PlumsError>();
  async settleCleanup(agentId: string) {
    const failure = this.cleanupFailures.get(agentId);
    if (failure) throw failure;
  }
  private file(selection: FoundationSelection) {
    return path.join(
      this.root,
      "foundations",
      "objects",
      selection.digest + ".zip",
    );
  }
  recognizes(bytes: Uint8Array, files: PackageFiles) {
    if (digest(bytes) === LEGACY_DIGEST) return true;
    try {
      return (
        JSON.parse(Buffer.from(files["manifest.json"]!).toString()).payload
          ?.plumsFoundation?.execution === "builtin-adapter"
      );
    } catch {
      return false;
    }
  }
  async preview(bytes: Uint8Array) {
    bytes = new Uint8Array(bytes);
    try {
      if (digest(bytes) === LEGACY_DIGEST) {
        const files = await readArchive(bytes),
          meta = JSON.parse(Buffer.from(files["adapter.json"]!).toString());
        return {
          selection: {
            selectionVersion: "1.0" as const,
            source: "builtin" as const,
            ...OFFICIAL_FOUNDATION_REFERENCE,
            digest: LEGACY_DIGEST,
          },
          provider: parseFoundationProvider(meta.provider),
          files,
          legacy: true,
          bytes,
        };
      }
      return await signedArtifact(bytes);
    } catch (e) {
      throw publicError(e);
    }
  }
  async put(bytes: Uint8Array) {
    bytes = new Uint8Array(bytes);
    const a = await this.preview(bytes);
    await this.save(a.selection, bytes);
    return a.selection;
  }
  private async save(selection: FoundationSelection, bytes: Uint8Array) {
    const file = this.file(selection);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    try {
      if (digest(await readFile(file)) === selection.digest) return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const pending = file + ".pending-" + randomUUID();
    try {
      const h = await open(pending, "w", 0o600);
      try {
        await h.writeFile(bytes);
        await h.sync();
      } finally {
        await h.close();
      }
      await rename(pending, file);
    } finally {
      await rm(pending, { force: true });
    }
  }
  async current(): Promise<FoundationSelection> {
    try {
      const { bytes, artifact } = await installedArtifact();
      await this.save(artifact.selection, bytes);
      return artifact.selection;
    } catch {
      throw foundationFailure("FOUNDATION_UNAVAILABLE");
    }
  }
  async verify(
    selection: FoundationSelection,
  ): Promise<OfficialFoundationArtifact> {
    try {
      const fixed = parseFoundationSelection(selection);
      if (
        fixed.source !== "builtin" ||
        fixed.id !== OFFICIAL_FOUNDATION_REFERENCE.id
      )
        throw foundationFailure("FOUNDATION_UNAVAILABLE");
      const installed = await installedArtifact();
      const bytes = await readFile(this.file(fixed));
      if (digest(bytes) !== fixed.digest)
        throw foundationFailure("FOUNDATION_UNAVAILABLE");
      if (
        fixed.digest === installed.artifact.selection.digest &&
        fixed.version === installed.artifact.selection.version
      ) {
        // Reuse only this call's verified identical bytes; recheck current trust after I/O.
        await verifyArtifactSignature(installed.artifact.files);
        return { ...installed.artifact, bytes: new Uint8Array(bytes) };
      }
      if (fixed.digest === LEGACY_DIGEST && fixed.version === "1.0.0") {
        const files = await readArchive(bytes),
          metadata = JSON.parse(Buffer.from(files["adapter.json"]!).toString());
        return {
          selection: fixed,
          provider: parseFoundationProvider(metadata.provider),
          files,
          legacy: true,
          bytes: new Uint8Array(bytes),
        };
      }
      const artifact = await signedArtifact(bytes);
      if (
        ["source", "id", "version", "digest"].some(
          (field) => artifact.selection[field] !== fixed[field],
        )
      )
        throw foundationFailure("FOUNDATION_UNAVAILABLE");
      return artifact;
    } catch {
      throw foundationFailure("FOUNDATION_UNAVAILABLE");
    }
  }
  async list() {
    await this.current();
    const dir = path.join(this.root, "foundations", "objects"),
      result = [];
    for (const name of await readdir(dir))
      if (/^[a-f0-9]{64}\.zip$/.test(name)) {
        try {
          const bytes = await readFile(path.join(dir, name));
          let a: OfficialFoundationArtifact;
          if (name === LEGACY_DIGEST + ".zip")
            a = await this.verify({
              selectionVersion: "1.0",
              source: "builtin",
              id: OFFICIAL_FOUNDATION_REFERENCE.id,
              version: "1.0.0",
              digest: LEGACY_DIGEST,
            });
          else a = await this.preview(bytes);
          if (a.selection.digest + ".zip" === name)
            result.push({ selection: a.selection, provider: a.provider });
        } catch {
          /* Corrupt/foreign objects are diagnosed through their Agent pins. */
        }
      }
    return result;
  }
  async archive(selection: FoundationSelection) {
    return new Uint8Array((await this.verify(selection)).bytes);
  }
  async remove(selection: FoundationSelection) {
    await this.verify(selection);
    if (selection.digest === (await this.current()).digest)
      throw foundationFailure("FOUNDATION_BUILTIN_REQUIRED");
    await rm(this.file(selection));
  }
  async register(
    registry: FoundationRegistry,
    selection: FoundationSelection,
    nodePath: string,
  ): Promise<FoundationReference> {
    selection = parseFoundationSelection(selection);
    const a = await this.verify(selection),
      reference = {
        id: selection.id,
        version: selection.version,
        digest: selection.digest,
      };
    registry.register({
      provider: a.provider,
      version: selection.version,
      selection,
      create: async (options) => {
        const verified = await this.verify(selection);
        return this.load(verified, options, nodePath);
      },
    });
    return reference;
  }
  private async load(
    artifact: OfficialFoundationArtifact,
    options: FoundationAdapterOptions,
    nodePath: string,
  ): Promise<HostFoundationSession> {
    const allocation = options.allocateSnapshot?.(),
      root =
        allocation?.root ??
        (await mkdtemp(path.join(tmpdir(), "plums-official-")));
    let session: HostFoundationSession | undefined,
      foreign: any,
      closing: Promise<void> | undefined;
    const nativeSnapshots = new Map<string, string>();
    const verifyNative = async () => {
      for (const [file, expected] of nativeSnapshots)
        if (digest(readFileSync(file)) !== expected) {
          session?.stop();
          throw foundationFailure("FOUNDATION_UNAVAILABLE");
        }
    };
    const cleanup = async () => {
      await rm(root, { recursive: true, force: true });
      allocation?.release();
    };
    try {
      await mkdir(root, { recursive: true, mode: 0o700 });
      for (const [name, bytes] of Object.entries(artifact.files))
        if (name.startsWith("code/")) {
          const file = path.join(root, name.slice(5));
          await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
          const nativeHelper = [
            "code/secure-fs",
            "code/controlled-probe",
          ].includes(name);
          let copied = false;
          if (
            nativeHelper ||
            (name.startsWith("code/node_modules/isolated-vm/") &&
              name.endsWith(".node"))
          ) {
            // Reuse the same native image inode only when its bytes equal the archive.
            // This avoids repeated macOS image verification; no installed bytes change.
            try {
              let candidate: string;
              if (nativeHelper)
                candidate = path.join(installedDirectory(), name.slice(5));
              else {
                const { createRequire } = await import("node:module"),
                  req = createRequire(import.meta.url);
                candidate = path.join(
                  path.dirname(req.resolve("isolated-vm/package.json")),
                  name.slice("code/node_modules/isolated-vm/".length),
                );
              }
              if (digest(await readFile(candidate)) === digest(bytes)) {
                await link(candidate, file);
                if (digest(await readFile(file)) !== digest(bytes))
                  throw foundationFailure("FOUNDATION_INVALID");
                copied = true;
              }
            } catch {
              // Unlink first: writing through a successful hard link could mutate the install.
              await rm(file, { force: true });
            }
          }
          if (!copied)
            await writeFile(file, bytes, { mode: 0o400, flag: "wx" });
          if (nativeHelper || name.endsWith(".node"))
            nativeSnapshots.set(file, digest(bytes));
          if (nativeHelper && !copied) await chmod(file, 0o500);
        }
      await writeFile(
        path.join(root, "package.json"),
        JSON.stringify({ type: "module" }),
        { mode: 0o400 },
      );
      if (artifact.legacy) {
        // The legacy trusted archive carried the adapter, but not its external native deps.
        // Supply only the fixed application's installed native modules for this migration case.
        const { createRequire } = await import("node:module"),
          { symlink } = await import("node:fs/promises"),
          req = createRequire(import.meta.url);
        await mkdir(path.join(root, "node_modules"));
        for (const name of ["isolated-vm", "better-sqlite3"]) {
          let location: string;
          try {
            location = req.resolve(name + "/package.json");
          } catch {
            const coreRequire = createRequire(
              path.resolve(installedDirectory(), "../../core/package.json"),
            );
            location = coreRequire.resolve(name + "/package.json");
          }
          await symlink(
            path.dirname(location),
            path.join(root, "node_modules", name),
          );
        }
      }
      const mod = await import(
        pathToFileURL(
          path.join(root, artifact.legacy ? "index.mjs" : "adapter.mjs"),
        ).href
      );
      foreign = mod.PlumsError;
      const bridged = {
        ...options,
        bridge: async (
          ...args: Parameters<FoundationAdapterOptions["bridge"]>
        ) => {
          try {
            await verifyNative();
            return await options.bridge(...args);
          } catch (e) {
            if (e instanceof PlumsError)
              throw new foreign({
                code: e.code,
                message: e.message,
                path: e.path,
                details: e.details,
              });
            throw e;
          }
        },
      };
      session = artifact.legacy
        ? await mod
            .createOfficialFoundationRegistry(nodePath)
            .create(OFFICIAL_FOUNDATION_REFERENCE, bridged)
        : await mod.createOfficialFoundationSession(bridged, nodePath);
    } catch (e) {
      try {
        await session?.close();
      } catch {
        const failure = foundationFailure("FOUNDATION_CLEANUP_FAILED");
        this.cleanupFailures.set(options.actor.agentId, failure);
        throw failure;
      }
      try {
        await cleanup();
      } catch {
        const failure = foundationFailure("FOUNDATION_CLEANUP_FAILED");
        this.cleanupFailures.set(options.actor.agentId, failure);
        throw failure;
      }
      throw publicError(e, foreign);
    }
    const inner = session!;
    const run = async (fn: () => Promise<unknown>) => {
      try {
        await verifyNative();
        return await fn();
      } catch (e) {
        throw publicError(e, foreign);
      }
    };
    const close = () =>
      (closing ??= (async () => {
        let failed = false;
        try {
          await inner.close();
        } catch {
          throw foundationFailure("FOUNDATION_CLEANUP_FAILED");
        }
        try {
          await cleanup();
        } catch {
          failed = true;
        }
        if (failed) throw foundationFailure("FOUNDATION_CLEANUP_FAILED");
      })());
    return {
      instanceId: options.binding.instanceId,
      get alive() {
        return inner.alive;
      },
      ready: () => run(() => inner.ready()) as Promise<void>,
      activate: () => run(() => inner.activate()) as Promise<void>,
      invoke: (...args) => run(() => inner.invoke(...args)),
      deliverEvent: (...args) => run(() => inner.deliverEvent(...args)),
      stop: () => inner.stop(),
      cancel: async () => {
        inner.stop();
        await close();
      },
      close,
    };
  }
}
