import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:net";
import { createSocket } from "node:dgram";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PlumsError } from "@plumsjs/core";
import { projectProfile } from "./project-profile.js";

const allowed = [
  "readProject",
  "writeProject",
  "writeHome",
  "writeTemporary",
  "writeCache",
  "readSnapshot",
  "fork",
  "shell",
];
const denied = [
  "readOutside",
  "writeOutside",
  "writeDotDot",
  "writeSymlink",
  "renameOut",
  "renameIn",
  "readPrivate",
  "readSibling",
  "readSsh",
  "readKeychain",
  "readNpm",
  "readGit",
  "readCargo",
  "writeToolchain",
  "writeSnapshot",
  "tcp",
  "udp",
  "unixSocket",
  "signalHost",
  "setsid",
  "spawnNewGroup",
  "nestedSandbox",
  "inheritedDescriptors",
  "inheritedEnvironment",
  "readHardlink",
  "writeHardlink",
  "readLateHardlink",
  "writeLateHardlink",
];
export interface ProjectBoundaryReport {
  reportVersion: "1.0";
  status: "passed" | "failed" | "skipped";
  /** All path, inode and process checks must pass before runtime integration can be enabled. */
  ready: false;
  reason: string;
  platform: string;
  arch: string;
  checks: readonly Readonly<{ id: string; status: "passed" | "failed" }>[];
  /** Observed runtime aliases added by a non-descendant; never described as inode isolation. */
  knownRisks: readonly Readonly<{ id: string; status: "passed" | "failed" }>[];
  profileDigest?: string;
  probeDigest?: string;
  cleanupCompleted: boolean;
}
const failure = () =>
  new PlumsError({
    code: "TIER_UNAVAILABLE",
    message: "项目档位的系统沙箱尚未就绪。",
  });
const digest = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const frozen = (r: ProjectBoundaryReport): ProjectBoundaryReport =>
  Object.freeze({
    ...r,
    checks: Object.freeze(r.checks.map((c) => Object.freeze({ ...c }))),
    knownRisks: Object.freeze(r.knownRisks.map((c) => Object.freeze({ ...c }))),
  });
const checkRuntime = async (configured: string): Promise<string> => {
  const node = await realpath(configured);
  const options = {
    env: {},
    encoding: "utf8" as const,
    timeout: 2000,
    maxBuffer: 64 * 1024,
  };
  const version = spawnSync(node, ["--version"], options);
  const dependencies = spawnSync("/usr/bin/otool", ["-L", node], options);
  if (
    version.status !== 0 ||
    version.stdout.trim() !== "v26.5.1" ||
    dependencies.status !== 0 ||
    dependencies.stdout
      .split("\n")
      .slice(1)
      .some((line) => {
        const file = line.trim().split(" (")[0];
        return (
          file &&
          !file.startsWith("/usr/lib/") &&
          !file.startsWith("/System/Library/")
        );
      })
  )
    throw failure();
  return node;
};
const listen = (server: Server, address: number | string) =>
  new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    const ready = () => {
      server.off("error", reject);
      resolve();
    };
    if (typeof address === "number") server.listen(address, "127.0.0.1", ready);
    else server.listen(address, ready);
  });
const closeServer = (server: Server) =>
  new Promise<void>((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }
    server.close((error) => (error ? reject(error) : resolve()));
  });

/** Self-test uses only host-created temporary fixtures, never projects, user configuration or secrets.
 * No author program can be admitted through this class until a complete runtime exists. */
