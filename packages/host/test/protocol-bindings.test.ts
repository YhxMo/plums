import { afterEach, expect, it, vi } from "vitest";
import * as sdk from "@plumsjs/sdk";
import type { Core, ManifestV2 } from "@plumsjs/core";
import {
  assemblyProtocols,
  fixProtocolBinding,
  protocolPlan,
} from "../src/protocol-bindings.js";
import type { AgentRecord } from "../src/host.js";
import type { LibraryItem } from "../src/library.js";
afterEach(() => vi.restoreAllMocks());
function component(
  id: string,
  requires: string[],
  provides: string[],
): LibraryItem {
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "extension",
    id,
    name: id,
    version: "1.0.0",
    dependencies: [],
    permissions: [],
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        contributes: { commands: [{ name: "run", title: "Synthetic" }] },
        protocols: {
          requires: requires.map((protocol) => ({
            id: protocol.split(".").at(-1),
            protocol,
            range: "^1.0.0",
          })),
          provides: provides.map((protocol) => ({
            id: protocol.split(".").at(-1),
            protocol,
            version: "1.0.0",
            contribution: { kind: "commands", name: "run" },
          })),
        },
      },
    },
  };
  return { digest: id.padEnd(64, "0"), manifest, createdAt: "synthetic" };
}
it("protocol discovery parses each component's desktop contribution once per query", () => {
  const items = Array.from({ length: 4 }, (_, i) =>
    component("component-" + i, ["org.example.shared"], ["org.example.shared"]),
  );
  const parse = vi.spyOn(sdk, "desktopContribution");
  const states = assemblyProtocols(items);
  expect(states).toHaveLength(items.length);
  expect(states.every((s) => s.candidates.length === items.length - 1)).toBe(
    true,
  );
  expect(parse).toHaveBeenCalledTimes(items.length);
});
it("two consecutive queries re-parse and observe a changed manifest", () => {
  const items = [
    component("consumer", ["org.example.shared"], []),
    component("provider", [], ["org.example.shared"]),
  ];
  const parse = vi.spyOn(sdk, "desktopContribution");
  expect(assemblyProtocols(items)[0].state).toBe("unbound");
  (
    items[1].manifest.payload as any
  ).plumsDesktop.protocols.provides[0].protocol = "org.example.changed";
  expect(assemblyProtocols(items)[0]).toMatchObject({
    state: "missing",
    candidates: [],
  });
  expect(parse).toHaveBeenCalledTimes(items.length * 2);
});
it("discovery order and states are unchanged", async () => {
  const items = [
    component(
      "consumer",
      [
        "org.example.bound",
        "org.example.choose",
        "org.example.missing",
        "org.example.stale",
      ],
      [],
    ),
    component(
      "first",
      [],
      ["org.example.bound", "org.example.choose", "org.example.stale"],
    ),
    component("second", [], ["org.example.choose"]),
  ];
  // Fake only the public Core reads used by protocolPlan; no I/O or execution.
  const installed = items.map((i) => ({
    id: i.manifest.id,
    installedAt: "synthetic",
    enabled: true,
  }));
  const core = {
    listInstalled: async () => structuredClone(installed),
    getPackage: async (id: string) => ({
      manifest: structuredClone(
        items.find((i) => i.manifest.id === id)!.manifest,
      ),
      installed: installed.find((i) => i.id === id)!,
    }),
  } as unknown as Core;
  const record = {
    instanceId: "synthetic-agent",
    name: "Synthetic",
    agent: { startup: [] },
    roots: {},
    createdAt: "synthetic",
    components: items.map((i) => ({
      packageId: i.manifest.id,
      digest: i.digest,
      kind: i.manifest.kind,
      version: i.manifest.version,
    })),
  } as AgentRecord;
  const initial = (await protocolPlan(core, record)).requirements;
  record.protocolBindings = await Promise.all(
    [0, 3].map((i) =>
      fixProtocolBinding(core, record, initial[i].candidates[0].intent),
    ),
  );
  record.protocolBindings[1].providerDigest = "changed";
  const states = (await protocolPlan(core, record)).requirements;
  expect(states.map((s) => [s.requirement.id, s.state])).toEqual([
    ["bound", "bound"],
    ["choose", "choose"],
    ["missing", "missing"],
    ["stale", "stale"],
  ]);
  expect(
    states.map((s) => s.candidates.map((c) => c.intent.providerId)),
  ).toEqual([["first"], ["first", "second"], [], ["first"]]);
  expect(
    states.map((s) => s.candidates.map((c) => c.compatibility.compatible)),
  ).toEqual([[true], [true, true], [], [true]]);
});
