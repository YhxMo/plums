import { it, expect } from "vitest";
import {
  ControlledExecution,
  ControlledProcess,
  controlledProfile,
} from "../src/controlled-execution.js";
import {
  mkdtemp,
  realpath,
  mkdir,
  readFile,
  writeFile,
  rm,
  symlink,
} from "node:fs/promises";
import { fork, spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
const node = path.resolve(".build-cache/node-v26.5.1-darwin-arm64/bin/node");
it("production command sandbox enforces precise native file/network/process boundaries and waits three seconds for TERM resistant cleanup", async () => {
  const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "plums-production-boundary-")),
    ),
    x = new ControlledExecution(node);
  try {
    for (const dir of ["read", "scratch", "outside", "agent-b", "write-only"])
      await mkdir(path.join(root, dir));
    const data = (dir: string) => path.join(root, dir, "data");
    for (const dir of ["read", "outside", "agent-b", "write-only"])
      await writeFile(data(dir), "fixture");
    const link = path.join(root, "read", "link");
    await symlink(data("agent-b"), link);
    const binary = path.join(root, "probe");
    expect(
      spawnSync("/usr/bin/clang", [
        "packages/host/test/fixtures/controlled-execution-probe.c",
        "-o",
        binary,
      ]).status,
    ).toBe(0);
    const hash = createHash("sha256")
      .update(await readFile(binary))
      .digest("hex");
    const args = [
      data("read"),
      data("outside"),
      data("agent-b"),
      link,
      data("scratch"),
      path.join(root, "outside", "written"),
      data("write-only"),
      "1",
      path.join(root, "none.sock"),
      String(process.pid),
      "exit 0",
    ];
    const r = await x.run(
      binary,
      args,
      path.join(root, "scratch"),
      [path.join(root, "read"), path.join(root, "scratch")],
      [path.join(root, "scratch"), path.join(root, "write-only")],
      new AbortController().signal,
      async () => {},
      hash,
    );
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("execDenied");
    const report = JSON.parse(r.stdout.split("\n")[0]!);
    for (const [name, value] of Object.entries(report))
      expect(value, name).toBe(
        ["readAllowed", "writeScratch"].includes(name) ? 1 : 0,
      );
    expect(await readFile(data("outside"), "utf8")).toBe("fixture");
    let ready!: () => void;
    const readiness = new Promise<void>((r) => (ready = r));
    const hold = new ControlledProcess(
      node,
      binary,
      ["hold"],
      root,
      controlledProfile(binary, [root], [root]),
      (kind, data) => {
        if (kind === "stdout" && data.toString().includes("ready")) ready();
      },
    );
    await readiness;
    const before = performance.now();
    await hold.stop();
    expect(performance.now() - before).toBeGreaterThan(2900);
    expect(() => process.kill(hold.pid!, 0)).toThrow();
  } finally {
    await x.close();
    await rm(root, { recursive: true, force: true });
  }
}, 20000);
it("independent production supervisor cleans the actual TERM resistant program after broker process exit", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "plums-broker-death-")),
  );
  try {
    const binary = path.join(root, "probe");
    expect(
      spawnSync("/usr/bin/clang", [
        "packages/host/test/fixtures/controlled-execution-probe.c",
        "-o",
        binary,
      ]).status,
    ).toBe(0);
    const broker = fork(
      "packages/host/test/controlled-broker-child.mjs",
      [node, binary, root],
      {
        execPath: node,
        execArgv: [],
        env: {},
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      },
    );
    const pid = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("No program ready")), 8000);
      broker.once("message", (m: any) => {
        clearTimeout(timer);
        resolve(m.pid);
      });
      broker.once("error", reject);
    });
    broker.send("exit");
    await new Promise((r) => broker.once("exit", r));
    let alive = true;
    const deadline = Date.now() + 6000;
    while (alive && Date.now() < deadline) {
      try {
        process.kill(pid, 0);
      } catch {
        alive = false;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(alive).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
it("missing/dependent runtime refuses author startup and mismatched executable digest is rejected before dispatch", async () => {
  const x = new ControlledExecution("/no/fixed/node");
  await expect(
    x.prepare({ "main.js": Buffer.from('throw Error("must not load")') }),
  ).rejects.toBeDefined();
  await x.close();
  const valid = new ControlledExecution(node);
  try {
    await expect(
      valid.run(
        "/bin/echo",
        [],
        os.tmpdir(),
        [],
        [],
        new AbortController().signal,
        async () => {},
        "wrong",
      ),
    ).rejects.toMatchObject({ details: { reason: "STALE_BINDING" } });
  } finally {
    await valid.close();
  }
});
it("self-exec of the same fixed image stays in the same PID and cannot read outside its original sandbox", async () => {
  const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "plums-self-exec-")),
    ),
    x = new ControlledExecution(node);
  try {
    const source = path.join(root, "self.c"),
      binary = path.join(root, "self"),
      outside = path.join(root, "outside");
    await writeFile(outside, "fixture");
    await writeFile(
      source,
      `#include <stdio.h>\n#include <unistd.h>\n#include <fcntl.h>\n#include <string.h>\nint main(int argc,char**argv){if(argc!=3)return 2;if(strcmp(argv[1],"again")){printf("before:%d\\n",getpid());fflush(stdout);execl(argv[0],argv[0],"again",argv[2],NULL);return 3;}printf("after:%d outside:%d\\n",getpid(),open(argv[2],O_RDONLY)!=-1);return 0;}`,
    );
    expect(spawnSync("/usr/bin/clang", [source, "-o", binary]).status).toBe(0);
    const digest = createHash("sha256")
      .update(await readFile(binary))
      .digest("hex");
    const result = await x.run(
      binary,
      ["first", outside],
      root,
      [],
      [],
      new AbortController().signal,
      async () => {},
      digest,
    );
    expect(result.exitCode).toBe(0);
    const before = /before:(\d+)/.exec(result.stdout),
      after = /after:(\d+) outside:0/.exec(result.stdout);
    expect(before?.[1]).toBeDefined();
    expect(after?.[1]).toBe(before?.[1]);
  } finally {
    await x.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

it("awaits actual supervisor exit and snapshot cleanup when trusted process tracking fails", async () => {
  let child: import("node:child_process").ChildProcess | undefined;
  const x = new ControlledExecution(node, (p) => {
    child = p;
    throw Error("tracking failed");
  });
  try {
    await expect(
      x.launchFoundation(
        { "entry.mjs": Buffer.from("setInterval(()=>{},1000)") },
        "entry.mjs",
        () => {},
        async () => {},
      ),
    ).rejects.toThrow("tracking failed");
    expect(child).toBeDefined();
    expect(child!.exitCode !== null || child!.signalCode !== null).toBe(true);
    expect(() => process.kill(child!.pid!, 0)).toThrow();
    expect((x as any).processes.size).toBe(0);
    expect((x as any).pendingCleanups.size).toBe(0);
  } finally {
    await x.close();
  }
});
