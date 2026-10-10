import { controlledRuntimeSupported } from "./os-gate.mjs";
import { fork, spawnSync, type ChildProcess } from "node:child_process";
import {
  mkdtemp,
  realpath,
  mkdir,
  writeFile,
  rm,
  lstat,
  chmod,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { resourceFailure } from "./resource-error.js";
import type { ExecResult, PackageFiles } from "@plumsjs/core";
const sibling = (file: string) => {
  const p = fileURLToPath(new URL("./" + file, import.meta.url));
  return existsSync(p)
    ? p
    : fileURLToPath(new URL("../dist/" + file, import.meta.url));
};
const quote = (s: string) => {
  if (/[\x00-\x1f]/.test(s)) throw resourceFailure("INVALID_REQUEST");
  return JSON.stringify(s);
};
export function controlledProfile(
  program: string,
  reads: string[],
  writes: string[],
  forbidden: string[] = [],
) {
  const parents = new Set<string>();
  for (const item of [program, ...reads, ...writes]) {
    let p = path.dirname(item);
    while (p !== path.dirname(p)) {
      parents.add(p);
      p = path.dirname(p);
    }
  }
  return `(version 1)(deny default)
 (allow file-read-metadata ${[...parents].map((p) => `(literal ${quote(p)})`).join(" ")})
 (allow file-read* (literal "/") (subpath "/usr/lib") (subpath "/System/Library") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random") (literal ${quote(program)}) ${reads.map((r) => `(subpath ${quote(r)})`).join(" ")})
 ${writes.length ? `(allow file-write* ${writes.map((r) => `(subpath ${quote(r)})`).join(" ")})` : ""}
 ${forbidden.length ? `(deny file-read* file-write* ${forbidden.map((r) => `(subpath ${quote(r)})`).join(" ")})` : ""}
 (allow process-exec (literal ${quote(program)}))(allow sysctl-read)(allow process-info* (target self))`;
}
/** No caller chooses a pid, executable, inherited environment or descriptors. */
export class ControlledProcess {
  cleaned?: Promise<void>;
  readonly supervisor: ChildProcess;
  readonly done: Promise<{ code: number | null; signal: string | null }>;
  pid?: number;
  rss?: number;
  cpuMs?: number;
  private complete!: (v: {
    code: number | null;
    signal: string | null;
  }) => void;
  private outcome = {
    code: null as number | null,
    signal: null as string | null,
  };
  private started = false;
  private total = 0;
  limitExceeded = false;
  constructor(
    nodePath: string,
    program: string,
    args: string[],
    cwd: string,
    profile: string,
    onData: (kind: "stdout" | "stderr", data: Buffer) => void,
    private streaming = false,
  ) {
    this.done = new Promise((r) => (this.complete = r));
    this.supervisor = fork(sibling("controlled-supervisor.js"), [], {
      execPath: nodePath,
      execArgv: [],
      env: {},
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    });
    this.supervisor.on("message", (raw: unknown) => {
      const m = raw as {
        type: string;
        pid: number;
        code: number | null;
        signal: string | null;
        data: string;
        rss: number;
        cpuMs: number;
      };
      if (m.type === "spawned") {
        this.started = true;
        this.pid = m.pid;
      }
      if (m.type === "usage") {
        this.rss = m.rss;
        this.cpuMs = m.cpuMs;
      }
      if (m.type === "exited")
        this.outcome = { code: m.code, signal: m.signal };
      if (m.type === "stdout" || m.type === "stderr") {
        const data = Buffer.from(m.data, "base64");
        this.total += data.length;
        if (!this.streaming && this.total > 8 * 1024 * 1024) {
          this.limitExceeded = true;
          void this.stop();
          return;
        }
        onData(m.type, data);
      }
    });
    this.supervisor.on("error", () => {
      if (this.supervisor.connected) this.supervisor.disconnect();
    });
    this.supervisor.on("close", () => this.complete(this.outcome));
    this.supervisor.send({ type: "start", program, args, cwd, profile });
  }
  write(message: unknown) {
    if (!this.supervisor.connected)
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    this.supervisor.send({
      type: "write",
      data: JSON.stringify(message) + "\n",
    });
  }
  async stop() {
    if (this.supervisor.connected)
      this.supervisor.send({ type: "stop" }, () => {});
    await this.done;
  }
  get dispatched() {
    return this.started;
  }
}
export class ControlledExecution {
  private processes = new Set<ControlledProcess>();
  private pendingCleanups = new Set<Promise<void>>();
  constructor(
    readonly nodePath: string,
    private trackProcess?: (child: ChildProcess) => void,
    private allocateSnapshot?: () => { root: string; release(): void },
  ) {}
  private cleanup(remove: () => Promise<void>) {
    const pending = Promise.resolve().then(remove);
    this.pendingCleanups.add(pending);
    void pending.then(
      () => this.pendingCleanups.delete(pending),
      () => {},
    );
    return pending;
  }
  private async fixedRuntime() {
    if (!controlledRuntimeSupported || !existsSync("/usr/bin/sandbox-exec"))
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    const node = await realpath(this.nodePath),
      deps = spawnSync("/usr/bin/otool", ["-L", node], { encoding: "utf8" });
    if (
      deps.status !== 0 ||
      deps.stdout
        .split("\n")
        .slice(1)
        .some((line) => {
          const p = line.trim().split(" (")[0] ?? "";
          return (
            p && !p.startsWith("/usr/lib/") && !p.startsWith("/System/Library/")
          );
        })
    )
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    const version = spawnSync(node, ["--version"], {
      env: {},
      encoding: "utf8",
    });
    if (version.stdout.trim() !== "v26.5.1")
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    return node;
  }
  private async probe(node: string, root: string) {
    const read = path.join(root, "read"),
      scratch = path.join(root, "scratch"),
      outside = path.join(root, "outside");
    await Promise.all(
      [read, scratch, outside].map((p) =>
        mkdir(p, { recursive: true, mode: 0o700 }),
      ),
    );
    await Promise.all(
      [path.join(read, "data"), path.join(outside, "data")].map((p) =>
        writeFile(p, "fixture", { mode: 0o600 }),
      ),
    );
    const binary = sibling("controlled-probe"),
      args = [
        path.join(read, "data"),
        path.join(outside, "data"),
        path.join(outside, "data"),
        path.join(outside, "data"),
        path.join(scratch, "data"),
        path.join(outside, "written"),
        path.join(outside, "data"),
        "1",
        path.join(root, "mock.sock"),
        String(process.pid),
        "exit 0",
      ];
    const output = await this.command(
      node,
      binary,
      args,
      scratch,
      controlledProfile(binary, [read, scratch], [scratch]),
      8000,
    );
    let report: Record<string, number>;
    try {
      report = JSON.parse(output.stdout.split("\n")[0]!);
    } catch {
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    }
    if (
      output.exitCode !== 0 ||
      !output.stdout.includes("execDenied") ||
      Object.entries(report).some(
        ([k, v]) => v !== (["readAllowed", "writeScratch"].includes(k) ? 1 : 0),
      )
    )
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    // Probe the actual fixed Node as well, before any author code is loaded.
    const source = `const fs=require('node:fs'),cp=require('node:child_process');let denied=false;try{fs.readFileSync(${quote(path.join(outside, "data"))})}catch{denied=true}console.log(JSON.stringify({denied,spawn:!!cp.spawnSync('/bin/echo').error}));`;
    const n = await this.command(
      node,
      node,
      ["--openssl-config=/dev/null", "-e", source],
      scratch,
      controlledProfile(node, [scratch], [scratch]),
      8000,
    );
    if (
      n.exitCode !== 0 ||
      n.stdout.trim() !== JSON.stringify({ denied: true, spawn: true })
    )
      throw resourceFailure("RUNTIME_UNAVAILABLE");
  }
  async prepare(files: PackageFiles) {
    const node = await this.fixedRuntime(),
      allocation = this.allocateSnapshot?.(),
      temporary =
        allocation?.root ??
        (await mkdtemp(path.join(tmpdir(), "plums-controlled-")));
    const remove = async () => {
      await rm(temporary, { recursive: true, force: true });
      allocation?.release();
    };
    try {
      if (allocation) await mkdir(temporary, { recursive: true, mode: 0o700 });
      const root = await realpath(temporary);
      await this.probe(node, root);
      const snapshot = path.join(root, "snapshot"),
        scratch = path.join(root, "work");
      await mkdir(snapshot, { mode: 0o700 });
      await mkdir(scratch, { mode: 0o700 });
      for (const [name, data] of Object.entries(files)) {
        if (
          name.startsWith("/") ||
          name.split("/").includes("..") ||
          name.includes("\\")
        )
          throw resourceFailure("INVALID_REQUEST");
        const file = path.join(snapshot, name);
        await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(file, data, { mode: 0o400 });
      }
      await writeFile(
        path.join(snapshot, "package.json"),
        JSON.stringify({ type: "module" }),
        { mode: 0o400 },
      );
      return {
        node,
        snapshot,
        scratch,
        cleanup: remove,
      };
    } catch (e) {
      await this.cleanup(remove);
      throw e;
    }
  }
  async launchNode(
    files: PackageFiles,
    entry: string,
    onData: (kind: "stdout" | "stderr", data: Buffer) => void,
    check: () => void = () => {},
  ) {
    const prepared = await this.prepare(files),
      worker = sibling("controlled-worker.cjs");
    try {
      check();
    } catch (error) {
      await this.cleanup(prepared.cleanup);
      throw error;
    }
    const p = new ControlledProcess(
      prepared.node,
      prepared.node,
      [
        "--openssl-config=/dev/null",
        worker,
        path.join(prepared.snapshot, entry),
      ],
      prepared.scratch,
      controlledProfile(
        prepared.node,
        [worker, prepared.snapshot, prepared.scratch],
        [prepared.scratch],
      ),
      onData,
      true,
    );
    this.processes.add(p);
    p.cleaned = p.done.then(async () => {
      await this.cleanup(prepared.cleanup);
      this.processes.delete(p);
    });
    void p.cleaned.catch(() => {});
    await this.observeProcess(p);
    return p;
  }
  /** Public foundation protocol carrier. Author entry is verified by the session factory;
   * it never runs the official worker and receives no writable business directory. */
  async launchFoundation(
    files: PackageFiles,
    entry: string,
    onData: (kind: "stdout" | "stderr", data: Buffer) => void,
    check: () => Promise<void>,
  ): Promise<ControlledProcess> {
    if (
      !entry ||
      entry.startsWith("/") ||
      /[\\\0]/.test(entry) ||
      entry.split("/").some((p) => !p || p === "." || p === "..") ||
      !Object.hasOwn(files, entry)
    )
      throw resourceFailure("INVALID_REQUEST");
    const prepared = await this.prepare(files);
    try {
      await check();
      const p = new ControlledProcess(
        prepared.node,
        prepared.node,
        [
          "--openssl-config=/dev/null",
          "--max-old-space-size=64",
          "--experimental-vm-modules",
          path.join(prepared.snapshot, entry),
        ],
        prepared.scratch,
        controlledProfile(prepared.node, [prepared.snapshot], []),
        onData,
        true,
      );
      this.processes.add(p);
      p.cleaned = p.done.then(async () => {
        await this.cleanup(prepared.cleanup);
        this.processes.delete(p);
      });
      void p.cleaned.catch(() => {});
      await this.observeProcess(p);
      return p;
    } catch (error) {
      await this.cleanup(prepared.cleanup);
      throw error;
    }
  }
  private async observeProcess(p: ControlledProcess) {
    try {
      this.trackProcess?.(p.supervisor);
    } catch (error) {
      await p.stop();
      await p.cleaned;
      this.processes.delete(p);
      throw error;
    }
  }
  private async command(
    node: string,
    program: string,
    args: string[],
    cwd: string,
    profile: string,
    timeout: number,
    signal?: AbortSignal,
  ): Promise<ExecResult> {
    let stdout = "",
      stderr = "";
    const p = new ControlledProcess(
      node,
      program,
      args,
      cwd,
      profile,
      (kind, data) => {
        if (kind === "stdout") stdout += data.toString();
        else stderr += data.toString();
      },
    );
    this.processes.add(p);
    await this.observeProcess(p);
    const abort = () => void p.stop(),
      timer = setTimeout(abort, timeout);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const r = await p.done;
      if (p.limitExceeded)
        throw resourceFailure(
          "LIMIT_EXCEEDED",
          "",
          p.dispatched ? "unknown" : "not_started",
        );
      if (signal?.aborted || r.code === null)
        throw resourceFailure(
          "CANCELLED",
          "",
          p.dispatched ? "unknown" : "not_started",
        );
      return { exitCode: r.code, stdout, stderr };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      this.processes.delete(p);
    }
  }
  async run(
    program: string,
    args: string[],
    cwd: string,
    reads: string[],
    writes: string[],
    signal: AbortSignal,
    check: () => Promise<void>,
    expectedDigest: string,
    forbidden: string[] = [],
  ) {
    const node = await this.fixedRuntime();
    const executable = await realpath(program);
    const stat = await lstat(executable);
    if (!stat.isFile()) throw resourceFailure("NOT_AUTHORIZED");
    const bytes = await import("node:fs/promises").then((fs) =>
      fs.readFile(executable),
    );
    if (createHash("sha256").update(bytes).digest("hex") !== expectedDigest)
      throw resourceFailure("STALE_BINDING");
    const prepared = await this.prepare({ command: bytes });
    const command = path.join(prepared.snapshot, "command");
    await chmod(command, 0o700);
    const dependencies = spawnSync("/usr/bin/otool", ["-L", command], {
      encoding: "utf8",
    });
    if (
      dependencies.status !== 0 ||
      dependencies.stdout
        .split("\n")
        .slice(1)
        .some((line) => {
          const p = line.trim().split(" (")[0] ?? "";
          return (
            p && !p.startsWith("/usr/lib/") && !p.startsWith("/System/Library/")
          );
        })
    ) {
      await this.cleanup(prepared.cleanup);
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    }
    const sign = spawnSync(
      "/usr/bin/codesign",
      ["--force", "--sign", "-", command],
      { env: {}, stdio: "ignore" },
    );
    if (sign.status !== 0) {
      await this.cleanup(prepared.cleanup);
      throw resourceFailure("RUNTIME_UNAVAILABLE");
    }
    await chmod(command, 0o500);
    try {
      await check();
      return await this.command(
        node,
        command,
        args,
        cwd,
        controlledProfile(
          command,
          [prepared.snapshot, ...reads, prepared.scratch],
          [...writes, prepared.scratch],
          forbidden,
        ),
        3600000,
        signal,
      );
    } finally {
      await this.cleanup(prepared.cleanup);
    }
  }
  async close() {
    const processes = await Promise.allSettled(
      [...this.processes].map(async (p) => {
        await p.stop();
        await p.cleaned;
      }),
    );
    const cleanups = await Promise.allSettled([...this.pendingCleanups]);
    if ([...processes, ...cleanups].some((r) => r.status === "rejected"))
      throw resourceFailure(
        "RUNTIME_UNAVAILABLE",
        undefined,
        "not_started",
        "cleanup",
      );
  }
}
