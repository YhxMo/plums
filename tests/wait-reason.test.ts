import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import type { Platform } from "../modules/sdk";
import { stateMessage } from "../src/shell/messages";

const platform = (
  available: (name: string) => boolean = () => true,
): Platform => ({
  kind: "browser",
  available,
  grant: async () => {},
  call: async () => null,
});

it("reports why an extension waits as structured data", async () => {
  const host = new Host(platform((name) => name !== "document.read"));
  host.install({
    manifest: {
      id: "needs.grant",
      apiVersion: 1,
      version: "1",
      capabilities: ["state.read"],
    },
    activate() {},
  });
  host.install({
    manifest: {
      id: "needs.platform",
      apiVersion: 1,
      version: "1",
      capabilities: ["document.read"],
    },
    activate() {},
  });
  host.install({
    manifest: {
      id: "needs.service",
      apiVersion: 1,
      version: "1",
      requires: { notes: 2 },
    },
    activate() {},
  });
  for (const id of host.ids()) await host.start(id);
  expect(host.inspect("needs.grant").wait).toEqual({
    kind: "permission",
    capability: "state.read",
  });
  expect(host.inspect("needs.platform").wait).toEqual({
    kind: "capability-unavailable",
    capability: "document.read",
  });
  expect(host.inspect("needs.service").wait).toEqual({
    kind: "dependency",
    service: "notes",
    version: 2,
  });
  expect(stateMessage(host.inspect("needs.grant"))).toBe(
    "需要授权：读取隔离状态",
  );
  expect(stateMessage(host.inspect("needs.service"))).toBe(
    "依赖暂不可用：notes@2",
  );
  await host.grant("needs.grant", ["state.read"]);
  expect(host.inspect("needs.grant")).toMatchObject({ status: "active" });
  expect(host.inspect("needs.grant").wait).toBeUndefined();
});

it("reports dependency cycles and invalid configuration structurally", async () => {
  const host = new Host(platform());
  for (const [id, provides, requires] of [
    ["cycle.a", "a", "b"],
    ["cycle.b", "b", "a"],
  ])
    host.install({
      manifest: {
        id,
        apiVersion: 1,
        version: "1",
        provides: { [provides]: 1 },
        requires: { [requires]: 1 },
      },
      activate() {},
    });
  host.install(
    {
      manifest: {
        id: "configured",
        apiVersion: 1,
        version: "1",
        configuration: {
          version: 1,
          fields: {
            n: { label: "N", type: "number", default: 1, min: 0, max: 9 },
          },
        },
      },
      activate() {},
    },
    { version: 2, values: {} },
  );
  for (const id of host.ids()) await host.start(id);
  expect(host.inspect("cycle.a").wait).toEqual({ kind: "cycle" });
  expect(host.inspect("configured").wait).toMatchObject({
    kind: "configuration",
  });
  expect(stateMessage(host.inspect("cycle.a"))).toBe("扩展存在循环依赖。");
});

it("leaves non-waiting failures as plain error text", () => {
  expect(stateMessage({ error: "Extension stopped" })).toBe("扩展已停用。");
  expect(stateMessage({})).toBeUndefined();
});
