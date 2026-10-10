import {
  spawn,
  spawnSync,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MemorySecretStore,
  RecordingEgressSink,
  ScriptedConfirm,
  VERSION,
  createCore,
  type Manifest,
} from "@plumsjs/core";
import { afterEach, describe, expect, it } from "vitest";

/**
 * CLI contract. Each command is the built `plums` bin, and the data directory is a temp directory.
 * Milestone 1 has no share import and no persisted secrets. Those names are unknown commands.
 *
 * 验收对照（命令行）
 * import → inspect → enable --yes → export → uninstall
 * is 「命令行主线走通」 below. export runs while the package is still installed.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const bin = path.join(here, "../dist/main.js");
const fixtures = path.join(here, "../../core/test/fixtures/packages");
const fixture = (rel: string) => path.join(fixtures, rel);

const FAKE = "plums-fake-secret-9f3a7c1e-DO-NOT-USE";
/** Rejected settings values. Distinct from FAKE so a leak check can name this marker alone. */
const MARK = "plums-cli-settings-LEAK-9f3a7c1e";
const EXT = fixture("valid/extension-3-levels.zip");
const SECRET_ZIP = fixture("secret/package-with-fake-secret-in-settings.zip");
const ID = "test.ext.perms";
const PERMS = [
  { id: "p.read", level: "read", target: "memory", reason: "读取记忆" },
  { id: "p.write", level: "write", target: "notes", reason: "写入笔记" },
  {
    id: "p.egress",
    level: "egress",
    target: "example.com",
    reason: "把摘要发给示例网站",
  },
];

const ENABLE_YES =
  "message: enable 需要 --yes。这会同意 manifest 声明的全部权限。请先 inspect 查看权限，再带 --yes 启用。\n";

function uninstallPrompt(id: string): string {
  return `要卸载「${id}」。这会删掉它的文件、数据、同意记录、密钥和 MCP 批准。允许吗?\n`;
}

interface Out {
  status: number | null;
  stdout: string;
  stderr: string;
}

