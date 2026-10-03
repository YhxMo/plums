import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FakeModelProvider, MemorySecretStore, RecordingEgressSink, ScriptedConfirm, VERSION, createCore, type Manifest } from "@plums/core";
import { describe, expect, it } from "vitest";
import { runCli, type CliOptions } from "../src/main.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, "../dist/main.js");
const launcher = path.join(here, "../bin/plums.js");
const bin = path.join(here, "../../../node_modules/.bin/plums");

const EXTENSION: Manifest = {
  formatVersion: "1.0",
  kind: "extension",
  id: "demo-ext",
  name: "Demo extension",
  version: "1.2.3",
  description: "A package used by tests.",
  license: "Apache-2.0",
  dependencies: [],
  permissions: [{ id: "read-notes", level: "read", target: "notes", reason: "Show your notes." }],
  payload: {},
};

const WITH_SETTINGS: Manifest = {
  ...EXTENSION,
  settingsSchema: {
    type: "object",
    required: ["nickname"],
    properties: {
      nickname: { type: "string", title: "Nickname", description: "What to call you." },
    },
  },
};

const ENABLE_YES =
  "message: enable 需要 --yes。这会同意 manifest 声明的全部权限。请先 inspect 查看权限，再带 --yes 启用。\n";

function plantSettings(dir: string, id: string, text: string): string {
  const file = path.join(dir, "data", id, "settings.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

function uninstallPrompt(id: string): string {
  return `要卸载「${id}」。这会删掉它的文件、数据、同意记录、密钥和 MCP 批准。允许吗?\n`;
}

function home(): string {
  return mkdtempSync(path.join(tmpdir(), "plums-cli-"));
}

async function writePackage(dir: string, manifest: Manifest): Promise<string> {
  const file = path.join(dir, `${manifest.id}.zip`);
  const core = createCore({
    dataDir: path.join(dir, "pack"),
    model: new FakeModelProvider(),
    egress: new RecordingEgressSink(),
    confirm: new ScriptedConfirm(),
    secrets: new MemorySecretStore(),
  });
  try {
    await core.exportPackage({ manifest }, { outPath: file });
  } finally {
    core.close();
  }
  return file;
}

function cli(dir: string, args: string[], extra: CliOptions = {}) {
  return runCli(["--home", dir, ...args], extra);
}

describe("plums", () => {
  it("prints the core version from one path", async () => {
    const printed = { exitCode: 0, stdout: `${VERSION}\n`, stderr: "" };
    expect(await runCli([])).toEqual(printed);
    expect(await runCli(["version"])).toEqual(printed);
    expect(await runCli(["--version"])).toEqual(printed);
    expect(await runCli(["-v"])).toEqual(printed);
    const help = await runCli(["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("import <file>");
    expect(help.stdout).toContain("同意 manifest 声明的全部权限");
    expect(help.stdout).not.toContain("share");
  });

  it("rejects unknown commands and options that a command does not accept", async () => {
    const unknown = await runCli(["nope"]);
    expect(unknown.exitCode).toBe(2);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toBe("message: unknown command: nope\n");

    expect((await runCli(["--yes"])).exitCode).toBe(2);
    expect((await runCli(["version", "--yes"])).exitCode).toBe(2);
    expect((await runCli(["--version", "import"])).exitCode).toBe(2);
    expect((await runCli(["--help", "--yes"])).exitCode).toBe(2);

    const unknownShare = { exitCode: 2, stdout: "", stderr: "message: unknown command: share\n" };
    expect(await Promise.all([
      runCli(["share", "import", "https://example.com/a.zip"]),
      runCli(["share", "export", "demo-ext", "--out", "out.zip"]),
    ])).toEqual([unknownShare, unknownShare]);

    const dir = home();
    const file = await writePackage(dir, EXTENSION);
    const ignored = await cli(dir, ["import", file, "--yes"]);
    expect(ignored.exitCode).toBe(2);
    expect(ignored.stderr).toContain("--yes");
    expect(ignored.stdout).toBe("");
  });

  it("runs import, inspect, enable --yes and uninstall --yes on a package built here", async () => {
    const dir = home();
    const file = await writePackage(dir, EXTENSION);

    const imported = await cli(dir, ["import", file]);
    expect(imported.exitCode).toBe(0);
    expect(imported.stderr).toBe("");
    const importedBody = JSON.parse(imported.stdout) as { installDir: string };
    expect(importedBody).toMatchObject({
      id: EXTENSION.id,
      name: EXTENSION.name,
      version: EXTENSION.version,
      kind: EXTENSION.kind,
    });
    expect(importedBody.installDir.startsWith(dir)).toBe(true);

    const inspected = await cli(dir, ["inspect", file]);
    expect(inspected.exitCode).toBe(0);
    expect(JSON.parse(inspected.stdout)).toMatchObject({
      id: EXTENSION.id,
      permissions: EXTENSION.permissions,
    });

    const blocked = await cli(dir, ["enable", EXTENSION.id]);
    expect(blocked).toEqual({ exitCode: 2, stdout: "", stderr: ENABLE_YES });

    const enabled = await cli(dir, ["enable", EXTENSION.id, "--yes"]);
    expect(enabled.exitCode).toBe(0);
    expect(enabled.stderr).toBe("");
    expect(JSON.parse(enabled.stdout)).toMatchObject({
      id: EXTENSION.id,
      enabled: true,
      consented: true,
      permissions: EXTENSION.permissions,
    });

    const removed = await cli(dir, ["uninstall", EXTENSION.id, "--yes"]);
    expect(removed.exitCode).toBe(0);
    expect(removed.stderr).toBe("");
    expect(JSON.parse(removed.stdout)).toEqual({ id: EXTENSION.id, uninstalled: true });

    const gone = await cli(dir, ["enable", EXTENSION.id, "--yes"]);
    expect(gone.exitCode).toBe(1);
    expect(gone.stderr.startsWith("code: PERMISSION_DENIED\n")).toBe(true);
  });

  it("asks before uninstall, then reads the answer", async () => {
    const dir = home();
    const file = await writePackage(dir, EXTENSION);
    expect((await cli(dir, ["import", file])).exitCode).toBe(0);

    const order: string[] = [];
    const denied = await cli(dir, ["uninstall", EXTENSION.id], {
      say(line) {
        order.push(`say:${line}`);
      },
      ask() {
        order.push("ask");
        return false;
      },
    });
    expect(order).toEqual([`say:${uninstallPrompt(EXTENSION.id)}`, "ask"]);
    expect(denied.exitCode).toBe(1);
    expect(denied.stdout).toBe("");
    expect(denied.stderr).toBe("message: 你没有确认，所以没有卸载。\n");

    const still = await cli(dir, ["enable", EXTENSION.id, "--yes"]);
    expect(still.exitCode).toBe(0);
    expect(JSON.parse(still.stdout)).toMatchObject({ enabled: true });

    const refused = spawnSync(process.execPath, [dist, "--home", dir, "uninstall", EXTENSION.id], {
      input: "n\nleftover\n",
      encoding: "utf8",
    });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain("允许吗?");
    expect(refused.stderr).not.toContain("leftover");

    const live = await spawnUninstall(dir, "y\n");
    expect(live.code).toBe(0);
    expect(live.stderr).toBe(uninstallPrompt(EXTENSION.id));
    expect(JSON.parse(live.stdout)).toEqual({ id: EXTENSION.id, uninstalled: true });
  });

  it("refuses uninstall when stdin closes with no answer", async () => {
    const dir = home();
    const file = await writePackage(dir, EXTENSION);
    expect((await cli(dir, ["import", file])).exitCode).toBe(0);

    const closed = await spawnUninstall(dir, undefined);
    expect(closed.code).toBe(1);
    expect(closed.stdout).toBe("");
    expect(closed.stderr).toContain("你没有确认，所以没有卸载。");

    const still = await cli(dir, ["enable", EXTENSION.id, "--yes"]);
    expect(still.exitCode).toBe(0);
  });

  it("reports inspect, import, and uninstall failures", async () => {
    const dir = home();
    const missing = await cli(dir, ["inspect", path.join(dir, "missing.zip")]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr.startsWith("code: IMPORT_INVALID\nmessage: ")).toBe(true);

    const bad = path.join(dir, "not-a-package.txt");
    writeFileSync(bad, "this is not a zip");
    const invalid = await cli(dir, ["inspect", bad]);
    const imported = await cli(dir, ["import", bad]);
    expect(invalid.exitCode).toBe(1);
    expect(imported).toMatchObject({ exitCode: 1, stdout: "" });
    expect(invalid.stderr.startsWith("code: IMPORT_INVALID\nmessage: ")).toBe(true);
    expect(imported.stderr.startsWith("code: IMPORT_INVALID\nmessage: ")).toBe(true);

    const absent = await cli(dir, ["uninstall", "not-installed", "--yes"]);
    expect(absent.exitCode).toBe(1);
    expect(absent.stderr.startsWith("code: PERMISSION_DENIED\nmessage: ")).toBe(true);
  });

  it("returns IMPORT_INVALID when the same package is imported twice", async () => {
    const dir = home();
    const file = await writePackage(dir, EXTENSION);
    expect((await cli(dir, ["import", file])).exitCode).toBe(0);
    const again = await cli(dir, ["import", file]);
    expect(again.exitCode).toBe(1);
    expect(again.stdout).toBe("");
    expect(again.stderr.startsWith("code: IMPORT_INVALID\n")).toBe(true);

    const still = await cli(dir, ["enable", EXTENSION.id, "--yes"]);
    expect(still.exitCode).toBe(0);
    expect(JSON.parse(still.stdout)).toMatchObject({ id: EXTENSION.id, enabled: true });
  });

  it("exports an installed package", async () => {
    const dir = home();
    const file = await writePackage(dir, EXTENSION);
    expect((await cli(dir, ["import", file])).exitCode).toBe(0);
    const out = path.join(dir, "out.zip");
    const exported = await cli(dir, ["export", EXTENSION.id, "--out", out]);
    expect(exported.exitCode).toBe(0);
    expect(exported.stderr).toBe("");
    expect(existsSync(out)).toBe(true);
    expect(JSON.parse(exported.stdout).bytes).toBeGreaterThan(0);
  });

  it("uses PLUMS_HOME when --home is omitted", async () => {
    const dir = home();
    const file = await writePackage(dir, EXTENSION);
    const env = { ...process.env, PLUMS_HOME: dir };
    const imported = await runCli(["import", file], { env });
    expect(imported.exitCode).toBe(0);
    expect(JSON.parse(imported.stdout).installDir.startsWith(dir)).toBe(true);
    const enabled = await runCli(["enable", EXTENSION.id, "--yes"], { env });
    expect(JSON.parse(enabled.stdout)).toMatchObject({ id: EXTENSION.id, enabled: true });
  });

  it("prints IMPORT_INVALID and exits 1 when leftover settings fail the new schema", async () => {
    const dir = home();
    const file = await writePackage(dir, WITH_SETTINGS);
    const settings = plantSettings(dir, WITH_SETTINGS.id, "{\"nickname\":8675309}\n");

    const imported = await cli(dir, ["import", file]);
    expect(imported.exitCode).toBe(1);
    expect(imported.stdout).toBe("");
    expect(imported.stderr.startsWith("code: IMPORT_INVALID\nmessage: ")).toBe(true);
    expect(imported.stderr).toContain("\npath: /settings/nickname\n");
    expect(imported.stderr).not.toContain("8675309");
    expect(readFileSync(settings, "utf8")).toContain("8675309");

    const still = await cli(dir, ["enable", WITH_SETTINGS.id, "--yes"]);
    expect(still.exitCode).toBe(1);
    expect(still.stderr.startsWith("code: PERMISSION_DENIED\n")).toBe(true);
  });

  it("prints IMPORT_INVALID and exits 1 when leftover settings exist and the package has no schema", async () => {
    const dir = home();
    const file = await writePackage(dir, EXTENSION);
    const settings = plantSettings(dir, EXTENSION.id, "{\"nickname\":\"ada\"}\n");

    const imported = await cli(dir, ["import", file]);
    expect(imported.exitCode).toBe(1);
    expect(imported.stdout).toBe("");
    expect(imported.stderr.startsWith("code: IMPORT_INVALID\nmessage: ")).toBe(true);
    expect(imported.stderr).toContain("\npath: /settings\n");
    expect(readFileSync(settings, "utf8")).toContain("ada");

    const still = await cli(dir, ["enable", EXTENSION.id, "--yes"]);
    expect(still.exitCode).toBe(1);
    expect(still.stderr.startsWith("code: PERMISSION_DENIED\n")).toBe(true);
  });

  it("prints the version when the built program is executed", () => {
    const direct = spawnSync(process.execPath, [dist], { encoding: "utf8" });
    expect(direct.status).toBe(0);
    expect(direct.stdout).toBe(`${VERSION}\n`);
    expect(direct.stderr).toBe("");

    const linked = spawnSync(bin, ["--version"], { encoding: "utf8" });
    expect(linked.status).toBe(0);
    expect(linked.stdout).toBe(`${VERSION}\n`);
    expect(linked.stderr).toBe("");

    const viaLauncher = spawnSync(process.execPath, [launcher, "--version"], { encoding: "utf8" });
    expect(viaLauncher.status).toBe(0);
    expect(viaLauncher.stdout).toBe(`${VERSION}\n`);
    expect(viaLauncher.stderr).toBe("");
  });

  it("the launcher asks for a build when dist is missing", () => {
    const source = readFileSync(launcher, "utf8");
    expect(source.startsWith("#!/usr/bin/env node\n")).toBe(true);
    if (process.platform !== "win32") {
      expect(statSync(launcher).mode & 0o111).not.toBe(0);
    }
    const pkg = JSON.parse(readFileSync(path.join(here, "../package.json"), "utf8")) as {
      bin: { plums: string };
      files: string[];
    };
    expect(pkg.bin.plums).toBe("./bin/plums.js");
    expect(pkg.files).toContain("bin");

    const dir = mkdtempSync(path.join(tmpdir(), "plums-bin-"));
    const copied = path.join(dir, "bin", "plums.js");
    mkdirSync(path.dirname(copied), { recursive: true });
    copyFileSync(launcher, copied);
    const missing = spawnSync(process.execPath, [copied, "--version"], { encoding: "utf8" });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr).toContain("pnpm build");
  });
});

/** Sends `answer` only after the prompt is on stderr. `undefined` closes stdin with no bytes. */
function spawnUninstall(dir: string, answer: string | undefined): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, [dist, "--home", dir, "uninstall", EXTENSION.id], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  const out = { stdout: "", stderr: "" };
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    out.stdout += chunk;
  });
  let sent = answer === undefined;
  if (sent) child.stdin.end();
  const timer = setTimeout(() => child.kill(), 10_000);
  child.stderr.on("data", (chunk: string) => {
    out.stderr += chunk;
    if (sent || !out.stderr.includes("允许吗?")) return;
    sent = true;
    clearTimeout(timer);
    child.stdin.write(answer ?? "");
    child.stdin.end();
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!sent) reject(new Error("uninstall prompt was not written before stdin was read"));
      else resolve({ code, stdout: out.stdout, stderr: out.stderr });
    });
  });
}
