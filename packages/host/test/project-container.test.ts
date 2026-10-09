import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
const native = process.platform === "darwin" && process.arch === "arm64";
const children: ChildProcess[] = [],
  pids = new Set<number>(),
  roots: string[] = [];
const live = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 4000;
  while (!(await check())) {
    if (Date.now() > deadline)
      throw Error("experiment did not reach its assertion");
    await new Promise((r) => setTimeout(r, 20));
  }
}
afterEach(async () => {
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {}
  }
  pids.clear();
  for (const c of children.splice(0)) {
    c.kill("SIGKILL");
    if (c.exitCode === null && c.signalCode === null)
      await new Promise((r) => c.once("exit", r));
    c.stdin?.destroy();
    c.stdout?.destroy();
    c.stderr?.destroy();
  }
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function experiment() {
  const root = await mkdtemp("/private/tmp/plums-container-test-");
  roots.push(root);
  const binary = path.join(root, "probe");
  const build = spawnSync(
    "/usr/bin/clang",
    [
      "-O2",
      path.resolve("packages/host/test/fixtures/escape-probe.c"),
      "-o",
      binary,
    ],
    { env: {}, encoding: "utf8" },
  );
  expect(build.status, build.stderr).toBe(0);
  // Stress the reaper with direct setsid/setpgid too. This is a test-only policy.
  const profile = `(version 1)(deny default)(allow file-read* (literal "/") (subpath "${root}") (subpath "/usr") (subpath "/System") (subpath "/private/etc") (literal "/dev/null"))(allow file-write* (subpath "${root}"))(allow sysctl-read)(allow process-info* (target self))(allow process-fork)(allow process-exec (literal "${binary}"))(allow signal (target same-sandbox))`;
  async function start(mode: string, name: string, sandbox = true) {
    const file = path.join(root, name);
    const args = [mode, file, "0"];
    const c = spawn(
      sandbox ? "/usr/bin/sandbox-exec" : binary,
      sandbox ? ["-p", profile, binary, ...args] : args,
      { env: {}, detached: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    children.push(c);
    let output = "";
    c.stdout!.on("data", (b) => {
      output += b;
    });
    c.stderr!.resume();
    await until(() => output.includes("ready"));
    const body = await readFile(file, "utf8");
    const pid = Number(body.match(/pid (\d+)/)![1]);
    pids.add(pid);
    return {
      c,
      pid,
      file,
      output: () => output,
      exited: new Promise<void>((r) => c.once("exit", () => r())),
    };
  }
  return { start };
}
it.runIf(native).each(["spawn-setpgroup", "double-fork"])(
  "group-only baseline leaves a %s descendant",
  async (mode) => {
    const e = await experiment(),
      a = await e.start(mode, "a", false);
    process.kill(-a.c.pid!, "SIGKILL");
    await a.exited;
    expect(live(a.pid)).toBe(true);
  },
);
it
  .runIf(native)
  .each(["setsid", "setpgid", "double-fork", "spawn-setpgroup", "posix-spawn"])(
  "same-sandbox broadcast actually cleans %s and leaves a separate identical-profile entry alive",
  async (mode) => {
    const e = await experiment(),
      a = await e.start(mode, "a"),
      b = await e.start("sentry", "b"),
      outside = await e.start("sentry", "outside", false);
    a.c.stdin!.write("c");
    await until(() => a.output().includes("scope"));
    await until(async () => (await readFile(a.file, "utf8")).includes("cont"));
    expect(await readFile(b.file, "utf8")).not.toContain("cont");
    expect(await readFile(outside.file, "utf8")).not.toContain("cont");
    // Destructive broadcast is tested only after non-destructive scope evidence.
    a.c.stdin!.write("s");
    await a.exited;
    await until(() => !live(a.pid));
    expect(live(b.pid)).toBe(true);
    expect(live(outside.pid)).toBe(true);
    process.kill(b.pid, "SIGCONT");
    await until(async () => (await readFile(b.file, "utf8")).includes("cont"));
  },
);
it.runIf(native)(
  "a same-sandbox descendant can kill the proposed reaper and leave an orphan; the candidate is insufficient",
  async () => {
    const e = await experiment(),
      a = await e.start("double-fork", "a");
    process.kill(a.pid, "SIGUSR1");
    await a.exited;
    expect(live(a.pid)).toBe(true);
  },
);
