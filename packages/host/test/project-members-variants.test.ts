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
import { projectProfile } from "../src/project-profile.js";
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
  for (const [index, child] of children.splice(0).entries()) {
    console.log("members cleanup begin", index);
    child.kill("SIGKILL");
    if (child.exitCode === null && child.signalCode === null)
      await new Promise((r) => child.once("exit", r));
    child.stdin?.destroy();
    child.stdout?.destroy();
    child.stderr?.destroy();
    console.log("members cleanup end", index);
  }
  if (root) await rm(root, { recursive: true, force: true });
});
type Answer = { ret: number; errno: number; constant: string };
const member = (r: { nonce: Answer; control: Answer }) =>
  r.nonce.ret !== 0 && r.nonce.ret !== -1 && r.control.ret === 0;
it.runIf(native)(
  "records raw sandbox_check variants and their calibration verdict",
  async () => {
    let probeSequence = 0;
    const run = (file: string, args: string[]) => {
      const sequence = ++probeSequence;
      // Fixed command identifiers only: retain the last native boundary reached
      // when a synchronous OS call prevents Vitest from writing its JSON.
      console.log(
        "members probe begin",
        sequence,
        path.basename(file),
        args[0] ?? "execute",
      );
      const result = spawnSync(file, args, { encoding: "utf8", env: {} });
      console.log("members probe end", sequence, result.status, result.signal);
      return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    };
    const helper = path.resolve("packages/host/dist/project-members-probe");
    const self = run(helper, ["self"]);
    const knownSandbox = run("/usr/bin/sandbox-exec", [
      "-p",
      "(version 1)(allow default)",
      helper,
      "self",
    ]);
    const environment = {
      uname: run("/usr/bin/uname", ["-a"]),
      macOS: run("/usr/bin/sw_vers", []),
      node: run(process.execPath, ["-v"]),
      self: {
        ...self,
        answer: self.status === 0 ? JSON.parse(self.stdout) : null,
      },
      knownSandbox: {
        ...knownSandbox,
        answer:
          knownSandbox.status === 0 ? JSON.parse(knownSandbox.stdout) : null,
      },
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
    const save = async (report: unknown) => {
      await mkdir(".build-cache/native-diagnostics", { recursive: true });
      await writeFile(
        ".build-cache/native-diagnostics/members-variants.json",
        JSON.stringify(report, null, 2) + "\n",
      );
    };
    // NULL/0 is calibrated with a known sandbox before interpreting the host result.
    // A killed no-network probe also invalidates the environment, even if self reports 0.
    const outer =
      environment.self.answer?.sandboxed === true ||
      environment.noNetwork.signal === "SIGKILL";
    const calibrated =
      environment.self.answer?.ret === 0 &&
      environment.self.answer?.errno === 0 &&
      environment.knownSandbox.answer?.ret === 1 &&
      environment.knownSandbox.answer?.errno === 0;
    if (
      outer ||
      !calibrated ||
      environment.allowDefault.status !== 0 ||
      environment.noNetwork.status !== 0
    ) {
      const reason = outer
        ? "outer sandbox or killed no-network probe"
        : "host sandbox state could not be calibrated";
      await save({
        environment,
        verdict: "INCONCLUSIVE",
        reason,
        blocked: ["V0–V3", "N-A–N-E", "container and launcher"],
      });
      console.log("members variants INCONCLUSIVE", reason);
      expect(environment.knownSandbox.answer).toMatchObject({
        sandboxed: true,
        ret: 1,
        errno: 0,
      });
      return;
    }
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
    const base = `(version 1)(deny default)(allow file-read* (literal "/") (subpath "${root}") (subpath "/usr") (subpath "/System") (subpath "/private/etc") (literal "/dev/null"))(allow file-write* (subpath "${root}"))(allow sysctl-read)(allow process-info* (target self))(allow process-fork)(allow process-exec (literal "${binary}") (literal "/usr/bin/true") (literal "/usr/bin/sandbox-exec"))(allow signal (target same-sandbox))`;
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
    // Query both filter kinds on the same processes, including deny-default outsiders.
    const otherNonce = randomBytes(32).toString("hex"),
      otherControl = randomBytes(32).toString("hex");
    for (const file of [otherNonce, otherControl])
      await writeFile(path.join(markers, file), "", { mode: 0o600 });
    const sharedMarkers = `(allow file-read-data (subpath "${markers}"))(allow mach-lookup (global-name-prefix "plums.marker."))`;
    const denies = (value: string) =>
      `(deny file-read-data (literal "${path.join(markers, value)}"))(deny mach-lookup (global-name "plums.marker.${value}"))`;
    const a = await start(base + sharedMarkers + denies(nonce)),
      b = await start(base + sharedMarkers + denies(otherNonce)),
      thirdParty = await start(
        base + `(deny file-read* (subpath "${markers}"))`,
      );
    const objects = {
      ...Object.fromEntries(
        Object.entries(a.objects).map(([k, v]) => ["A/" + k, v]),
      ),
      ...Object.fromEntries(
        Object.entries(b.objects).map(([k, v]) => ["B/" + k, v]),
      ),
      ...Object.fromEntries(
        Object.entries(thirdParty.objects).map(([k, v]) => [
          "thirdParty/" + k,
          v,
        ]),
      ),
      ...Object.fromEntries(
        Object.entries(outside.objects).map(([k, v]) => ["outside/" + k, v]),
      ),
      host: process.pid,
    };
    const paired = Object.fromEntries(
      Object.entries(objects).map(([label, pid]) => [
        label,
        {
          V1: {
            nonce: check(
              pid,
              "file-read-data",
              "path",
              path.join(markers, nonce),
            ),
            control: check(
              pid,
              "file-read-data",
              "path",
              path.join(markers, control),
            ),
          },
          V2: {
            nonce: check(
              pid,
              "mach-lookup",
              "global-name",
              `plums.marker.${nonce}`,
            ),
            control: check(
              pid,
              "mach-lookup",
              "global-name",
              `plums.marker.${control}`,
            ),
          },
        },
      ]),
    );
    const platform = path.join(root, "platform"),
      privateRoot = path.join(platform, "own");
    const profileOptions = {
      node: binary,
      snapshot: path.join(root, "snapshot"),
      projects: [path.join(root, "project")],
      privateRoot,
      home: path.join(privateRoot, "home"),
      temporary: path.join(privateRoot, "tmp"),
      cache: path.join(privateRoot, "cache"),
      userHome: path.join(root, "user"),
      dataDir: platform,
      toolchains: [],
      readOnly: [root],
    };
    for (const dir of [
      profileOptions.snapshot,
      ...profileOptions.projects,
      profileOptions.home,
      profileOptions.temporary,
      profileOptions.cache,
      profileOptions.userHome,
    ])
      await mkdir(dir, { recursive: true });
    const actual = await start(
      projectProfile(profileOptions) +
        `(allow mach-lookup (global-name-prefix "plums.marker."))(deny mach-lookup (global-name "plums.marker.${nonce}"))`,
    );
    const actualResults = Object.fromEntries(
      Object.entries(actual.objects).map(([label, pid]) => [
        label,
        {
          nonce: check(
            pid,
            "mach-lookup",
            "global-name",
            `plums.marker.${nonce}`,
          ),
          control: check(
            pid,
            "mach-lookup",
            "global-name",
            `plums.marker.${control}`,
          ),
        },
      ]),
    );
    const descendants = [
      "entry",
      "fork",
      "exec",
      "setsid",
      "double-fork",
      "spawn-setpgroup",
      "true-exec",
    ];
    const negativeA = ["entry", "fork"].every(
      (k) =>
        paired[`thirdParty/${k}`] &&
        ["V1", "V2"].every((v) => {
          const r = paired[`thirdParty/${k}`][v as "V1" | "V2"];
          return !member(r) && r.nonce.ret > 0 && r.control.ret > 0;
        }),
    );
    const negativeB = descendants.every(
      (k) =>
        paired[`B/${k}`] &&
        ["V1", "V2"].every((v) => {
          const r = paired[`B/${k}`][v as "V1" | "V2"];
          return !member(r) && r.nonce.ret === 0 && r.control.ret === 0;
        }),
    );
    const actualProfile =
      actual.ready &&
      descendants.every((k) => actualResults[k] && member(actualResults[k]));
    const constantAgreement = Object.values(paired).every(
      (r) => member(r.V1) === member(r.V2),
    );
    const positiveAndOutside = descendants.every(
      (k) =>
        paired[`A/${k}`] &&
        member(paired[`A/${k}`].V2) &&
        paired[`outside/${k}`] &&
        !member(paired[`outside/${k}`].V2),
    );
    const controls = {
      negativeA,
      negativeB,
      actualProfile,
      constantAgreement,
      positiveAndOutside,
    };
    const supplementalErrors =
      !a.ready ||
      !b.ready ||
      !thirdParty.ready ||
      !actual.ready ||
      [
        ...Object.values(paired).flatMap((r) => [r.V1, r.V2]),
        ...Object.values(actualResults),
      ].some((r) =>
        [r.nonce, r.control].some(
          (answer) => answer.ret === -1 || answer.errno !== 0,
        ),
      );
    const errors = Object.values(variants).some(
      (v) =>
        !v.a.ready ||
        !v.b.ready ||
        Object.values(v.results).some(
          (r) => r.nonce.ret === -1 || r.control.ret === -1,
        ),
    );
    const verdict =
      errors || supplementalErrors
        ? "INCONCLUSIVE"
        : variants.V3.go &&
            variants.V2.go &&
            Object.values(controls).every(Boolean)
          ? "GO"
          : "NO_GO";
    const reason =
      errors || supplementalErrors
        ? "entry or private API error"
        : `V1=${variants.V1.go}; V2=${variants.V2.go}; V3=${variants.V3.go}; ${JSON.stringify(controls)}`;
    await save({
      environment,
      variants,
      paired,
      actual,
      actualResults,
      controls,
      verdict,
      reason,
    });
    // Record before asserting: a false positive must turn the test red, with its raw evidence intact.
    expect(negativeA, "N-A deny-default outsiders must never be members").toBe(
      true,
    );
    expect(
      negativeB,
      "N-B an independently marked entry must never be a member",
    ).toBe(true);
    console.log("members variants", verdict, reason);
    expect(["GO", "NO_GO", "INCONCLUSIVE"]).toContain(verdict);
  },
);
