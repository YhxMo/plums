import { projectNativeAcceptance } from "./support/os-gate.js";
import { randomBytes } from "node:crypto";
import {
  spawn,
  spawnSync,
  execFile,
  type ChildProcess,
} from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it } from "vitest";

const native = projectNativeAcceptance;
// Unverified reap scenarios run only in the explicit experiments project.
// The old nonexistent-path marker is unchanged; see members variants in handoff.
const experiments = native && process.env.PLUMS_NATIVE_EXPERIMENTS === "1";
const run = promisify(execFile);
const helper = path.resolve("packages/host/dist/project-members");
const children: ChildProcess[] = [],
  roots: string[] = [],
  pids = new Set<number>();
const token = (kind: string) =>
  `/usr/lib/.plums-${kind}-${randomBytes(32).toString("hex")}`;
async function until(check: () => Promise<boolean> | boolean) {
  const deadline = Date.now() + 4000;
  while (!(await check())) {
    if (Date.now() >= deadline)
      throw Error("membership experiment assertion was not reached");
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function query(args: string[]) {
  const result = await run(helper, args, {
    env: {},
    timeout: 8000,
    maxBuffer: 65536,
  });
  return JSON.parse(result.stdout);
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
  const root = await mkdtemp("/private/tmp/plums-members-test-");
  roots.push(root);
  const binary = path.join(root, "probe"),
    hook = path.join(root, "hook.dylib");
  for (const [source, args] of [
    ["escape-probe.c", ["-o", binary]],
    ["dyld-hook.c", ["-dynamiclib", "-o", hook]],
  ] as const) {
    const build = spawnSync(
      "/usr/bin/clang",
      ["-O2", path.resolve("packages/host/test/fixtures", source), ...args],
      { env: {}, encoding: "utf8" },
    );
    expect(build.status, build.stderr).toBe(0);
  }
  async function start(
    mode: string,
    name: string,
    sandbox = true,
    supervisor = 0,
  ) {
    const nonce = token("member"),
      control = token("control"),
      file = path.join(root, name);
    const profile = `(version 1)(deny default)(allow file-read* (literal "/") (subpath "${root}") (subpath "/usr") (subpath "/System") (subpath "/private/etc") (literal "/dev/null"))(allow file-write* (subpath "${root}"))(allow sysctl-read)(allow process-info* (target self))(allow process-fork)(allow process-exec (literal "${binary}"))(allow signal (target same-sandbox))(deny file-read* (literal "${nonce}"))`;
    const args = [mode, file, String(supervisor), "pulse"];
    const c = spawn(
      sandbox ? "/usr/bin/sandbox-exec" : binary,
      sandbox ? ["-p", profile, binary, ...args] : args,
      {
        env: { PLUMS_TEST_DYLD_HOOK: hook },
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    children.push(c);
    let output = "";
    c.stdout!.on("data", (b) => {
      output += b;
    });
    c.stderr!.resume();
    await until(() => output.includes("ready"));
    const record = async () => {
      const text = await readFile(file, "utf8");
      for (const m of text.matchAll(/pid (\d+)/g)) pids.add(Number(m[1]));
      return text;
    };
    await record();
    return { c, nonce, control, file, record };
  }
  return { start };
}
type Entry = Awaited<
  ReturnType<Awaited<ReturnType<typeof experiment>>["start"]>
>;
async function calibrated(a: Entry) {
  const result = await query([
    "calibrate",
    String(a.c.pid),
    a.nonce,
    a.control,
  ]);
  console.log("calibration", result);
  expect(result).toMatchObject({ ok: true, member: 1, control: 0, host: 0 });
}
async function reaped(a: Entry) {
  await calibrated(a);
  await a.record();
  const observed = await query(["scan", a.nonce]);
  // Do not signal if the query would include unrelated user processes.
  const owned = new Set([a.c.pid!, ...pids]);
  expect(observed.errors).toBe(0);
  expect(
    observed.members.every((m: { pid: number }) => owned.has(m.pid)),
    JSON.stringify(observed),
  ).toBe(true);
  const result = await query(["reap", a.nonce, "3000", "8000"]);
  console.log("reap", result);
  expect(result).toMatchObject({ residual: 0, errors: 0 });
  expect(result.ms).toBeLessThanOrEqual(8000);
  expect(result.iterations).toBeLessThanOrEqual(50);
  expect(await query(["scan", a.nonce])).toMatchObject({
    members: [],
    errors: 0,
  });
  const leafPids = [...(await a.record()).matchAll(/pid (\d+)/g)].map((m) =>
    Number(m[1]),
  );
  await until(() =>
    leafPids.every(
      (pid) =>
        spawnSync("/bin/ps", ["-o", "pid=", "-p", String(pid)], {
          encoding: "utf8",
        }).stdout.trim() === "",
    ),
  );
  const body = await a.record();
  await new Promise((r) => setTimeout(r, 100));
  expect(await a.record()).toBe(body);
}
it.runIf(experiments)(
  "calibration: member denied, control allowed, host allowed",
  async () => {
    const e = await experiment(),
      a = await e.start("sentry", "a");
    await calibrated(a);
    const scanned = await query(["scan", a.nonce]);
    expect(scanned).toMatchObject({ errors: 0 });
    expect(scanned.members).toEqual([
      { pid: a.c.pid, start: expect.any(Number) },
    ]);
  },
);
it
  .runIf(experiments)
  .each(["setsid", "setpgid", "double-fork", "spawn-setpgroup", "posix-spawn"])(
  "reap leaves no descendant for %s",
  async (mode) => {
    const e = await experiment(),
      a = await e.start(mode, "a");
    await reaped(a);
  },
);
it.runIf(experiments)(
  "a descendant that SIGKILLs the supervisor cannot (signal scope) and is still reaped",
  async () => {
    const e = await experiment(),
      outside = await e.start("sentry", "outside", false),
      a = await e.start("kill-supervisor", "a", true, outside.c.pid);
    await calibrated(a);
    expect(await a.record()).toContain("signal -1 errno 1");
    const before = await outside.record();
    await new Promise((r) => setTimeout(r, 100));
    expect((await outside.record()).length).toBeGreaterThan(before.length);
    await reaped(a);
  },
);
it.runIf(experiments)(
  "a DYLD-injected re-exec of a member cannot signal outside the sandbox and is still reaped",
  async () => {
    const e = await experiment(),
      outside = await e.start("sentry", "outside", false),
      baseline = await e.start("sentry", "baseline");
    await calibrated(baseline); // Never attempt injection before query calibration.
    const a = await e.start("dyld-inject", "a", true, outside.c.pid);
    expect(await a.record()).toContain("injected target -1 errno 1");
    expect(outside.c.exitCode).toBeNull();
    expect(outside.c.signalCode).toBeNull();
    await reaped(a);
  },
);
it.runIf(experiments)(
  "reaping entry A leaves an identical-profile entry B and an unsandboxed sentry alive (different nonce)",
  async () => {
    const e = await experiment(),
      a = await e.start("double-fork", "a"),
      b = await e.start("sentry", "b"),
      outside = await e.start("sentry", "outside", false);
    await reaped(a);
    for (const entry of [b, outside]) {
      const before = await entry.record();
      await new Promise((r) => setTimeout(r, 100));
      expect((await entry.record()).length).toBeGreaterThan(before.length);
    }
  },
);
it.runIf(experiments)(
  "a fork-bomb-ish descendant (N=64 forks within the grace window) is reaped to zero within budget",
  async () => {
    const e = await experiment(),
      a = await e.start("fork-burst", "a");
    await until(
      async () => [...(await a.record()).matchAll(/pid (\d+)/g)].length === 64,
    );
    await reaped(a);
  },
);
it.runIf(experiments)(
  "sandbox_check error is reported as unknown, never as zero residual",
  async () => {
    const e = await experiment(),
      a = await e.start("sentry", "a");
    await calibrated(a);
    expect(await query(["scan", a.nonce])).toHaveProperty(
      "errors",
      expect.any(Number),
    );
    a.c.kill("SIGKILL");
    await new Promise((r) => a.c.once("exit", r));
    expect(await query(["scan", a.nonce])).toMatchObject({
      members: [],
      errors: 0,
    });
  },
);
