import { expect, it, vi } from "vitest";
import { ProjectSandbox } from "../src/project-sandbox.js";
import {
  projectProfile,
  type ProjectProfileOptions,
} from "../src/project-profile.js";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { runProjectConformance } from "../../../scripts/platform-conformance.mjs";

const node = path.resolve(".artifacts/node-v26.5.1-darwin-arm64/bin/node");
const supported = process.platform === "darwin" && process.arch === "arm64";
const options: ProjectProfileOptions = {
  node: "/fixture/node",
  snapshot: "/fixture/platform/snapshot",
  projects: ["/fixture/project"],
  privateRoot: "/fixture/platform/own",
  home: "/fixture/platform/own/home",
  temporary: "/fixture/platform/own/tmp",
  cache: "/fixture/platform/own/cache",
  userHome: "/fixture/user",
  dataDir: "/fixture/platform",
  toolchains: ["/fixture/user/toolchain"],
  readOnly: [],
};
it.each([
  "/",
  "relative",
  "/fixture/../other",
  "/fixture/line\nbreak",
  "/fixture/null\0byte",
])("rejects invalid project roots without compiling a policy: %s", (root) => {
  expect(() => projectProfile({ ...options, projects: [root] })).toThrowError(
    expect.objectContaining({ code: "TIER_UNAVAILABLE" }),
  );
});
it.each([0, -1, 65536, 1.1, NaN])(
  "rejects a non-port proxy value %s",
  (proxyPort) => {
    expect(() => projectProfile({ ...options, proxyPort })).toThrowError(
      expect.objectContaining({ code: "TIER_UNAVAILABLE" }),
    );
  },
);
it("does not widen a private writable root, snapshot or whole data directory", () => {
  for (const patch of [
    { home: "/fixture/other" },
    { privateRoot: options.dataDir },
    { snapshot: options.privateRoot },
    { privateRoot: options.snapshot },
  ])
    expect(() => projectProfile({ ...options, ...patch })).toThrowError(
      expect.objectContaining({ code: "TIER_UNAVAILABLE" }),
    );
});
it.runIf(supported)(
  "actual Seatbelt diagnostics identify inode and process-group escapes while project admission remains closed",
  async () => {
    const sandbox = new ProjectSandbox(node);
    vi.stubEnv("PLUMS_PROJECT_SENTINEL", "synthetic-parent-variable");
    vi.stubEnv("NODE_OPTIONS", "--require=/plums-fixture-no-such-hook");
    vi.stubEnv("DYLD_INSERT_LIBRARIES", "/plums-fixture-no-such-library");
    try {
      const pending = sandbox.inspect();
      expect(sandbox.inspect()).toBe(pending);
      const report = await pending;
      expect(report).toMatchObject({
        status: "failed",
        ready: false,
        reason: "PROJECT_BOUNDARY_FAILED",
        cleanupCompleted: true,
      });
      expect(report.checks.length).toBeGreaterThan(40);
      for (const id of [
        "nodeChild",
        "readProject",
        "writeProject",
        "writeHome",
        "writeTemporary",
        "writeCache",
        "readSnapshot",
        "fork",
        "shell",
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
        "nestedSandbox",
        "inheritedDescriptors",
        "inheritedEnvironment",
        "noOutsideFiles",
      ])
        expect(
          report.checks.find((c) => c.id === id),
          id,
        ).toEqual({ id, status: "passed" });
      for (const id of [
        "spawnNewGroup",
        "readHardlink",
        "writeHardlink",
        "readLateHardlink",
        "writeLateHardlink",
        "unchanged:outside/hard-data",
        "unchanged:outside/late-hard-data",
      ])
        expect(
          report.checks.find((c) => c.id === id),
          id,
        ).toEqual({ id, status: "failed" });
      expect(Object.isFrozen(report)).toBe(true);
      expect(Object.isFrozen(report.checks)).toBe(true);
      expect(report.checks.every(Object.isFrozen)).toBe(true);
      expect(JSON.stringify(report)).not.toContain("/private/tmp/");
      await expect(sandbox.assertAvailable()).rejects.toMatchObject({
        code: "TIER_UNAVAILABLE",
      });
    } finally {
      await sandbox.close();
      vi.unstubAllEnvs();
    }
  },
);
it.runIf(supported)(
  "missing fixed runtime returns a sanitized failed report and never starts an author program",
  async () => {
    const sandbox = new ProjectSandbox(
      "/private/tmp/plums-no-such-runtime-fixture",
    );
    try {
      expect(await sandbox.inspect()).toMatchObject({
        status: "failed",
        ready: false,
        reason: "PROJECT_SELF_CHECK_FAILED",
        checks: [],
        cleanupCompleted: true,
      });
      await expect(sandbox.assertAvailable()).rejects.toMatchObject({
        code: "TIER_UNAVAILABLE",
      });
    } finally {
      await sandbox.close();
    }
  },
);
it("a diagnostic pass cannot enable a missing project launcher", async () => {
  const sandbox = new ProjectSandbox();
  vi.spyOn(sandbox, "inspect").mockResolvedValue({
    reportVersion: "1.0",
    status: "passed",
    ready: false,
    reason: "PROJECT_RUNTIME_NOT_INTEGRATED",
    platform: process.platform,
    arch: process.arch,
    checks: [],
    cleanupCompleted: true,
  });
  try {
    await expect(sandbox.assertAvailable()).rejects.toMatchObject({
      code: "TIER_UNAVAILABLE",
    });
  } finally {
    await sandbox.close();
    vi.restoreAllMocks();
  }
});
it("closing admission is final and cannot start another diagnostic", async () => {
  const sandbox = new ProjectSandbox();
  await sandbox.close();
  expect(await sandbox.inspect()).toMatchObject({
    reason: "PROJECT_RUNTIME_CLOSED",
    ready: false,
  });
  await expect(sandbox.assertAvailable()).rejects.toMatchObject({
    code: "TIER_UNAVAILABLE",
  });
});
it.runIf(supported)(
  "project CLI reports actual failed boundaries with a nonzero status",
  async () => {
    const run = spawnSync(
      node,
      [
        "scripts/platform-conformance.mjs",
        "--runtime",
        "project",
        "--node",
        node,
      ],
      { env: {}, encoding: "utf8", timeout: 15_000, maxBuffer: 64 * 1024 },
    );
    expect(run.status).toBe(1);
    const report = JSON.parse(run.stdout);
    expect(report).toMatchObject({
      profile: "project",
      status: "failed",
      boundaryStatus: "failed",
      projectAvailable: false,
      reason: "PROJECT_BOUNDARY_FAILED",
      cleanupCompleted: true,
    });
    expect(
      report.cases.find(
        (c: { id: string }) => c.id === "project-runtime-admission",
      ).status,
    ).toBe("failed");
    expect(run.stdout + run.stderr).not.toContain("/private/tmp/");
  },
);
it.runIf(!supported)(
  "project conformance records a skip on other platforms",
  async () => {
    expect(await runProjectConformance()).toMatchObject({
      status: "skipped",
      projectAvailable: false,
      reason: "MACOS_ARM64_REQUIRED",
    });
  },
);