const homes: string[] = [];
afterEach(() => {
  for (const dir of homes.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

function home(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "plums-cli-contract-"));
  homes.push(dir);
  return dir;
}

/** Runs the built bin. `home` is `--home` (the data directory). Nothing printed may contain the fake secret. */
function run(
  args: readonly string[],
  options: { home?: string; input?: string; env?: NodeJS.ProcessEnv } = {},
): Out {
  const argv = [bin];
  if (options.home !== undefined) argv.push("--home", options.home);
  argv.push(...args);
  const result = spawnSync(process.execPath, argv, {
    encoding: "utf8",
    input: options.input,
    env: options.env ?? process.env,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  expect(`${stdout}${stderr}${result.error?.message ?? ""}`).not.toContain(
    FAKE,
  );
  return { status: result.status, stdout, stderr };
}

function onlyJson(stdout: string): Record<string, unknown> {
  const value = JSON.parse(stdout) as Record<string, unknown>;
  expect(stdout).toBe(`${JSON.stringify(value, null, 2)}\n`);
  expect(stdout).not.toContain("允许吗");
  return value;
}

async function listInstalled(
  dataDir: string,
): Promise<{ id: string; enabled: boolean; consented: boolean }[]> {
  const core = createCore({
    dataDir,
    egress: new RecordingEgressSink(),
    confirm: new ScriptedConfirm(),
    secrets: new MemorySecretStore(),
  });
  try {
    return await core.listInstalled();
  } finally {
    core.close();
  }
}

describe("plums CLI", () => {
  it("prints the core version, and --help is usage text on stdout", () => {
    const version = `${VERSION}\n`;
    for (const args of [[], ["version"], ["--version"], ["-v"]]) {
      expect(run(args)).toEqual({ status: 0, stdout: version, stderr: "" });
    }
    const help = run(["--help"]);
    expect(help.status).toBe(0);
    expect(help.stderr).toBe("");
    expect(help.stdout).toContain("import <file>");
    expect(help.stdout).toContain("inspect <file>");
    expect(help.stdout).toContain("enable <id> --yes");
    expect(help.stdout).toContain("uninstall <id>");
    expect(help.stdout).toContain("export <id> --out <file>");
    expect(help.stdout).toContain("同意 manifest 声明的全部权限");
    expect(help.stdout).not.toContain("share");
  });

  it("unknown commands, including share import, share export and secret, exit 2", () => {
    const cases = [
      ["nope"],
      ["share", "import", "https://share.example/pkg.zip"],
      ["share", "export", ID, "--out", "out.zip"],
      ["secret"],
      ["secrets", "set", ID, "apiKey", FAKE],
    ];
    for (const args of cases) {
      const result = run(args, { home: home() });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr).toBe(`message: unknown command: ${args[0]}\n`);
    }
  });

  it("usage mistakes exit 2 and leave stdout empty", () => {
    const dir = home();
    const withHome: readonly (readonly string[])[] = [
      [],
      ["import"],
      ["import", EXT, "extra.zip"],
      ["inspect"],
      ["enable"],
      ["uninstall"],
      ["export", ID],
      ["export", ID, "--out", " "],
      ["import", EXT, "--yes"],
      ["--not-a-flag"],
    ];
    for (const args of withHome) {
      const result = run(args, { home: dir });
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
      expect(result.stderr.startsWith("message: ")).toBe(true);
    }
    for (const args of [
      ["version", "--yes"],
      ["--help", "--yes"],
      ["--version", "import"],
    ]) {
      const result = run(args);
      expect(result.status).toBe(2);
      expect(result.stdout).toBe("");
    }
  });

  it("命令行主线走通: import, inspect, enable --yes, export, then uninstall", async () => {
    const dir = home();

    const inspected = run(["inspect", EXT], { home: dir });
    expect(inspected.status).toBe(0);
    expect(inspected.stderr).toBe("");
    expect(onlyJson(inspected.stdout)).toMatchObject({
      id: ID,
      permissions: PERMS,
    });
    expect(await listInstalled(dir)).toEqual([]);

    const imported = run(["import", EXT], { home: dir });
    expect(imported.status).toBe(0);
    expect(imported.stderr).toBe("");
    expect(onlyJson(imported.stdout)).toEqual({
      id: ID,
      name: ID,
      version: "1.0.0",
      kind: "extension",
      description: "test extension",
      installDir: path.join(dir, "packages", ID),
    });
    expect(await listInstalled(dir)).toMatchObject([
      { id: ID, enabled: false, consented: false },
    ]);

    const blocked = run(["enable", ID], { home: dir });
    expect(blocked).toEqual({ status: 2, stdout: "", stderr: ENABLE_YES });
    expect(await listInstalled(dir)).toMatchObject([
      { id: ID, enabled: false, consented: false },
    ]);

    const enabled = run(["enable", ID, "--yes"], { home: dir });
    expect(enabled.status).toBe(0);
    expect(enabled.stderr).toBe("");
    const enabledBody = onlyJson(enabled.stdout);
    expect(enabledBody).toMatchObject({
      id: ID,
      enabled: true,
      consented: true,
    });
    expect(enabledBody.permissions).toEqual(PERMS);

    const out = path.join(dir, "shared.zip");
    const exported = run(["export", ID, "--out", out], { home: dir });
    expect(exported.status).toBe(0);
    expect(exported.stderr).toBe("");
    expect(onlyJson(exported.stdout)).toEqual({
      id: ID,
      path: out,
      bytes: statSync(out).size,
    });

    const again = home();
    const reimported = run(["import", out], { home: again });
    expect(reimported.status).toBe(0);
    expect(onlyJson(reimported.stdout)).toMatchObject({
      id: ID,
      installDir: path.join(again, "packages", ID),
    });
    const reinspected = run(["inspect", out], { home: again });
    expect(onlyJson(reinspected.stdout)).toMatchObject({
      id: ID,
      permissions: PERMS,
    });

    const removed = run(["uninstall", ID, "--yes"], { home: dir });
    expect(removed.status).toBe(0);
    expect(removed.stderr).toBe("");
    expect(onlyJson(removed.stdout)).toEqual({ id: ID, uninstalled: true });
    expect(await listInstalled(dir)).toEqual([]);

    const gone = run(["export", ID, "--out", path.join(dir, "again.zip")], {
      home: dir,
    });
    expect(gone.status).toBe(1);
    expect(gone.stdout).toBe("");
    expect(gone.stderr.startsWith("code: PERMISSION_DENIED\n")).toBe(true);
  });

  it("PLUMS_HOME is the data directory when --home is omitted", async () => {
    const dir = home();
    const imported = run(["import", EXT], {
      env: { ...process.env, PLUMS_HOME: dir },
    });
    expect(imported.status).toBe(0);
    expect(onlyJson(imported.stdout).installDir).toBe(
      path.join(dir, "packages", ID),
    );
    expect(await listInstalled(dir)).toMatchObject([
      { id: ID, enabled: false },
    ]);
  });

  it("writes the uninstall prompt to stderr before reading stdin; y agrees, and no input is refused", async () => {
    const dir = home();
    expect(run(["import", EXT], { home: dir }).status).toBe(0);

    const refused = run(["uninstall", ID], { home: dir, input: "" });
    expect(refused.status).toBe(1);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toBe(
      `${uninstallPrompt(ID)}message: 你没有确认，所以没有卸载。\n`,
    );
    expect(await listInstalled(dir)).toMatchObject([
      { id: ID, enabled: false },
    ]);

    const declined = run(["uninstall", ID], { home: dir, input: "n\n" });
    expect(declined.status).toBe(1);
    expect(declined.stdout).toBe("");
    expect(declined.stderr).toContain("允许吗?");
    expect(await listInstalled(dir)).toHaveLength(1);

    const live = await uninstallAfterPrompt(dir, "y\n");
    expect(live.status).toBe(0);
    expect(live.stderr).toBe(uninstallPrompt(ID));
    expect(onlyJson(live.stdout)).toEqual({ id: ID, uninstalled: true });
    expect(live.stdout).not.toContain("允许吗");
    expect(await listInstalled(dir)).toEqual([]);
  });

  it("importing the same package twice is exit 1 IMPORT_INVALID / ALREADY_INSTALLED", async () => {
    const dir = home();
    const first = run(["import", EXT], { home: dir });
    expect(first.status).toBe(0);
    const again = run(["import", EXT], { home: dir });
    expect(again.status).toBe(1);
    expect(again.stdout).toBe("");
    expect(again.stderr.startsWith("code: IMPORT_INVALID\n")).toBe(true);
    expect(await listInstalled(dir)).toMatchObject([
      { id: ID, enabled: false, consented: false },
    ]);
  });

  it("inspect failure and uninstall of a missing id are errors with no JSON stdout", () => {
    const dir = home();

    const missing = run(["inspect", path.join(dir, "missing.zip")], {
      home: dir,
    });
    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe("");
    expect(missing.stderr.startsWith("code: IMPORT_INVALID\nmessage: ")).toBe(
      true,
    );

    const notZip = run(["inspect", fixture("invalid/not-a-zip.zip")], {
      home: dir,
    });
    expect(notZip.status).toBe(1);
    expect(notZip.stdout).toBe("");
    expect(notZip.stderr.startsWith("code: IMPORT_INVALID\nmessage: ")).toBe(
      true,
    );

    const badName = run(["inspect", fixture("invalid/missing-name.zip")], {
      home: dir,
    });
    expect(badName.status).toBe(1);
    expect(badName.stdout).toBe("");
    expect(badName.stderr).toContain("code: MANIFEST_INVALID\n");
    expect(badName.stderr).toContain("path: /name\n");

    const absent = run(["uninstall", "not.installed", "--yes"], { home: dir });
    expect(absent.status).toBe(1);
    expect(absent.stdout).toBe("");
    expect(absent.stderr.startsWith("code: PERMISSION_DENIED\nmessage: ")).toBe(
      true,
    );
  });

  it("a package that contains the fake secret does not print it on stdout or stderr", async () => {
    const core = createCore({
      dataDir: home(),
      egress: new RecordingEgressSink(),
      confirm: new ScriptedConfirm(),
      secrets: new MemorySecretStore(),
    });
    try {
      const validated = await core.validatePackage(readFileSync(SECRET_ZIP));
      expect(JSON.stringify(validated.manifest.payload)).toContain(FAKE);
    } finally {
      core.close();
    }
    const dir = home();
    const body = path.join(dir, "not-a-zip.txt");
    writeFileSync(body, FAKE);

    const imported = run(["import", SECRET_ZIP], { home: dir });
    expect(imported.status).toBe(0);
    expect(imported.stderr).toBe("");
    expect(onlyJson(imported.stdout)).toMatchObject({
      id: "test.ext.secret",
      description: "test extension",
    });

    const inspected = run(["inspect", SECRET_ZIP], { home: dir });
    expect(inspected.status).toBe(0);
    expect(inspected.stderr).toBe("");
    expect(onlyJson(inspected.stdout)).toMatchObject({
      id: "test.ext.secret",
      permissions: [],
    });

    const enabled = run(["enable", "test.ext.secret", "--yes"], { home: dir });
    expect(enabled.status).toBe(0);
    expect(enabled.stderr).toBe("");
    onlyJson(enabled.stdout);

    const out = path.join(dir, "out.zip");
    const exported = run(["export", "test.ext.secret", "--out", out], {
      home: dir,
    });
    expect(exported.status).toBe(0);
    expect(onlyJson(exported.stdout)).toEqual({
      id: "test.ext.secret",
      path: out,
      bytes: statSync(out).size,
    });

    const broken = run(["inspect", body], { home: dir });
    expect(broken.status).toBe(1);
    expect(broken.stdout).toBe("");
    expect(broken.stderr.startsWith("code: IMPORT_INVALID\n")).toBe(true);

    const removed = run(["uninstall", "test.ext.secret"], {
      home: dir,
      input: `y\n${FAKE}\n`,
    });
    expect(removed.status).toBe(0);
    expect(onlyJson(removed.stdout)).toEqual({
      id: "test.ext.secret",
      uninstalled: true,
    });
    expect(removed.stderr).toBe(uninstallPrompt("test.ext.secret"));
  });
});

/**
 * `plums import` is the only command that judges a leftover settings file.
 * There is no update command and no setSettings command, so a subprocess cannot
 * reach SETTINGS_INVALID or an update that drops settingsSchema. Those paths
 * are the in-process cases in cli.test.ts and settings-validation.test.ts.
 * stderr prints code, message, and path. It does not print details.reason.
 */
describe("plums import rejects leftover settings.json", () => {
  const id = "test.cli.settings";
  const nickname: Manifest["settingsSchema"] = {
    type: "object",
    required: ["nickname"],
    properties: {
      nickname: {
        type: "string",
        title: "Nickname",
        description: "What to call you.",
      },
    },
  };
  const retries: Manifest["settingsSchema"] = {
    type: "object",
    properties: {
      retries: {
        type: "integer",
        title: "Retries",
        description: "How many times to retry.",
        minimum: 1,
        maximum: 3,
      },
    },
  };

  const cases: [
    string,
    Manifest["settingsSchema"] | undefined,
    string,
    string,
  ][] = [
    ["a missing required field", nickname, "{}", "/settings/nickname"],
    [
      "a value of the wrong type",
      retries,
      `{"retries":"${MARK}-TYPE"}`,
      "/settings/retries",
    ],
    [
      "a value above maximum",
      retries,
      `{"retries":4242424242}`,
      "/settings/retries",
    ],
    [
      "a package with no settingsSchema",
      undefined,
      `{"nickname":"${MARK}-NOSCHEMA"}`,
      "/settings",
    ],
    [
      "text that is not JSON",
      nickname,
      `{"nickname":"${MARK}-NOTJSON"`,
      "/settings",
    ],
    ["a JSON array", nickname, `["${MARK}-ARRAY"]`, "/settings"],
  ];

  it.each(cases)(
    "%s is exit 1 IMPORT_INVALID and leaves the file",
    async (_name, schema, text, at) => {
      const dir = home();
      const manifest: Manifest = {
        formatVersion: "1.0",
        kind: "extension",
        id,
        name: id,
        version: "1.0.0",
        description: "settings contract",
        dependencies: [],
        permissions: [],
        payload: { text: "hello" },
      };
      if (schema !== undefined) manifest.settingsSchema = schema;
      const zip = await writePackage(dir, manifest);
      const file = plantSettings(dir, id, text);

      const imported = run(["import", zip], { home: dir });
      expect(imported.status).toBe(1);
      expect(imported.stdout).toBe("");
      expect(
        imported.stderr.startsWith("code: IMPORT_INVALID\nmessage: "),
      ).toBe(true);
      expect(imported.stderr).toContain(`\npath: ${at}\n`);
      expect(imported.stderr).not.toContain(MARK);
      expect(imported.stderr).not.toContain("4242424242");
      expect(readFileSync(file, "utf8")).toBe(text);
      expect(existsSync(path.join(dir, "packages", id))).toBe(false);
      expect(await listInstalled(dir)).toEqual([]);

      const still = run(["enable", id, "--yes"], { home: dir });
      expect(still.status).toBe(1);
      expect(still.stdout).toBe("");
      expect(still.stderr.startsWith("code: PERMISSION_DENIED\n")).toBe(true);
    },
  );
});

async function writePackage(dir: string, manifest: Manifest): Promise<string> {
  const file = path.join(dir, `${manifest.id}.zip`);
  const core = createCore({
    dataDir: path.join(dir, "pack"),
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

function plantSettings(dir: string, id: string, text: string): string {
  const file = path.join(dir, "data", id, "settings.json");
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return file;
}

/**
 * Writes `answer` only after the prompt is already on stderr.
 * spawnSync would place `y` in the pipe before we could see that order.
 */
function uninstallAfterPrompt(dir: string, answer: string): Promise<Out> {
  const child = spawn(process.execPath, [bin, "--home", dir, "uninstall", ID], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  return collect(child, answer);
}

function collect(
  child: ChildProcessWithoutNullStreams,
  answer: string,
): Promise<Out> {
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const closed = new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });
  return new Promise((resolve, reject) => {
    let settled = false;
    // Same 10s kill as the CLI child. Vitest's testTimeout is 20s, so this fires first.
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error("uninstall prompt was not written before stdin was read"),
      );
    }, 10_000);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const check = () => {
      if (settled || !stderr.includes("允许吗?")) return;
      child.stderr.off("data", check);
      child.stdin.write(answer);
      child.stdin.end();
    };
    child.stderr.on("data", check);
    closed.then(
      (status) => {
        finish(() => {
          expect(`${stdout}${stderr}`).not.toContain(FAKE);
          resolve({ status, stdout, stderr });
        });
      },
      (err: unknown) =>
        finish(() =>
          reject(err instanceof Error ? err : new Error(String(err))),
        ),
    );
  });
}
