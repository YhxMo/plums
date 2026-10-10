import { afterEach, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import { createArchive, type ManifestV2 } from "@plumsjs/core";
import { fixture } from "./common-fixture.js";
import { addPolicy, select, grant } from "./policy-fixture.js";
import { DesktopHost } from "../src/host.js";
const hosts: DesktopHost[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((h) => h.close()));
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
it("MCP remains fingerprint-approved and its policy decision occurs before the actual remote tool transport", async () => {
  const f = await fixture();
  hosts.push(f.host);
  dirs.push(f.dir);
  let sent = 0;
  (f.options as any).egress = {
    send: async () => {
      sent++;
      return { status: 200, body: "mcp-fixture-response" };
    },
  };
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    id: "mcp-fixture",
    kind: "connector",
    name: "MCP fixture",
    version: "1.0.0",
    description: "Internal remote tool fixture",
    dependencies: [],
    permissions: [
      {
        id: "net",
        kind: "egress",
        target: "example.com",
        reason: "Fixture remote tool",
      },
    ],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        common: {
          commonVersion: "1.0",
          features: ["policy-v1"],
          runtime: "isolate",
        },
        contributes: {
          commands: [{ name: "remote", title: "Remote fixture" }],
        },
      },
    },
  };
  const code = `export function activate(s){s.register('commands','remote',async i=>{const tool={name:'echo',description:i.description||'Fixture tool',inputSchema:{type:'object'}};if(i.check)return s.mcpCheck([tool]);return s.capability('net',{kind:'egress',url:'https://example.com/fixture',method:'POST',body:'mcp-fixture-body'},tool);});}`;
  const preview = (await f.host.preview(
    await createArchive({
      "manifest.json": Buffer.from(JSON.stringify(manifest)),
      "main.js": Buffer.from(code),
    }),
  )) as { token: string };
  await f.host.addLibraryComponent(
    f.a.instanceId,
    (await f.host.importLibrary(preview.token)).digest,
  );
  await f.host.enable(f.a.instanceId, "mcp-fixture");
  await addPolicy(f.host, f.a.instanceId, "allow");
  await addPolicy(
    f.host,
    f.a.instanceId,
    "mcpdeny",
    `return decision(c.intent.tool?'deny':'allow');`,
  );
  const invoke = (input = {}) =>
    f.host.invoke(
      f.a.instanceId,
      "mcp-fixture",
      "mcp-fixture",
      "commands",
      "remote",
      input,
    );
  const approve = async () => {
    await invoke({ check: true });
    await f.host.approveMcp(f.a.instanceId, "mcp-fixture", "net", [
      {
        name: "echo",
        description: "Fixture tool",
        inputSchema: { type: "object" },
      },
    ]);
  };
  await select(f.host, f.a.instanceId, "mcpdeny");
  await approve();
  await grant(f.host, f.a.instanceId);
  await expect(invoke()).rejects.toMatchObject({
    details: { reason: "NOT_AUTHORIZED", executionState: "not_started" },
  });
  expect(sent).toBe(0);
  await select(f.host, f.a.instanceId, "allow");
  await approve();
  await grant(f.host, f.a.instanceId);
  expect(await invoke()).toMatchObject({
    kind: "egress",
    result: { status: 200 },
  });
  expect(sent).toBe(1);
  await expect(invoke({ description: "Changed tool" })).rejects.toMatchObject({
    code: "CONSENT_REQUIRED",
  });
  expect(sent).toBe(1);
});
