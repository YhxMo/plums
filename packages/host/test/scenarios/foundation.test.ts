import { afterAll, expect, it, vi } from "vitest";
import { mkdir, writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  runScenarioSdkConformance,
  SDK_CASE_IDS,
  independentArchive,
} from "../../../../scripts/scenario-sdk-conformance.mjs";
import { FoundationRegistry } from "../../src/foundation-factory.js";
import { ControlledExecution } from "../../src/controlled-execution.js";
import { FoundationRegistry as BuiltFoundationRegistry } from "../../dist/index.js";
import { ControlledExecution as BuiltControlledExecution } from "../../dist/controlled-execution.js";
import { chatFixture } from "./chat-fixture.js";
import { fixtureManifest, packExtension } from "../fixtures/extensions/pack.js";
import { scenarioFoundation } from "./foundation-selection.js";

const directory = path.resolve(".build-cache/scenarios");
const nodePath = path.resolve(
  ".build-cache/node-v26.5.1-darwin-arm64/bin/node",
);
const reports = new Map<string, any>();
const supported = new Set([
  "register",
  "settings",
  "context",
  "capability.fs.read",
  "capability.fs.write",
  "capability.fs.list",
  "capability.exec",
  "contribution.schema",
]);
afterAll(async () => {
  await mkdir(directory, { recursive: true });
  for (const [profile, report] of reports) {
    report.cases.sort(
      (a: any, b: any) =>
        SDK_CASE_IDS.indexOf(a.id) - SDK_CASE_IDS.indexOf(b.id),
    );
    report.status = report.cases.every((row: any) => row.status === "passed")
      ? "passed"
      : "failed";
    report.coverage =
      report.cases.length === SDK_CASE_IDS.length ? "complete" : "partial";
    await writeFile(
      path.join(directory, `scenario-foundation-${profile}.json`),
      JSON.stringify(report, null, 2) + "\n",
    );
  }
  const official = reports.get("builtin"),
    independent = reports.get("independent");
  if (official && independent) {
    expect(official.cases.map((c: any) => c.componentDigest)).toEqual(
      independent.cases.map((c: any) => c.componentDigest),
    );
    expect(official.suiteDigest).toBe(independent.suiteDigest);
  }
});
for (const foundation of ["builtin", "independent"] as const) {
  it
    .runIf(process.platform === "darwin" && process.arch === "arm64")
    .each(SDK_CASE_IDS)(
    `${foundation} executes or refuses the same SDK case %s according to its declared features`,
    async (id: string) => {
      const errors: unknown[] = [];
      const create = vi.spyOn(BuiltFoundationRegistry.prototype, "create");
      const launch = vi.spyOn(
        BuiltControlledExecution.prototype,
        "launchFoundation",
      );
      let report;
      try {
        report = await runScenarioSdkConformance({
          foundation,
          nodePath,
          caseIds: [id],
          onFailure: (error: unknown) => errors.push(error),
        });
        if (foundation === "independent" && !supported.has(id)) {
          expect(create).not.toHaveBeenCalled();
          expect(launch).not.toHaveBeenCalled();
        }
      } finally {
        create.mockRestore();
        launch.mockRestore();
      }
      if (!reports.has(foundation))
        reports.set(foundation, { ...report, cases: [] });
      const combined = reports.get(foundation);
      combined.cases.push(...report.cases);
      expect(errors).toEqual([]);
      expect(report.status).toBe("passed");
      expect(report.foundation).toMatchObject({
        selectionVersion: "1.0",
        source: foundation === "builtin" ? "builtin" : "library",
        id:
          foundation === "builtin"
            ? "org.plums.foundation"
            : "fixture.independent-foundation",
        version: "1.0.0",
        digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      expect(report.foundation).toEqual(combined.foundation);
      expect(report.suiteVersion).toBe("1.0.0");
      expect(report.publicEvidence).toBe("declared");
      expect(report.thirdPartyAuthorVerified).toBe(false);
      expect(report.cases).toHaveLength(1);
      expect(report.cases[0].expectation).toBe(
        foundation === "builtin" || supported.has(id)
          ? "execute-supported"
          : "reject-before-start",
      );
    },
  );
}

const expectedFeatures = {
  "card-parser": ["register", "character", "characters"],
  "card-parser-alt": ["register", "character", "characters"],
  "model-fake": ["register", "connection", "capability", "failResponse"],
  "agent-loop": ["register", "resources", "protocols"],
  memory: ["register", "resources", "engine"],
  tavern: ["register", "protocols"],
  "machine-probe": ["register", "engine"],
  "machine-probe-b": ["register", "engine"],
  "mcp-bridge": [
    "register",
    "connection",
    "capability",
    "failResponse",
    "mcpCheck",
  ],
};
it("the scenario archive selector pins the independent artifact and refuses unsupported chat before any invocation", async () => {
  const owner = await chatFixture();
  let selected: Awaited<ReturnType<typeof chatFixture>> | undefined;
  try {
    const archive = path.join(owner.directory, "independent.zip");
    await writeFile(archive, await independentArchive());
    vi.stubEnv("PLUMS_SCENARIO_FOUNDATION_ARCHIVE", archive);
    selected = await chatFixture();
    const selection = await scenarioFoundation(selected.host);
    expect(selection.source).toBe("library");
    expect(selection.id).toBe("fixture.independent-foundation");
    await expect(selected.create()).rejects.toMatchObject({
      details: {
        reason: "FOUNDATION_INCOMPATIBLE",
        executionState: "not_started",
      },
    });
    expect(await selected.host.listAgents()).toEqual([]);
    expect(selected.egress.records).toHaveLength(0);
  } finally {
    vi.unstubAllEnvs();
    await selected?.close();
    await owner.close();
  }
});
it("the SDK CLI returns a partial identity report and sanitized nonzero input/write failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "plums-sdk-cli-"));
  try {
    const output = path.join(root, "report.json");
    const command = (args: string[]) =>
      spawnSync(
        process.execPath,
        ["scripts/scenario-sdk-conformance.mjs", ...args],
        { encoding: "utf8", timeout: 15_000 },
      );
    const good = command([
      "--foundation",
      "builtin",
      "--case",
      "register",
      "--out",
      output,
    ]);
    expect(good.status).toBe(0);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      status: "passed",
      coverage: "partial",
      suiteVersion: "1.0.0",
      foundation: { id: "org.plums.foundation", source: "builtin" },
    });
    const invalid = command([
      "--out",
      output,
      "--unknown",
      "synthetic-private-cli-input",
    ]);
    expect(invalid.status).toBe(1);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      status: "failed",
      failure: { code: "INPUT_OR_REPORT_FAILED" },
    });
    expect(invalid.stdout + invalid.stderr).not.toContain(
      "synthetic-private-cli-input",
    );
    expect(invalid.stdout + invalid.stderr).not.toContain(root);
    const denied = command([
      "--case",
      "register",
      "--out",
      path.join(output, "child.json"),
    ]);
    expect(denied.status).toBe(1);
    expect(JSON.parse(denied.stdout).failure.code).toBe("REPORT_WRITE_FAILED");
    expect(denied.stdout + denied.stderr).not.toContain(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each(Object.keys(expectedFeatures))(
  "%s declares its actual SDK needs and is refused by the limited independent foundation before launch or official fallback",
  async (name) => {
    const f = await chatFixture();
    try {
      const manifest = await fixtureManifest(name);
      expect(
        (manifest.payload as any).plumsDesktop.foundation.features,
      ).toEqual(
        expectedFeatures[name as keyof typeof expectedFeatures].map(
          (s) => `sdk.${s}`,
        ),
      );
      const artifact = await f.put(await independentArchive());
      const selection = (await f.host.listFoundations()).find(
        (p) => p.selection.digest === artifact.digest,
      )!.selection;
      if (!f.artifacts.has(name))
        f.artifacts.set(name, await f.put(await packExtension(name)));
      const digests = [f.artifacts.get(name)!.digest];
      if (name === "machine-probe")
        digests.push(f.artifacts.get("model-fake")!.digest);
      if (name === "agent-loop")
        digests.push(f.artifacts.get("model-fake")!.digest);
      if (name === "tavern")
        digests.push(f.artifacts.get("card-parser")!.digest);
      const launch = vi.spyOn(
        ControlledExecution.prototype,
        "launchFoundation",
      );
      const create = vi.spyOn(FoundationRegistry.prototype, "create");
      try {
        await expect(
          f.host.createAgent(
            "Unsupported scenario",
            digests,
            undefined,
            undefined,
            [],
            {
              requirement: {
                requirementVersion: "1.0",
                protocolRange: "^1.0.0",
                sdk: { id: "org.plums.sdk", version: "2.0.0" },
                features: ["sdk.register"],
              },
              selection,
            },
          ),
        ).rejects.toMatchObject({
          code: "CAPABILITY_FAILED",
          details: {
            reason: "FOUNDATION_INCOMPATIBLE",
            executionState: "not_started",
          },
        });
        expect(create).not.toHaveBeenCalled();
        expect(launch).not.toHaveBeenCalled();
        expect(await f.host.listAgents()).toEqual([]);
        expect(f.egress.records).toHaveLength(0);
      } finally {
        create.mockRestore();
        launch.mockRestore();
      }
    } finally {
      await f.close();
    }
  },
);
