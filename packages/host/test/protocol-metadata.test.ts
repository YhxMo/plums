import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import {
  createArchive,
  MemorySecretStore,
  RecordingEgressSink,
  type ManifestV2,
} from "@plumsjs/core";
import { createAgentBundle, type DesktopContribution } from "@plumsjs/sdk";
import { DesktopHost } from "../src/host.js";

it("does not turn matching protocol claims into a dependency edge in either host or sandbox calls", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-protocol-metadata-"));
  const host = new DesktopHost({
    dataDir: dir,
    egress: new RecordingEgressSink(),
    secretStore: () => new MemorySecretStore(),
  });
  try {
    await host.initialize();
    const provider: DesktopContribution = {
      sdkVersion: "2",
      runtime: "main.js",
      contributes: { tools: [{ name: "memory", title: "Memory" }] },
      protocols: {
        provides: [
          {
            id: "store",
            protocol: "org.plums.examples.memory",
            version: "1.0.0",
            features: ["search"],
            contribution: { kind: "tools", name: "memory" },
          },
        ],
      },
    };
    const consumer: DesktopContribution = {
      sdkVersion: "2",
      runtime: "main.js",
      contributes: { commands: [{ name: "check", title: "Check" }] },
      protocols: {
        requires: [
          {
            id: "learning-memory",
            optional: true,
            protocol: "org.plums.examples.memory",
            range: "^1.0.0",
            features: ["search"],
          },
        ],
      },
    };
    async function archive(
      id: string,
      c: DesktopContribution,
      runtime: string,
      dependencies: ManifestV2["dependencies"] = [],
    ) {
      const manifest: ManifestV2 = {
        formatVersion: "2.0",
        kind: "extension",
        id,
        name: id,
        version: "1.0.0",
        description: "",
        permissions: [],
        dependencies,
        payload: { plumsDesktop: c },
      };
      return createArchive({
        "manifest.json": new TextEncoder().encode(JSON.stringify(manifest)),
        "main.js": new TextEncoder().encode(runtime),
      });
    }
    const memory = await archive(
      "memory",
      provider,
      `export function activate(s) { s.register('tools', 'memory', () => ({records: []})); }`,
    );
    const caller = `export function activate(s) { s.register('commands', 'check', () => s.invoke('memory', 'tools', 'memory', {operation:'search'})); }`;
    const lesson = await archive("lesson", consumer, caller);
    const legacy = await archive(
      "legacy",
      { ...consumer, sdkVersion: "1", protocols: undefined },
      caller,
      [{ id: "memory", kind: "extension", range: "^1.0.0" }],
    );
    const bytes = await createAgentBundle(
      {
        bundleVersion: "1.0",
        id: "test",
        name: "Test",
        version: "1.0.0",
        extensions: ["memory.zip", "lesson.zip", "legacy.zip"],
        connectors: [],
      },
      { "memory.zip": memory, "lesson.zip": lesson, "legacy.zip": legacy },
    );
    const preview = (await host.preview(bytes)) as { token: string };
    const agent = await host.install(preview.token);
    for (const id of ["memory", "lesson", "legacy"])
      await host.enable(agent.instanceId, id);
    await expect(
      host.invoke(agent.instanceId, "lesson", "memory", "tools", "memory", {}),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(
      host.invoke(
        agent.instanceId,
        "lesson",
        "lesson",
        "commands",
        "check",
        {},
      ),
    ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(
      await host.invoke(
        agent.instanceId,
        "legacy",
        "legacy",
        "commands",
        "check",
        {},
      ),
    ).toEqual({ records: [] });
  } finally {
    await host.close();
    await rm(dir, { recursive: true, force: true });
  }
});
