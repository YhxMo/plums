#!/usr/bin/env node
import { readSync, realpathSync, writeSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  MemorySecretStore,
  PlumsError,
  RecordingEgressSink,
  VERSION,
  createCore,
  type Core,
  type ImportedPackage,
} from "@plums/core";

export interface CliResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** One confirmation answer. The executable reads stdin; tests pass a function. */
export type Ask = () => boolean | Promise<boolean>;

/**
 * Synchronous notice for a confirmation prompt.
 * Called before `ask`, so the prompt is visible before stdin is read.
 */
export type Say = (line: string) => void;

export interface CliOptions {
  /** Defaults to `process.env`. `--home` wins over `PLUMS_HOME`. */
  env?: NodeJS.ProcessEnv;
  ask?: Ask;
  say?: Say;
}

interface Flags {
  home?: string;
  yes?: boolean;
  out?: string;
  help?: boolean;
  version?: boolean;
}

type Plan =
  | { kind: "import"; file: string }
  | { kind: "inspect"; file: string }
  | { kind: "enable"; id: string }
  | { kind: "uninstall"; id: string; yes: boolean }
  | { kind: "export"; id: string; out: string };

const USAGE = `plums [--home <目录>] <命令>

  version
  import <file>
  inspect <file>
  enable <id> --yes
  uninstall <id> [--yes]
  export <id> --out <file>

--home 或环境变量 PLUMS_HOME，默认是用户目录下的 .plums。
enable 必须带 --yes。这会同意 manifest 声明的全部权限，输出里列出这些权限。请先 inspect 查看。
uninstall 没有 --yes 时要确认。确认文案在标准错误，读回答之前就写出来。管道里的 y 算同意，不要求 TTY。
密钥只在内存里，进程结束就没了。没有真实外发。
成功：JSON 在标准输出，退出码 0。
内核错误：标准错误打印 code、message、path（没有 path 就省略），退出码 1。
不接受的命令或选项：退出码 2。
`;

class CliExit extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = "CliExit";
  }
}

function usage(message: string): never {
  throw new CliExit(message, 2);
}

function stop(message: string): never {
  throw new CliExit(message, 1);
}

/**
 * Runs one invocation and returns the output. Does not exit the process.
 * Egress is `RecordingEgressSink`. This milestone does not download or open a socket.
 */
export async function runCli(args: readonly string[], options: CliOptions = {}): Promise<CliResult> {
  try {
    return await dispatch(args, options);
  } catch (err) {
    return fail(err);
  }
}

async function dispatch(args: readonly string[], options: CliOptions): Promise<CliResult> {
  const parsed = parse(args);
  const flags = parsed.values;
  const positionals = parsed.positionals;

  if (flags.help === true) {
    rejectUnused("--help", flags, []);
    if (positionals.length > 0 || flags.version === true) usage("--help 不接受其他参数");
    return ok(USAGE);
  }
  if (wantsVersion(flags, positionals)) {
    if ((flags.version === true && positionals.length > 0) || positionals.length > 1) usage("version 不接受其他参数");
    rejectUnused("version", flags, []);
    return ok(`${VERSION}\n`);
  }

  const [command, ...rest] = positionals;
  if (command === undefined) usage("missing command");
  const plan = planCommand(command, rest, flags);

  if (plan.kind === "uninstall" && !plan.yes) {
    // Why name secrets and MCP approvals: uninstall deletes them too, and this line does not look up their names.
    const agreedTo = await agreed(
      options,
      `要卸载「${plan.id}」。这会删掉它的文件、数据、同意记录、密钥和 MCP 批准。允许吗?`,
    );
    if (!agreedTo) stop("你没有确认，所以没有卸载。");
  }

  const core = openCore(resolveHome(flags.home, options.env ?? process.env));
  try {
    const value = await run(core, plan);
    return { exitCode: 0, stdout: json(value), stderr: "" };
  } finally {
    core.close();
  }
}

function parse(args: readonly string[]): { values: Flags; positionals: string[] } {
  try {
    const parsed = parseArgs({
      args: [...args],
      allowPositionals: true,
      strict: true,
      options: {
        home: { type: "string" },
        yes: { type: "boolean" },
        out: { type: "string" },
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
      },
    });
    return { values: parsed.values, positionals: parsed.positionals };
  } catch (err) {
    usage(err instanceof Error ? err.message : String(err));
  }
}

function wantsVersion(flags: Flags, positionals: string[]): boolean {
  const named = flags.version === true || positionals[0] === "version";
  const bare = positionals.length === 0 && flags.yes !== true && flags.home === undefined && flags.out === undefined;
  return named || bare;
}

