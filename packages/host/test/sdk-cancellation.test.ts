import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createCore,
  MemorySecretStore,
  RecordingFsSink,
  type CapabilityRequest,
  type Core,
  type ManifestV2,
} from "@plumsjs/core";
import { dispatchSdk } from "../src/sdk-bridge.js";
import { ioContext } from "../src/io.js";
import type { Session } from "../src/host.js";

const fixtures: { core: Core; dir: string }[] = [];
afterEach(async () => {
  for (const { core, dir } of fixtures.splice(0)) {
    core.close();
    await rm(dir, { recursive: true, force: true });
  }
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function fixture(phase: "confirm" | "io") {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-sdk-cancel-"));
  const entered = deferred<void>();
  let sends = 0;
  const blocked = async () => {
    sends++;
    const signal = ioContext.getStore()!.signal;
    entered.resolve();
    return new Promise<never>((_, reject) => {
      const cancel = () => reject(Error("Cancelled fixture I/O"));
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
    });
  };
  const fs = new RecordingFsSink();
  fs.read = blocked;
  const secrets = new MemorySecretStore();
  const core = createCore({
    dataDir: path.join(dir, "core"),
    secrets,
    roots: { workspace: dir },
    fs,
    egress: { send: blocked },
    confirm: {
      async ask() {
        if (phase !== "confirm") return true;
        const signal = ioContext.getStore()!.signal;
        entered.resolve();
        return new Promise<boolean>((resolve) => {
          if (signal.aborted) resolve(false);
          else
            signal.addEventListener("abort", () => resolve(false), {
              once: true,
            });
        });
      },
    },
    onAudit: async () => {},
  });
  fixtures.push({ core, dir });
  await writeFile(path.join(dir, "data.bin"), "fixture");
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id: "caller",
    name: "Caller",
    version: "1.0.0",
    description: "fixture",
    dependencies: [],
    payload: {},
    permissions: [
      {
        id: "network",
        kind: "egress",
        target: "example.com",
        reason: "fixture",
      },
      {
        id: "files",
        kind: "fs",
        target: "workspace",
        operations: ["read"],
        reason: "fixture",
      },
    ],
  };
  await core.importPackage(await core.exportPackage({ manifest }));
  await core.grantConsent(manifest.id);
  await core.enable(manifest.id);
  const session: Session = {
    core,
    secrets,
    controller: new AbortController(),
    runtimes: new Map(),
    mcpTools: new Map(),
    engineController: new AbortController(),
    engineRuntimes: new Map(),
    receipts: new Map(),
    record: {
      instanceId: "fixture",
      name: "Fixture",
      createdAt: "fixture",
      roots: {},
      agent: {
        bundleVersion: "1.0",
        id: "fixture",
        name: "Fixture",
        version: "1.0.0",
        extensions: [],
        connectors: [],
      },
    },
  };
  const invocation = new AbortController();
  const call = (request: CapabilityRequest) =>
    dispatchSdk(
      session,
      "caller",
      "capability",
      {
        permissionId: request.kind === "fs" ? "files" : "network",
        request,
      },
      { callers: [], ancestry: ["caller"], signal: invocation.signal },
      {
        secretValues: async () => [],
        event: undefined,
        active: () => {},
        audit: async () => {},
        engine: async () => {
          throw Error("No engine runtime");
        },
        invoke: async () => {
          throw Error("No delegated runtime");
        },
      },
    );
  return { call, entered, invocation, session, sends: () => sends };
}
const network: CapabilityRequest = {
  kind: "egress",
  url: "https://example.com/fixture",
};
const files: CapabilityRequest = {
  kind: "fs",
  operation: "read",
  path: "data.bin",
};

it.each(["invocation", "session"] as const)(
  "rejects a %s cancelled before the SDK call",
  async (source) => {
    const f = await fixture("io");
    (source === "invocation" ? f.invocation : f.session.controller).abort();
    await expect(f.call(network)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
    });
    expect(f.sends()).toBe(0);
  },
);
it.each(["invocation", "session"] as const)(
  "cancels confirmation when the %s ends without calling a sink",
  async (source) => {
    const f = await fixture("confirm");
    const result = f.call(network).catch((error) => error);
    await Promise.race([
      f.entered.promise,
      result.then((error) => {
        throw error;
      }),
    ]);
    (source === "invocation" ? f.invocation : f.session.controller).abort();
    expect(await result).toMatchObject({ code: "CONFIRMATION_DENIED" });
    expect(f.sends()).toBe(0);
  },
);
it.each([
  ["invocation", network],
  ["session", network],
  ["invocation", files],
  ["session", files],
] as const)("cancels pending %s I/O for %j", async (source, request) => {
  const f = await fixture("io");
  const result = f.call(request).catch((error) => error);
  await Promise.race([
    f.entered.promise,
    result.then((error) => {
      throw error;
    }),
  ]);
  (source === "invocation" ? f.invocation : f.session.controller).abort();
  expect(await result).toMatchObject({ code: "CAPABILITY_FAILED" });
  expect(f.sends()).toBe(1);
});