export class ProjectSandbox {
  private inspection?: Promise<ProjectBoundaryReport>;
  private closed = false;
  constructor(private readonly nodePath = process.execPath) {}
  inspect(): Promise<ProjectBoundaryReport> {
    if (this.closed)
      return Promise.resolve(
        frozen({
          reportVersion: "1.0",
          status: "failed",
          ready: false,
          reason: "PROJECT_RUNTIME_CLOSED",
          platform: process.platform,
          arch: process.arch,
          checks: [],
          knownRisks: [],
          cleanupCompleted: true,
        }),
      );
    return (this.inspection ??= this.probe());
  }
  async assertAvailable(): Promise<never> {
    await this.inspect();
    // A passing diagnostic is necessary, not sufficient: no project launcher is installed yet.
    // There is deliberately no caller-controlled readiness flag or machine fallback.
    throw failure();
  }
  async close(): Promise<void> {
    this.closed = true;
    const report = await this.inspection;
    if (report && !report.cleanupCompleted) throw failure();
  }
  private async probe(): Promise<ProjectBoundaryReport> {
    const report: ProjectBoundaryReport = {
      reportVersion: "1.0",
      status: "failed",
      ready: false,
      reason: "PROJECT_SELF_CHECK_FAILED",
      platform: process.platform,
      arch: process.arch,
      checks: [],
      knownRisks: [],
      cleanupCompleted: true,
    };
    if (process.platform !== "darwin" || process.arch !== "arm64")
      return frozen({
        ...report,
        status: "skipped",
        reason: "MACOS_ARM64_REQUIRED",
      });
    let root: string | undefined,
      child: ChildProcess | undefined,
      childDone: Promise<void> | undefined;
    const tcp = createServer((socket) => socket.end()),
      unix = createServer((socket) => socket.end());
    const datagrams = createSocket("udp4");
    let udpBound = false;
    try {
      const node = await checkRuntime(this.nodePath);
      root = await realpath(await mkdtemp("/private/tmp/plums-project-check-"));
      const file = (name: string) => path.join(root!, name);
      const dirs = [
        "project",
        "outside",
        "platform/snapshot",
        "platform/private/own/home",
        "platform/private/own/tmp",
        "platform/private/own/cache",
        "platform/private/sibling",
        "platform/other-agent",
        "user-home/.ssh",
        "user-home/Library/Keychains",
        "user-home/.cargo",
        "user-home/toolchain",
      ];
      await Promise.all(
        dirs.map((d) => mkdir(file(d), { recursive: true, mode: 0o700 })),
      );
      const originals = [
        "project/data",
        "project/rename",
        "outside/data",
        "outside/rename",
        "outside/hard-data",
        "outside/late-hard-data",
        "platform/snapshot/data",
        "platform/other-agent/secret",
        "platform/private/sibling/secret",
        "user-home/.ssh/key",
        "user-home/Library/Keychains/key",
        "user-home/.npmrc",
        "user-home/.gitconfig",
        "user-home/.cargo/credentials.toml",
        "user-home/toolchain/data",
      ];
      await Promise.all(
        originals.map((p) => writeFile(file(p), "fixture", { mode: 0o600 })),
      );
      await symlink(file("outside/data"), file("project/symlink"));
      await link(file("outside/hard-data"), file("project/outside-alias"));
      await link(
        file("platform/other-agent/secret"),
        file("project/private-alias"),
      );
      const sibling = fileURLToPath(
        new URL("./project-probe", import.meta.url),
      );
      const binary = existsSync(sibling)
        ? sibling
        : fileURLToPath(new URL("../dist/project-probe", import.meta.url));
      const snapshotBinary = file("platform/snapshot/project-probe");
      await copyFile(binary, snapshotBinary);
      report.probeDigest = digest(await readFile(snapshotBinary));
      const profile = projectProfile({
        node,
        snapshot: file("platform/snapshot"),
        projects: [file("project")],
        privateRoot: file("platform/private/own"),
        home: file("platform/private/own/home"),
        temporary: file("platform/private/own/tmp"),
        cache: file("platform/private/own/cache"),
        userHome: file("user-home"),
        dataDir: file("platform"),
        toolchains: [file("user-home/toolchain")],
        readOnly: [file("user-home")],
      });
      report.profileDigest = digest(profile);
      await listen(tcp, 0);
      const address = tcp.address();
      if (!address || typeof address === "string") throw failure();
      await listen(unix, file("project/probe.sock"));
      await new Promise<void>((resolve, reject) => {
        datagrams.once("error", reject);
        datagrams.bind(address.port, "127.0.0.1", () => {
          datagrams.off("error", reject);
          udpBound = true;
          resolve();
        });
      });
      // Exercise fixed Node and ordinary Node/shell descendants as a positive control.
      const source =
        "const cp=require('node:child_process');const r=cp.spawnSync(process.execPath,['--openssl-config=/dev/null','-e','process.exit(0)']);console.log(JSON.stringify({nodeChild:r.status===0}));";
      const n = spawnSync(
        "/usr/bin/sandbox-exec",
        ["-p", profile, node, "--openssl-config=/dev/null", "-e", source],
        {
          cwd: file("project"),
          env: {},
          encoding: "utf8",
          timeout: 4000,
          maxBuffer: 16 * 1024,
        },
      );
      const nodeChild =
        n.status === 0 && n.stdout.trim() === '{"nodeChild":true}';
      child = spawn(
        "/usr/bin/sandbox-exec",
        [
          "-p",
          profile,
          snapshotBinary,
          root,
          String(process.pid),
          String(address.port),
        ],
        {
          cwd: file("project"),
          env: {},
          detached: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const running = child;
      let output = "",
        stderrBytes = 0,
        started = false,
        failed = false,
        code: number | null = null;
      const kill = () => {
        failed = true;
        if (running.pid) {
          try {
            process.kill(-running.pid, "SIGKILL");
          } catch {
            /* already exited */
          }
        }
      };
      const timer = setTimeout(kill, 8000);
      let advance: Promise<void> = Promise.resolve();
      running.stdout!.on("data", (bytes: Buffer) => {
        output += bytes.toString("utf8");
        if (Buffer.byteLength(output) > 16 * 1024) {
          kill();
          return;
        }
        if (!started && output.startsWith("ready\n")) {
          started = true;
          // These aliases are added after the sandbox has started, defeating static scans.
          advance = (async () => {
            await link(
              file("platform/other-agent/secret"),
              file("project/late-private-alias"),
            );
            await link(
              file("outside/late-hard-data"),
              file("project/late-outside-alias"),
            );
            running.stdin!.end("probe\n");
          })().catch(kill);
        }
      });
      running.stderr!.on("data", (bytes: Buffer) => {
        stderrBytes += bytes.length;
        if (stderrBytes > 16 * 1024) kill();
      });
      running.stdin!.on("error", kill);
      running.on("error", kill);
      childDone = new Promise<void>((resolve) =>
        running.once("close", (exit) => {
          code = exit;
          clearTimeout(timer);
          resolve();
        }),
      );
      await childDone;
      await advance;
      if (failed || code !== 0 || !started) throw failure();
      const raw = JSON.parse(output.slice("ready\n".length)) as Record<
        string,
        unknown
      >;
      const names = [...allowed, ...denied];
      if (
        Object.keys(raw).length !== names.length ||
        names.some((name) => ![0, 1].includes(raw[name] as number))
      )
        throw failure();
      const checks: { id: string; status: "passed" | "failed" }[] = [
        { id: "nodeChild", status: nodeChild ? "passed" : "failed" },
        ...names.map((id) => ({
          id,
          status: (raw[id] === (allowed.includes(id) ? 1 : 0)
            ? "passed"
            : "failed") as "passed" | "failed",
        })),
      ];
      for (const name of [
        "outside/data",
        "outside/hard-data",
        "outside/late-hard-data",
        "platform/other-agent/secret",
        "platform/private/sibling/secret",
        "user-home/toolchain/data",
        "platform/snapshot/data",
      ]) {
        checks.push({
          id: "unchanged:" + name,
          status:
            (await readFile(file(name), "utf8")) === "fixture"
              ? "passed"
              : "failed",
        });
      }
      checks.push({
        id: "noOutsideFiles",
        status: [
          "outside/written",
          "outside/dotdot",
          "outside/renamed-out",
          "project/renamed-in",
        ].some((p) => existsSync(file(p)))
          ? "failed"
          : "passed",
      });
      report.checks = checks;
      report.knownRisks = checks.filter((c) =>
        [
          "readLateHardlink",
          "writeLateHardlink",
          "unchanged:outside/late-hard-data",
        ].includes(c.id),
      );
      report.status = checks.every((c) => c.status === "passed")
        ? "passed"
        : "failed";
      report.reason =
        report.status === "passed"
          ? "PROJECT_RUNTIME_NOT_INTEGRATED"
          : "PROJECT_BOUNDARY_FAILED";
    } catch {
      report.status = "failed";
      report.reason = "PROJECT_SELF_CHECK_FAILED";
    } finally {
      if (
        child &&
        child.exitCode === null &&
        child.signalCode === null &&
        child.pid
      ) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          /* already exited */
        }
      }
      await childDone;
      const cleanup = await Promise.allSettled([
        closeServer(tcp),
        closeServer(unix),
        udpBound
          ? new Promise<void>((resolve) => datagrams.close(resolve))
          : Promise.resolve(),
      ]);
      if (root) {
        try {
          await rm(root, { recursive: true, force: true });
        } catch {
          report.cleanupCompleted = false;
        }
      }
      if (cleanup.some((r) => r.status === "rejected"))
        report.cleanupCompleted = false;
      if (!report.cleanupCompleted) {
        report.status = "failed";
        report.reason = "PROJECT_CLEANUP_FAILED";
      }
    }
    return frozen(report);
  }
}