function planCommand(command: string, rest: string[], flags: Flags): Plan {
  switch (command) {
    case "import":
      rejectUnused("import", flags, ["home"]);
      return { kind: "import", file: one(rest, "import 需要一个包文件") };
    case "inspect":
      rejectUnused("inspect", flags, ["home"]);
      return { kind: "inspect", file: one(rest, "inspect 需要一个包文件") };
    case "enable": {
      rejectUnused("enable", flags, ["home", "yes"]);
      const id = one(rest, "enable 需要一个包 id");
      // The installed permission list is not readable before grantConsent, so a prompt would be a blind yes.
      if (flags.yes !== true) usage("enable 需要 --yes。这会同意 manifest 声明的全部权限。请先 inspect 查看权限，再带 --yes 启用。");
      return { kind: "enable", id };
    }
    case "uninstall":
      rejectUnused("uninstall", flags, ["home", "yes"]);
      return { kind: "uninstall", id: one(rest, "uninstall 需要一个包 id"), yes: flags.yes === true };
    case "export":
      rejectUnused("export", flags, ["home", "out"]);
      return {
        kind: "export",
        id: one(rest, "export 需要一个包 id"),
        out: required(flags.out, "export 需要 --out <file>"),
      };
    default:
      usage(`unknown command: ${command}`);
  }
}

async function run(core: Core, plan: Plan): Promise<unknown> {
  switch (plan.kind) {
    case "import":
      return imported(await core.importPackage(plan.file));
    case "inspect":
      return core.inspect(plan.file);
    case "enable": {
      const prior = await core.getConsent(plan.id);
      const consent = prior ?? (await core.grantConsent(plan.id));
      const installed = await core.enable(plan.id);
      return { ...installed, permissions: consent.permissions };
    }
    case "uninstall":
      await core.uninstall(plan.id);
      return { id: plan.id, uninstalled: true };
    case "export": {
      const bytes = await core.shareToFile(plan.id, plan.out);
      return { id: plan.id, path: plan.out, bytes: bytes.byteLength };
    }
  }
}

function imported(pkg: ImportedPackage) {
  const { id, name, version, kind, description } = pkg.manifest;
  return { id, name, version, kind, description, installDir: pkg.installDir };
}

function openCore(dataDir: string): Core {
  return createCore({
    dataDir,
    // The kernel exports no real sink. This one never opens a socket.
    egress: new RecordingEgressSink(),
    secrets: new MemorySecretStore(),
  });
}

async function agreed(options: CliOptions, message: string): Promise<boolean> {
  // say writes before ask. The returned stderr is only the error, so a terminal is not waiting in silence.
  options.say?.(`${message}\n`);
  if (options.ask === undefined) return false;
  return (await options.ask()) === true;
}

function rejectUnused(command: string, flags: Flags, allowed: readonly string[]): void {
  const bad: string[] = [];
  if (flags.home !== undefined && !allowed.includes("home")) bad.push("--home");
  if (flags.yes === true && !allowed.includes("yes")) bad.push("--yes");
  if (flags.out !== undefined && !allowed.includes("out")) bad.push("--out");
  if (bad.length > 0) usage(`${command} 不接受 ${bad.join(" ")}`);
}

function one(rest: string[], message: string): string {
  if (rest.length !== 1 || rest[0]?.trim() === "") usage(message);
  return rest[0] ?? "";
}

function required(value: string | undefined, message: string): string {
  if (value === undefined || value.trim() === "") usage(message);
  return value;
}

function resolveHome(flag: string | undefined, env: NodeJS.ProcessEnv): string {
  const chosen = flag?.trim() || env.PLUMS_HOME?.trim();
  if (chosen !== undefined && chosen !== "") return path.resolve(chosen);
  return path.join(homedir(), ".plums");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function ok(stdout: string): CliResult {
  return { exitCode: 0, stdout, stderr: "" };
}

function fail(err: unknown): CliResult {
  if (err instanceof CliExit) {
    return { exitCode: err.exitCode, stdout: "", stderr: `message: ${err.message}\n` };
  }
  if (err instanceof PlumsError) {
    const lines = [`code: ${err.code}`, `message: ${err.message}`];
    if (err.path !== undefined) lines.push(`path: ${err.path}`);
    return { exitCode: 1, stdout: "", stderr: `${lines.join("\n")}\n` };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { exitCode: 1, stdout: "", stderr: `message: ${message}\n` };
}

function accepted(line: string | undefined): boolean {
  const answer = (line ?? "").trim().toLowerCase();
  return answer === "y" || answer === "yes" || answer === "允许";
}

/** One question per process. EOF and a read error are a refusal. A piped `y` still counts. */
function stdinAsk(): Ask {
  return () => {
    const buf = Buffer.alloc(1024);
    let text = "";
    try {
      while (!text.includes("\n")) {
        const n = readSync(0, buf, 0, buf.length, null);
        if (n === 0) break;
        text += buf.toString("utf8", 0, n);
      }
    } catch {
      return false;
    }
    const line = text.split("\n", 1)[0]?.replace(/\r$/, "");
    return accepted(text === "" ? undefined : line);
  };
}

const entry = process.argv[1];
if (entry !== undefined && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  runCli(process.argv.slice(2), {
    ask: stdinAsk(),
    say(line) {
      // Synchronous write to fd 2, so the prompt is visible before readSync blocks.
      writeSync(2, line);
    },
  }).then((result) => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  });
}
