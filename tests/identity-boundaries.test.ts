import { expect, it } from "vitest";
import { Host } from "../modules/extension-host/host";
import { PlatformAdapter } from "../src/platform";

it("rejects IDs that cannot receive a platform authorization identity", () => {
  const host = new Host(new PlatformAdapter());
  expect(() =>
    host.install({
      manifest: {
        id: "example..plugin",
        version: "1",
        apiVersion: 1,
        capabilities: ["state.read"],
      },
      activate() {},
    }),
  ).toThrow(/identity/);
  expect(host.ids()).toEqual([]);
});

it("accepts a boundary-length normal ID and grants its declared capability", async () => {
  const host = new Host(new PlatformAdapter());
  const id = "a" + "b".repeat(63);
  host.install({
    manifest: { id, version: "1", apiVersion: 1, capabilities: ["state.read"] },
    activate() {},
  });
  await host.grant(id, ["state.read"]);
  await host.start(id);
  expect(host.inspect(id).status).toBe("active");
});
