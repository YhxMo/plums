import { afterEach, expect, it } from "vitest";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  collectProfile,
  controlledProbe,
  parseMacosMajor,
  profileSummary,
  runCommand,
} from "../ci-platform-profile.mjs";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("records only fixed failure codes when loading or cleaning the real host probe fails", async () => {
  const loading = await controlledProbe(async () => {
    throw Object.assign(Error("synthetic-private-path-and-secret"), {
      code: "CAPABILITY_FAILED",
      details: {
        reason: "RUNTIME_UNAVAILABLE",
        path: "synthetic-private-path",
      },
    });
  });
  expect(loading).toEqual({
    status: "failed",
    failure: { code: "CAPABILITY_FAILED", reason: "RUNTIME_UNAVAILABLE" },
  });
  const cleaning = await controlledProbe(async () => ({
    scenario: async () => ({
      client: async () => ({
        sdk: {
          binding: async () => ({ handle: "synthetic" }),
          invoke: async () => ({
            result: Promise.resolve({
              executionState: "completed",
              outcome: {
                ok: true,
                value: {
                  result: { exitCode: 0, stdout: "synthetic-private-output" },
                },
              },
            }),
          }),
        },
      }),
      close: async () => {
        throw Error("synthetic-private-cleanup-secret");
      },
    }),
  }));
  expect(cleaning).toEqual({
    status: "failed",
    failure: { code: "PROBE_CLEANUP_FAILED", reason: null },
  });
  expect(JSON.stringify([loading, cleaning])).not.toContain(
    "synthetic-private",
  );
});

it.each([
  ["15.7.9", 15],
  ["27.0.1\n", 27],
  ["27.0", 27],
  ["unavailable", null],
  ["15x7.9", null],
])("parses the macOS major from %s", (version, expected) => {
  expect(parseMacosMajor(version)).toBe(expected);
});

it("records command failures, signals and original output instead of rejecting", async () => {
  const result = await runCommand(
    "fixed-probe",
    [],
    {},
    (_file: string, _args: string[], options: any, callback: any) => {
      expect(options.timeout).toBe(10_000);
      callback(
        { code: 9, signal: "SIGKILL", killed: true },
        "raw stdout\n",
        "raw stderr\n",
      );
    },
  );
  expect(result).toEqual({
    status: 9,
    signal: "SIGKILL",
    stdout: "raw stdout\n",
    stderr: "raw stderr\n",
    errorCode: null,
    killed: true,
  });
  await expect(
    runCommand("missing-probe", [], {}, () => {
      throw Object.assign(Error("missing"), { code: "ENOENT" });
    }),
  ).resolves.toMatchObject({ status: null, errorCode: "ENOENT" });
});

it("preserves the report schema and failed probes and removes its temporary snapshot", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-profile-test-"),
  );
  directories.push(directory);
  const sourceProgram = path.join(directory, "synthetic-command");
  await writeFile(sourceProgram, "synthetic bytes");
  const seen: { file: string; args: string[]; options: any }[] = [];
  const profile = await collectProfile({
    temporaryDirectory: directory,
    sourceProgram,
    scanReports: async () => ({ files: ["synthetic.ips"], errorCode: null }),
    run: async (file: string, args: string[], options: any) => {
      seen.push({ file, args, options });
      const stdout =
        file.endsWith("sw_vers") && args.includes("-productVersion")
          ? "15.7.9\n"
          : file.endsWith("sysctl")
            ? "7516192768\n3\n3\n"
            : args.some((arg) => arg.includes("heap_size_limit"))
              ? "2048\n"
              : "raw output\n";
      return {
        status: file.endsWith("codesign") ? 1 : 0,
        signal: null,
        stdout,
        stderr: "raw error\n",
        errorCode: null,
        killed: false,
      };
    },
  });
  expect(profile).toMatchObject({
    schemaVersion: 1,
    macosMajor: 15,
    resources: {
      memsizeBytes: 7516192768,
      ncpu: 3,
      physicalcpu: 3,
      defaultHeapLimitMiB: 2048,
    },
    diagnosticReports: { files: ["synthetic.ips"] },
  });
  expect(profile.commands.snapshotResign).toMatchObject({
    status: 1,
    stdout: "raw output\n",
    stderr: "raw error\n",
  });
  expect(profile.commands).toHaveProperty("controlledHost");
  expect(
    seen.find((probe) => probe.args.includes("--controlled-probe"))?.options
      .timeout,
  ).toBe(30_000);
  expect(
    seen.find((probe) => probe.file.endsWith("/log"))?.options.timeout,
  ).toBe(30_000);
  expect(await readdir(directory)).toEqual(["synthetic-command"]);
  expect(JSON.parse(JSON.stringify(profile))).toEqual(profile);
  expect(profileSummary(profile)).toContain("| snapshotResign | 1 |");
});
