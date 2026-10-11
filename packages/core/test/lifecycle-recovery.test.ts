import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createCore,
  RecordingEgressSink,
  secretRef,
  type Core,
} from "@plumsjs/core";
import { afterEach, describe, expect, it } from "vitest";
import { manifestZip, validManifest } from "./package-helpers.js";

const id = "lifecycle.test",
  ref = secretRef(id, "token");
const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const helper = fileURLToPath(new URL("./lifecycle-child.mjs", import.meta.url));
const children: ChildProcess[] = [],
  cores: Core[] = [];
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, "close");
      child.kill("SIGKILL");
      await closed;
    }
  }
  for (const core of cores.splice(0)) core.close();
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "plums-lifecycle-"));
  const dataDir = path.join(root, "data"),
    secretFile = path.join(root, "secrets.json");
  await writeFile(
    secretFile,
    JSON.stringify({ [ref]: "FAKE_LIFECYCLE_SECRET" }),
  );
  const secrets = {
    async get(key: string) {
      return JSON.parse(readFileSync(secretFile, "utf8"))[key];
    },
    async set(key: string, value: string) {
      const values = JSON.parse(readFileSync(secretFile, "utf8"));
      values[key] = value;
      writeFileSync(secretFile, JSON.stringify(values));
    },
    async delete(key: string) {
      const values = JSON.parse(readFileSync(secretFile, "utf8"));
      delete values[key];
      writeFileSync(secretFile, JSON.stringify(values));
    },
  };
  const open = () => {
    const core = createCore({
      dataDir,
      secrets,
      egress: new RecordingEgressSink(),
    });
    cores.push(core);
    return core;
  };
  const manifest = {
    ...validManifest("extension"),
    id,
    version: "1.0.0",
    dependencies: [],
    permissions: [],
    settingsSchema: {
      type: "object" as const,
      properties: {
        token: {
          type: "string" as const,
          title: "Token",
          description: "Synthetic token",
          "x-secret": true,
        },
      },
    },
  };
  const original = await manifestZip(manifest, [
    { name: "marker.txt", data: "1.0.0" },
  ]);
  const next = await manifestZip({ ...manifest, version: "2.0.0" }, [
    { name: "marker.txt", data: "2.0.0" },
  ]);
  const core = open();
  await core.importPackage(original);
  await core.grantConsent(id);
  await core.enable(id);
  await core.setSettings(id, { token: ref });
  const before = (await core.listInstalled())[0];
  core.close();
  const zip = path.join(root, "update.zip");
  await writeFile(zip, next);
  return { root, dataDir, secretFile, secrets, open, before, zip };
}
async function start(
  f: Awaited<ReturnType<typeof fixture>>,
  operation: string,
  phase: string,
) {
  const barrier = path.join(f.root, `${operation}-${phase}`);
  const config = `${barrier}.json`;
  await writeFile(
    config,
    JSON.stringify({
      dataDir: f.dataDir,
      secrets: f.secretFile,
      zip: f.zip,
      operation,
      phase,
      barrier,
    }),
  );
  const child = spawn(process.execPath, [helper, entry, config], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (value) => {
    output += String(value);
  });
  child.stderr!.on("data", (value) => {
    output += String(value);
  });
  await expect
    .poll(
      () => {
        if (child.exitCode !== null)
          throw Error(`Child exited before ${phase}: ${output}`);
        return existsSync(barrier);
      },
      { timeout: 10000, interval: 10 },
    )
    .toBe(true);
  return { child, barrier };
}
async function kill(child: ChildProcess) {
  const closed = once(child, "close");
  child.kill("SIGKILL");
  await closed;
}
async function compete(
  f: Awaited<ReturnType<typeof fixture>>,
  operation: string,
) {
  const config = path.join(f.root, `compete-${operation}.json`);
  await writeFile(
    config,
    JSON.stringify({
      dataDir: f.dataDir,
      secrets: f.secretFile,
      zip: f.zip,
      operation,
      phase: "",
    }),
  );
  const child = spawn(process.execPath, [helper, entry, config], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  let output = "";
  child.stdout!.on("data", (value) => {
    output += String(value);
  });
  await once(child, "close");
  return JSON.parse(output);
}

describe("public lifecycle crash recovery", () => {
  it("can be killed while rolling back and then resume recovery without deleting restored files", async () => {
    const f = await fixture();
    const updating = await start(f, "update", "new-published");
    await kill(updating.child);
    const recovering = await start(f, "recover", "old-restored");
    await kill(recovering.child);
    const core = f.open();
    expect((await core.listInstalled())[0]?.version).toBe("1.0.0");
    expect(
      await readFile(
        path.join(f.dataDir, "packages", id, "marker.txt"),
        "utf8",
      ),
    ).toBe("1.0.0");
    expect(await readdir(path.join(f.dataDir, "packages"))).toEqual([id]);
  });

  it.each([false, true])(
    "retains references when recovery secret deletion fails (deleted=%s)",
    async (deleted) => {
      const f = await fixture();
      const removing = await start(f, "uninstall", "before-secret");
      await kill(removing.child);
      const original = f.secrets.delete;
      f.secrets.delete = async (key) => {
        if (deleted) await original(key);
        throw Error("FAKE_LIFECYCLE_SECRET");
      };
      const core = f.open();
      const failure = await core.listInstalled().catch((error) => error);
      expect(failure).toMatchObject({
        code: "SECRET_NOT_FOUND",
        details: { id, reason: "SECRET_CLEANUP_FAILED" },
      });
      expect(JSON.stringify(failure)).not.toContain("FAKE_LIFECYCLE_SECRET");
      expect(await core.listSecretReferences()).toContain(ref);
      f.secrets.delete = original;
      await core.uninstall(id);
      expect(await core.listInstalled()).toEqual([]);
      expect(await f.secrets.get(ref)).toBeUndefined();
    },
  );

  it.each([
    "old-moved",
    "new-published",
    "database-committed",
    "before-backup-cleanup",
  ])("recovers an update interrupted at %s, twice", async (phase) => {
    const f = await fixture();
    const { child } = await start(f, "update", phase);
    await kill(child);
    const expected = ["database-committed", "before-backup-cleanup"].includes(
      phase,
    )
      ? "2.0.0"
      : "1.0.0";
    for (let attempt = 0; attempt < 2; attempt++) {
      const core = f.open();
      expect(await core.listInstalled()).toMatchObject([
        {
          version: expected,
          installedAt: f.before?.installedAt,
          enabled: true,
          consented: true,
        },
      ]);
      expect(
        JSON.parse(
          await readFile(
            path.join(f.dataDir, "packages", id, "manifest.json"),
            "utf8",
          ),
        ).version,
      ).toBe(expected);
      expect(
        await readFile(
          path.join(f.dataDir, "packages", id, "marker.txt"),
          "utf8",
        ),
      ).toBe(expected);
      expect((await core.getConsent(id))?.version).toBe(expected);
      expect(await core.resolveSettings(id)).toEqual({
        token: "FAKE_LIFECYCLE_SECRET",
      });
      expect(
        (await readdir(path.join(f.dataDir, "packages"))).filter((name) =>
          name.startsWith("."),
        ),
      ).toEqual([]);
      core.close();
    }
  });
  it.each([
    "before-secret",
    "after-secret",
    "record-removed",
    "during-cleanup",
  ])("finishes an uninstall interrupted at %s, twice", async (phase) => {
    const f = await fixture();
    const { child } = await start(f, "uninstall", phase);
    await kill(child);
    for (let attempt = 0; attempt < 2; attempt++) {
      const core = f.open();
      expect(await core.listInstalled()).toEqual([]);
      expect(existsSync(path.join(f.dataDir, "packages", id))).toBe(false);
      expect(existsSync(path.join(f.dataDir, "data", id))).toBe(false);
      expect(await f.secrets.get(ref)).toBeUndefined();
      expect(await readdir(path.join(f.dataDir, "packages"))).toEqual([]);
      core.close();
    }
  });
  it.each([
    ["update", "update", "old-moved"],
    ["update", "uninstall", "new-published"],
    ["uninstall", "import", "record-removed"],
  ])(
    "rejects cross-process %s/%s, then recovers after owner death",
    async (first, second, phase) => {
      const f = await fixture();
      const { child } = await start(f, first!, phase!);
      expect(await compete(f, second!)).toMatchObject({
        ok: false,
        code: "IMPORT_INVALID",
        details: { reason: "LIFECYCLE_BUSY" },
      });
      await kill(child);
      const core = f.open();
      if (first === "update") {
        expect((await core.listInstalled())[0]?.version).toBe("1.0.0");
        await core.updatePackage(f.zip);
      } else {
        // Direct import must recover an interrupted uninstall before checking residual settings.
        await core.importPackage(f.zip);
      }
      expect((await core.getPackage(id)).installed.version).toBe("2.0.0");
      expect(
        await readFile(
          path.join(f.dataDir, "packages", id, "marker.txt"),
          "utf8",
        ),
      ).toBe("2.0.0");
    },
  );
});
