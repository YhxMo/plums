import { it, expect, beforeAll } from "vitest";
import { readFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createArchive } from "@plums/core";
import { open } from "../../../scripts/platform-conformance-host.mjs";
import { runPlatformConformance } from "../../../scripts/platform-conformance.mjs";
import { inspectPlatformPackage } from "../../../scripts/platform-conformance.mjs";
const reportDirectory = path.resolve(
  process.env.PLUMS_CONFORMANCE_REPORT_DIR ??
    ".artifacts/common-contract/stage-6",
);
beforeAll(() =>
  mkdir(reportDirectory, {
    recursive: true,
  }),
);

it.runIf(process.platform === "darwin").each(["isolate", "controlled-node"])(
  "the public platform suite passes through the actual %s host, SDK and execution boundaries",
  async (runtime) => {
    const report = await runPlatformConformance(await open({ runtime }));
    await writeFile(
      path.join(reportDirectory, `${runtime}-combined.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
    expect(report.cases.filter((c: any) => c.status !== "passed")).toEqual([]);
    expect(report.status).toBe("passed");
    expect(report.thirdPartyAuthorVerified).toBe(false);
  },
  180_000,
);
it("the public suite detects a broken replay implementation without accepting an author claim", async () => {
  const adapter = await open();
  const report = await runPlatformConformance(
    {
      ...adapter,
      provenance: "third-party-conformance",
      async scenario(options: any) {
        const s = await adapter.scenario(options),
          client = s.client;
        s.client = async (...args: any[]) => {
          const c = await client(...args),
            attach = c.sdk.attach;
          c.sdk = {
            ...c.sdk,
            attach: async (...values: any[]) => {
              const call = await attach(...values);
              return {
                ...call,
                result: call.result.then((r: any) => ({ ...r, sequence: 999 })),
              };
            },
          };
          return c;
        };
        return s;
      },
    },
    { caseIds: ["H05-event-order-replay-no-reexecution"] },
  );
  expect(report.status).toBe("failed");
  expect(report.cases[0].failure.code).toBe("ASSERTION_FAILED");
  expect(report.provenance).toBe("adapter-supplied-unverified");
  expect(report.thirdPartyAuthorVerified).toBe(false);
  await writeFile(
    path.join(reportDirectory, "negative-replay.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
});
it("CLI failures return nonzero and a machine report without copying adapter exceptions or physical input paths", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-conformance-cli-"));
  try {
    const adapter = path.join(dir, "adapter.mjs"),
      output = path.join(dir, "report.json");
    await writeFile(
      adapter,
      "export function open(){throw Error('synthetic-private-exception')}",
    );
    const run = spawnSync(
      process.execPath,
      [
        "scripts/platform-conformance.mjs",
        "--adapter",
        adapter,
        "--out",
        output,
      ],
      { encoding: "utf8", cwd: process.cwd() },
    );
    expect(run.status).toBe(1);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      status: "failed",
      failure: { code: "INPUT_OR_ADAPTER_FAILED" },
    });
    expect(run.stdout + run.stderr).not.toContain(
      "synthetic-private-exception",
    );
    expect(run.stdout + run.stderr).not.toContain(dir);
    const unwritable = spawnSync(
      process.execPath,
      [
        "scripts/platform-conformance.mjs",
        "--adapter",
        adapter,
        "--out",
        path.join(adapter, "report.json"),
      ],
      { encoding: "utf8", cwd: process.cwd() },
    );
    expect(unwritable.status).toBe(1);
    expect(JSON.parse(unwritable.stdout).failure.code).toBe(
      "REPORT_WRITE_FAILED",
    );
    expect(unwritable.stdout + unwritable.stderr).not.toContain(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it("package inspection validates declarations without executing package code or claiming behavior compatibility", async () => {
  const dir = await mkdtemp(
    path.join(os.tmpdir(), "plums-conformance-package-"),
  );
  try {
    const file = path.join(dir, "fixture.zip");
    await writeFile(
      file,
      await createArchive({
        "manifest.json": Buffer.from(
          JSON.stringify({
            formatVersion: "2.0",
            id: "static-probe",
            kind: "extension",
            name: "Static probe",
            version: "1.0.0",
            description: "Synthetic",
            dependencies: [],
            permissions: [],
            payload: {
              plumsDesktop: {
                sdkVersion: "2",
                runtime: "main.js",
                common: {
                  commonVersion: "1.0",
                  features: [],
                  runtime: "isolate",
                },
              },
            },
          }),
        ),
        "main.js": Buffer.from("throw Error('must-not-execute')"),
      }),
    );
    const report = await inspectPlatformPackage(file);
    expect(report).toMatchObject({
      status: "passed",
      layer: "structure",
      evidence: "declared",
      behaviorVerified: false,
      thirdPartyAuthorVerified: false,
    });
    await writeFile(file, "invalid zip");
    await expect(inspectPlatformPackage(file)).rejects.toBeDefined();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
