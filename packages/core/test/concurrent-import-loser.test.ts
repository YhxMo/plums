import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { InstallStore } from "../src/install/store.js";
import { makeCore, manifestZip, validManifest } from "./package-helpers.js";

// Why dist: the child is another Node process, so it does not use Vitest's source
// alias and it does not share this process's importQueue.
const coreEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const childEntry = fileURLToPath(new URL("./concurrent-import-child.mjs", import.meta.url));
const id = "concurrent.loser";

interface ChildReport {
  slot?: string;
  ok: boolean;
  init?: boolean;
  name?: string | null;
  code?: string | null;
  message?: string | null;
  path?: string | null;
  details?: unknown;
}

function runChild(env: NodeJS.ProcessEnv): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [childEntry, coreEntry], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseReport(stdout: string, stderr: string): ChildReport {
  try {
    return JSON.parse(stdout) as ChildReport;
  } catch {
    throw new Error(`child did not return JSON\nstdout: ${stdout}\nstderr: ${stderr}`);
  }
}

describe("concurrent import of one id from two processes", () => {
  it("lets one install win and keeps the loser's hands off that directory", async () => {
    expect(existsSync(coreEntry), coreEntry).toBe(true);
    const root = await mkdtemp(path.join(tmpdir(), "plums-concurrent-loser-"));
    const bodyA = "content-a";
    const bodyB = "content-b";
    const zipFor = (marker: string, body: string) =>
      manifestZip(
        {
          ...validManifest("extension"),
          id,
          name: marker,
          version: "1.0.0",
          description: marker,
          dependencies: [],
          permissions: [],
          payload: { marker },
        },
        [{ name: "marker.txt", data: body }],
      );
    const zipA = path.join(root, "a.zip");
    const zipB = path.join(root, "b.zip");
    await writeFile(zipA, await zipFor("content-a", bodyA));
    await writeFile(zipB, await zipFor("content-b", bodyB));

    const dataDir = path.join(root, "data");
    const barrier = path.join(root, "barrier");
    await mkdir(dataDir, { recursive: true });
    await mkdir(barrier, { recursive: true });
    // Why init first: creating the schema is not the import race. A fresh database
    // can throw "table already exists" before either insert, which hides the loser.
    const init = await runChild({ ...process.env, DATA_DIR: dataDir, INIT_ONLY: "1" });
    expect(parseReport(init.stdout, init.stderr), init.stderr).toEqual({ ok: true, init: true });

    // Why two processes and Promise.all: each process has its own importQueue, so the
    // in-process queue cannot serialize them. The child waits in recordInstall until
    // both have arrived, so one cannot finish the insert before the other gets there.
    const [procA, procB] = await Promise.all([
      runChild({ ...process.env, DATA_DIR: dataDir, SLOT: "a", BARRIER: barrier, ZIP_PATH: zipA }),
      runChild({ ...process.env, DATA_DIR: dataDir, SLOT: "b", BARRIER: barrier, ZIP_PATH: zipB }),
    ]);
    const reportA = parseReport(procA.stdout, procA.stderr);
    const reportB = parseReport(procB.stdout, procB.stderr);
    const ok = [reportA, reportB].filter((report) => report.ok);
    const lost = [reportA, reportB].filter((report) => !report.ok);
    const dump = JSON.stringify({ procA, procB, reportA, reportB }, null, 2);
    expect(ok, dump).toHaveLength(1);
    expect(lost, dump).toHaveLength(1);
    const winner = ok[0]!.slot;
    const loser = lost[0]!;
    expect(winner, dump).toMatch(/^[ab]$/);
    const winnerBody = winner === "a" ? bodyA : bodyB;
    const winnerName = winner === "a" ? "content-a" : "content-b";
    const loserName = winner === "a" ? "content-b" : "content-a";

    const database = new Database(path.join(dataDir, "plums.db"), { readonly: true, fileMustExist: true });
    let rows: { id: string; name: string; manifest: string }[];
    try {
      rows = database.prepare("SELECT id, name, manifest FROM packages").all() as {
        id: string;
        name: string;
        manifest: string;
      }[];
    } finally {
      database.close();
    }
    const installDir = path.join(dataDir, "packages", id);
    const packages = existsSync(path.join(dataDir, "packages")) ? readdirSync(path.join(dataDir, "packages")) : [];
    const markerOnDisk = existsSync(path.join(installDir, "marker.txt"))
      ? readFileSync(path.join(installDir, "marker.txt"), "utf8")
      : null;
    const state = JSON.stringify(
      {
        rows,
        packages,
        marker: markerOnDisk === null ? null : { length: markerOnDisk.length, head: markerOnDisk.slice(0, 24) },
        reportA,
        reportB,
      },
      null,
      2,
    );

    expect(loser.name, state).toBe("PlumsError");
    expect(loser.code, state).toBe("IMPORT_INVALID");
    expect(loser.path, state).toBeNull();
    expect(loser.details, state).toEqual({ id, reason: "ALREADY_INSTALLED" });
    expect(loser.message, state).toBe(`「${loserName}」已经安装了。要换版本请更新它，不要再次导入。`);
    const leaked = `${loser.message}\n${loser.code}\n${String(loser.path)}\n${JSON.stringify(loser.details)}`;
    expect(leaked, state).not.toContain("SQLITE");
    expect(leaked, state).not.toContain("UNIQUE constraint");
    expect(leaked, state).not.toContain("ENOTEMPTY");
    expect(leaked, state).not.toContain(dataDir);

    expect(rows, state).toHaveLength(1);
    expect(rows[0], state).toMatchObject({ id, name: winnerName });
    expect(JSON.parse(rows[0]!.manifest).payload, state).toEqual({ marker: winnerName });

    expect(existsSync(installDir), state).toBe(true);
    expect(markerOnDisk, state).toBe(winnerBody);
    expect(JSON.parse(readFileSync(path.join(installDir, "manifest.json"), "utf8")).name, state).toBe(winnerName);
    expect(
      packages.filter((name) => name.startsWith(".staging-")),
      state,
    ).toEqual([]);
  });
});

describe("publish failure after the install row", () => {
  it("removes the row when the staged directory cannot be moved into place", async () => {
    const { core, dataDir } = makeCore();
    const original = InstallStore.prototype.recordInstall;
    // Why delete staging after the insert: the next step renames it onto packages/<id>,
    // so a missing staging directory fails that rename and must roll the row back.
    InstallStore.prototype.recordInstall = function (manifest) {
      original.call(this, manifest);
      const root = path.join(dataDir, "packages");
      for (const name of readdirSync(root)) {
        if (name.startsWith(".staging-")) rmSync(path.join(root, name), { recursive: true, force: true });
      }
    };
    try {
      const zip = await manifestZip({
        ...validManifest("extension"),
        id: "publish.fail",
        dependencies: [],
        permissions: [],
      });
      await expect(core.importPackage(zip)).rejects.toThrow();
      expect(await core.listInstalled()).toEqual([]);
      const packages = existsSync(path.join(dataDir, "packages")) ? readdirSync(path.join(dataDir, "packages")) : [];
      expect(packages.filter((name) => name === "publish.fail" || name.startsWith(".staging-"))).toEqual([]);
    } finally {
      InstallStore.prototype.recordInstall = original;
      core.close();
    }
  });
});
