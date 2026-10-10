import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const native = process.platform === "darwin" && process.arch === "arm64";
const children: ChildProcess[] = [],
  pids = new Set<number>();
let root: string;
afterEach(async () => {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  pids.clear();
  for (const child of children.splice(0)) {
    child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((r) => child.once("exit", r));
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
  }
  if (root) await rm(root, { recursive: true, force: true });
});
type Answer = { ret: number; errno: number; constant: string };
it.runIf(native)(
  "records raw sandbox_check variants and their calibration verdict",
  async () => {
    const run = (file: string, args: string[]) => {
      const result = spawnSync(file, args, { encoding: "utf8", env: {} });
      return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    };
    const environment = {
      uname: run("/usr/bin/uname", ["-a"]),
      macOS: run("/usr/bin/sw_vers", []),
      node: process.version,
      context: "Codex shell; Terminal computer use denied",
      allowDefault: run("/usr/bin/sandbox-exec", [
        "-p",
        "(version 1)(allow default)",
        "/usr/bin/true",
      ]),
      noNetwork: run("/usr/bin/sandbox-exec", [
        "-n",
        "no-network",
        "/usr/bin/true",
      ]),
    };
    root = await realpath(
      await mkdtemp("/private/tmp/plums-members-variants-"),
    );
    const markers = path.join(root, "plums-markers"),
      binary = path.join(root, "sentry");
    await mkdir(path.join(markers, "denied"), { recursive: true, mode: 0o700 });
    await chmod(markers, 0o700);
    const nonce = randomBytes(32).toString("hex"),
      control = randomBytes(32).toString("hex");
    for (const file of [nonce, control, "denied/x"])
      await writeFile(path.join(markers, file), "", { mode: 0o600 });
    const build = run("/usr/bin/clang", [
      "-O2",
      path.resolve("packages/host/test/fixtures/members-variant-sentry.c"),
      "-o",
      binary,
    ]);
    expect(build.status, build.stderr).toBe(0);
    const base = `(version 1)(deny default)(allow file-read* (literal "/") (subpath "${root}") (subpath "/usr") (subpath "/System") (subpath "/private/etc") (literal "/dev/null"))(allow file-write* (subpath "${root}"))(allow sysctl-read)(allow process-info* (target self))(allow process-fork)(allow process-exec (literal "${binary}") (literal "/usr/bin/sandbox-exec"))(allow signal (target same-sandbox))`;
    async function start(profile?: string) {
      const child = spawn(
        profile ? "/usr/bin/sandbox-exec" : binary,
        profile ? ["-p", profile, binary] : [],
        { env: {}, stdio: ["pipe", "pipe", "pipe"] },
      );
      children.push(child);
      pids.add(child.pid!);
      let stdout = "",
        stderr = "";
      child.stdout!.on("data", (b) => {
        stdout += b;
        for (const match of stdout.matchAll(/pid [\w-]+ (\d+)/g))
          pids.add(Number(match[1]));
      });
      child.stderr!.on("data", (b) => {
        stderr += b;
      });
      const deadline = Date.now() + 4000;
      while (
        !stdout.includes("ready") &&
        child.exitCode === null &&
        child.signalCode === null &&
        Date.now() < deadline
      )
        await new Promise((r) => setTimeout(r, 10));
      return {
        objects: Object.fromEntries(
          [...stdout.matchAll(/pid ([\w-]+) (\d+)/g)].map((m) => [
            m[1],
            Number(m[2]),
          ]),
        ),
        stdout,
        stderr,
        ready: stdout.includes("ready"),
      };
    }
    const helper = path.resolve("packages/host/dist/project-members-probe");
    function check(
      pid: number,
      op: string,
      filter: string,
      arg: string,
    ): Answer {
      const result = run(helper, ["check", String(pid), op, filter, arg]);
      expect(result.status, result.stderr).toBe(0);
      const answer = JSON.parse(result.stdout);
      expect(answer).toMatchObject({
        ret: expect.any(Number),
        errno: expect.any(Number),
        constant: expect.any(String),
      });
      return answer;
    }
    const variants: Record<
      string,
      {
        a: Awaited<ReturnType<typeof start>>;
        b: Awaited<ReturnType<typeof start>>;
        results: Record<string, { nonce: Answer; control: Answer }>;
        go: boolean;
      }
    > = {};
    const outside = await start();
    for (const [name, op, filter, target, comparison, shared, deny] of [
      [
        "V0",
        "file-read-data",
        "path",
        `/usr/lib/.plums-member-${nonce}`,
        `/usr/lib/.plums-control-${control}`,
        "",
        `(deny file-read* (literal "/usr/lib/.plums-member-${nonce}"))`,
      ],
      [
        "V1",
        "file-read-data",
        "path",
        path.join(markers, nonce),
        path.join(markers, control),
        `(allow file-read-data (subpath "${markers}"))`,
        `(deny file-read-data (literal "${path.join(markers, nonce)}"))`,
      ],
      [
        "V2",
        "mach-lookup",
        "global-name",
        `plums.marker.${nonce}`,
        `plums.marker.${control}`,
        '(allow mach-lookup (global-name-prefix "plums.marker."))',
        `(deny mach-lookup (global-name "plums.marker.${nonce}"))`,
      ],
      [
        "V3",
        "file-read-data",
        "path",
        path.join(markers, "denied/x"),
        "/usr/lib",
        "",
        `(deny file-read-data (subpath "${path.join(markers, "denied")}"))`,
      ],
    ]) {
      const a = await start(base + shared + deny),
        b = await start(base + shared);
      const objects = {
        ...Object.fromEntries(
          Object.entries(a.objects).map(([k, v]) => ["A/" + k, v]),
        ),
        "B/entry": b.objects.entry,
        host: process.pid,
        outside: outside.objects.entry,
      };
      const results = Object.fromEntries(
        Object.entries(objects)
          .filter(([, pid]) => pid !== undefined)
          .map(([k, pid]) => [
            k,
            {
              nonce: check(pid, op, filter, target),
              control: check(pid, op, filter, comparison),
            },
          ]),
      );
      const required = [
        "A/entry",
        "A/fork",
        "A/exec",
        "A/setsid",
        "A/spawn-setpgroup",
        "B/entry",
        "host",
        "outside",
      ];
      const go =
        required.every(
          (k) =>
            results[k] &&
            (k.startsWith("A/")
              ? results[k].nonce.ret !== 0 && results[k].nonce.ret !== -1
              : results[k].nonce.ret === 0) &&
            results[k].control.ret === 0,
        ) &&
        Object.entries(results)
          .filter(([k]) => k.startsWith("A/"))
          .every(
            ([, r]) =>
              r.nonce.ret !== 0 && r.nonce.ret !== -1 && r.control.ret === 0,
          );
      variants[name] = { a, b, results, go };
    }
    const errors = Object.values(variants).some(
      (v) =>
        !v.a.ready ||
        !v.b.ready ||
        Object.values(v.results).some(
          (r) => r.nonce.ret === -1 || r.control.ret === -1,
        ),
    );
    const outer = environment.allowDefault.status !== 0;
    const verdict =
      errors || outer
        ? "INCONCLUSIVE"
        : variants.V3.go && (variants.V1.go || variants.V2.go)
          ? "GO"
          : "NO_GO";
    const reason = outer
      ? "outer sandbox or sandbox-exec unavailable"
      : errors
        ? "entry or private API error"
        : `V1=${variants.V1.go}; V2=${variants.V2.go}; V3=${variants.V3.go}`;
    const report = { environment, variants, verdict, reason };
    await mkdir(".artifacts/macos-continuation", { recursive: true });
    await writeFile(
      ".artifacts/macos-continuation/members-variants.json",
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log("members variants", verdict, reason);
    expect(["GO", "NO_GO", "INCONCLUSIVE"]).toContain(verdict);
  },
);
