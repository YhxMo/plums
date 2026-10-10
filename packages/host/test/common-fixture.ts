import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  createArchive,
  MemorySecretStore,
  type ManifestV2,
  type AuditEvent,
} from "@plumsjs/core";
import { DesktopHost } from "../src/host.js";
import { SecureFsSink } from "../src/io.js";
import { createCommonPlatformSdk } from "@plumsjs/sdk";
const standalone = path.resolve(
  ".build-cache/node-v26.5.1-darwin-arm64/bin/node",
);
export async function fixture(
  runtime: "isolate" | "controlled-node" = "isolate",
  source?: string,
  permissions: ManifestV2["permissions"] = [],
  providerCommands: { name: string; title: string }[] = [],
) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-common-runtime-"));
  const audit: AuditEvent[] = [];
  const options = {
    dataDir: dir,
    nodePath: standalone,
    fs: new SecureFsSink(path.resolve("packages/host/dist/secure-fs")),
    confirm: { ask: async () => true },
    secretStore: () => new MemorySecretStore(),
    audit: async (_id: string, e: Readonly<AuditEvent>) => {
      audit.push(e);
    },
  };
  const host = new DesktopHost(options);
  await host.initialize();
  const digests: string[] = [];
  for (const id of ["consumer", "provider", "viewer"]) {
    const manifest: ManifestV2 = {
      formatVersion: "2.0",
      id,
      kind: "extension",
      name: id,
      version: "1.0.0",
      description: "Internal platform fixture",
      dependencies: [],
      permissions,
      payload: {
        plumsDesktop: {
          sdkVersion: "2",
          runtime: "main.js",
          frontend: id !== "provider" ? "index.html" : undefined,
          common: {
            commonVersion: "1.0",
            features: ["events", "task-attach"],
            runtime: id === "provider" ? runtime : "isolate",
            background: true,
          },
          contributes:
            id !== "provider"
              ? { commands: [{ name: "run", title: "Run" }] }
              : {
                  tools: [{ name: "test", title: "Test" }],
                  commands: providerCommands,
                },
          protocols:
            id !== "provider"
              ? {
                  requires: [
                    {
                      id: "backend",
                      protocol: "org.example.fixture",
                      range: "^1.0.0",
                      optional: true,
                    },
                  ],
                }
              : {
                  provides: [
                    {
                      id: "test",
                      protocol: "org.example.fixture",
                      version: "1.0.0",
                      contribution: { kind: "tools", name: "test" },
                    },
                  ],
                },
        },
      },
    };
    const code =
      id === "viewer"
        ? `export function activate(s){s.register('commands','run',i=>s.common.tasks.status(i.taskId));}`
        : id === "consumer"
          ? `export function activate(s){s.register('commands','run',async i=>{const b=await s.common.binding('backend');const call=await s.common.invoke(b.handle,'echo',i);return call.result;});}`
          : (source ??
            `export function activate(s){s.register('tools','test',async v=>{if(v.operation==='events'){for(let i=0;i<v.input.count;i++)await s.emit('progress',{i});}if(v.operation==='hang')await new Promise(()=>{});return {value:v.input};});}`);
    const preview = (await host.preview(
      await createArchive({
        "manifest.json": Buffer.from(JSON.stringify(manifest)),
        "main.js": Buffer.from(code),
        "index.html": Buffer.from(
          "<!doctype html><title>Common fixture</title>",
        ),
      }),
    )) as { token: string };
    digests.push((await host.importLibrary(preview.token)).digest);
  }
  const plan = await host.planAssembly(digests);
  const selections = plan.protocols.map((p) => p.candidates[0]!.intent);
  const a = await host.createAgent(
    "Fixture A",
    digests,
    undefined,
    undefined,
    selections,
  );
  const b = await host.createAgent(
    "Fixture B",
    digests,
    undefined,
    undefined,
    selections,
  );
  for (const agent of [a, b]) {
    await host.enable(agent.instanceId, "provider");
    await host.enable(agent.instanceId, "consumer");
    await host.enable(agent.instanceId, "viewer");
  }
  await host.setStartup(a.instanceId, "consumer");
  await host.setStartup(b.instanceId, "consumer");
  const frontend = await host.openFrontend(a.instanceId);
  if (!frontend) throw Error();
  const call = (method: string, args: Record<string, unknown> = {}) =>
    host.frontendCommon(
      frontend.context.sessionId,
      frontend.context.handle,
      method,
      args,
    );
  const sdk = createCommonPlatformSdk(call, {
    list: async () => [],
    read: async () => ({ exists: false, revision: "0" }),
    write: async () => ({ revision: "0" }),
    delete: async () => ({ revision: "0" }),
  });
  return { host, options, a, b, frontend, call, sdk, audit, dir };
}
