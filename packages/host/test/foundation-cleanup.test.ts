import { afterEach, expect, it, vi } from "vitest";
import { createArchive, validatePackage } from "@plumsjs/core";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import {
  createFoundationSession,
  FoundationRegistry,
  registerLibraryFoundation,
  startFoundationSession,
} from "../src/index.js";
import { ControlledExecution } from "../src/controlled-execution.js";
import type { ComponentLibrary } from "../src/library.js";
vi.mock("node:fs/promises", async (original) => {
  const fs = await original<typeof import("node:fs/promises")>();
  return { ...fs, rm: vi.fn(fs.rm) };
});
afterEach(() => vi.restoreAllMocks());
const requirement = {
  requirementVersion: "1.0",
  protocolRange: "^1.0.0",
  sdk: { id: "org.plums.sdk", version: "2.0.0" },
  features: ["sdk.register"],
};
async function fixture() {
  const manifest = (id: string, payload: unknown) => ({
    formatVersion: "2.0",
    kind: "extension",
    id,
    name: id,
    version: "1.0.0",
    description: "Internal cleanup fault fixture",
    dependencies: [],
    permissions: [],
    payload,
  });
  const provider = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify(
        manifest("org.example.cleanup", {
          plumsFoundation: {
            declarationVersion: "1.0",
            id: "org.example.cleanup",
            foundationVersion: "1.0",
            entry: "provider.mjs",
            execution: "controlled-node",
            platforms: ["darwin-arm64"],
            features: ["session.invoke", "session.callback", "session.cancel"],
            hostFeatures: [],
            sdks: [
              {
                id: "org.plums.sdk",
                range: "^2.0.0",
                features: ["sdk.register"],
              },
            ],
          },
        }),
      ),
    ),
    "provider.mjs": Buffer.from("throw Error('must never execute')"),
  });
  const component = await createArchive({
    "manifest.json": Buffer.from(
      JSON.stringify(
        manifest("consumer", {
          plumsDesktop: {
            sdkVersion: "2",
            runtime: "main.js",
            foundation: requirement,
            contributes: { commands: [{ name: "check", title: "Check" }] },
          },
        }),
      ),
    ),
    "main.js": Buffer.from("export function activate() {}"),
  });
  const selection = {
    selectionVersion: "1.0",
    source: "library" as const,
    id: "org.example.cleanup",
    version: "1.0.0",
    digest: createHash("sha256").update(provider).digest("hex"),
  };
  return { provider, component, selection };
}
it.each(["archive", "library"])(
  "retains failed prelaunch snapshot cleanup through the public %s lifecycle",
  async (route) => {
    const f = await fixture();
    let withdrawn = false;
    const cleanup = vi.fn(async () => {
      throw Error("private snapshot path and secret");
    });
    vi.spyOn(ControlledExecution.prototype, "prepare").mockImplementation(
      async () => {
        withdrawn = true;
        return {
          node: process.execPath,
          snapshot: "/synthetic-snapshot",
          scratch: "/synthetic-work",
          cleanup,
        };
      },
    );
    const bridge = vi.fn(async () => ({}));
    const assertActive = async () => {
      if (withdrawn) throw Error("installation withdrawn");
    };
    let session:
      | Awaited<ReturnType<typeof createFoundationSession>>
      | undefined;
    const start = async () => {
      if (route === "archive") {
        await startFoundationSession({
          nodePath: process.execPath,
          provider: { archive: f.provider, selection: f.selection },
          component: {
            archive: f.component,
            agentId: "agent",
            installationId: "install",
          },
          requirement,
          assertActive,
          bridge,
        });
      } else {
        const registry = new FoundationRegistry();
        const contents = await validatePackage(f.provider);
        const reference = await registerLibraryFoundation(
          registry,
          {
            get: async () => ({ bytes: f.provider, contents }),
          } as unknown as ComponentLibrary,
          f.selection,
          { nodePath: process.execPath },
        );
        session = await createFoundationSession(registry, reference, {
          component: await validatePackage(f.component),
          actor: {
            agentId: "agent",
            installationId: "install",
            componentId: "consumer",
            componentVersion: "1.0.0",
            componentDigest: createHash("sha256")
              .update(f.component)
              .digest("hex"),
          },
          assertActive,
          assertCurrent: () => {},
          bridge,
        });
        await session.ready();
      }
    };
    const error = await start().catch((e) => e);
    expect(error).toMatchObject({
      code: "CAPABILITY_FAILED",
      details: { reason: "CLEANUP_FAILED", executionState: "not_started" },
    });
    expect(JSON.stringify(error)).not.toContain("private snapshot");
    if (session) {
      await expect(session.close()).rejects.toMatchObject({
        details: { reason: "CLEANUP_FAILED" },
      });
      await expect(session.close()).rejects.toMatchObject({
        details: { reason: "CLEANUP_FAILED" },
      });
    }
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(bridge).not.toHaveBeenCalled();
  },
);
it("keeps a failed preparation deletion observable after the snapshot probe rejects", async () => {
  const execution = new ControlledExecution(process.execPath);
  const internals = execution as unknown as {
    fixedRuntime(): Promise<string>;
    probe(node: string, root: string): Promise<void>;
  };
  vi.spyOn(internals, "fixedRuntime").mockResolvedValue(process.execPath);
  let root = "";
  vi.spyOn(internals, "probe").mockImplementation(async (_node, directory) => {
    root = directory;
    throw Error("private probe failure");
  });
  vi.mocked(rm).mockRejectedValueOnce(Error("private deletion failure"));
  const realFs =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  try {
    await expect(execution.prepare({})).rejects.toBeDefined();
    await expect(execution.close()).rejects.toBeDefined();
    await expect(execution.close()).rejects.toBeDefined();
    expect(rm).toHaveBeenCalledTimes(1);
  } finally {
    // The injected failure created no process. Remove only this test's real empty root.
    if (root) await realFs.rm(root, { recursive: true, force: true });
  }
});
