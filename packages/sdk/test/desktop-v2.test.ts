import { expect, it } from "vitest";
import { createArchive, validatePackage, type ManifestV2 } from "@plums/core";
import { desktopContribution } from "../src/index.js";

const field = { type: "string" as const, title: "Setting", description: "Setting" };
function connector(): ManifestV2 {
  return {
    formatVersion: "2.0", kind: "connector", id: "service", name: "Service", version: "2.0.0", description: "", dependencies: [],
    permissions: [{ id: "send", kind: "service", target: "https", operations: ["request"], reason: "Send" }],
    settingsSchema: { type: "object", properties: { endpoint: field, key: { ...field, "x-secret": true }, profile: { ...field, enum: ["a", "b"] } } },
    payload: { plumsDesktop: { sdkVersion: "2", connections: [{ id: "api", permissionId: "send", baseURLSetting: "endpoint", selectorSetting: "profile", credentialProfiles: { a: [{ setting: "key", header: "Authorization", prefix: "Bearer " }], b: [{ setting: "key", header: "x-key" }] } }] } },
  };
}
it("accepts SDK v1 and a protocol-independent v2 connection", () => {
  const m = connector();
  expect(desktopContribution(m)?.connections?.[0]?.id).toBe("api");
  m.payload = { plumsDesktop: { sdkVersion: "1", runtime: "main.js" } };
  expect(desktopContribution(m)?.sdkVersion).toBe("1");
});
it.each(["permission", "secret-address", "profile", "header", "sdk"])("rejects invalid connection authority: %s", (change) => {
  const m = connector(), c = (m.payload as any).plumsDesktop, d = c.connections[0];
  if (change === "permission") m.permissions = [];
  if (change === "secret-address") d.baseURLSetting = "key";
  if (change === "profile") delete d.credentialProfiles.b;
  if (change === "header") d.credentialProfiles.a[0].header = "Proxy-Authorization";
  if (change === "sdk") c.sdkVersion = "1";
  expect(() => desktopContribution(m)).toThrowError();
});
it("requires public engine permission and a package-owned entry", async () => {
  const m = connector(); m.kind = "extension"; m.settingsSchema = undefined;
  m.permissions = [{ id: "run", kind: "engine", target: "agent", reason: "Run a local engine" }];
  m.payload = { plumsDesktop: { sdkVersion: "2", engines: [{ id: "agent", title: "Agent", entry: "engine/main.js", runtime: "node", platforms: ["darwin-arm64"], protocol: "jsonrpc-jsonl-v1" }] } };
  const files = { "engine/main.js": new TextEncoder().encode("process.exit(0)") };
  const zip = await createArchive({ ...files, "manifest.json": new TextEncoder().encode(JSON.stringify(m)) });
  const checked = await validatePackage(zip);
  expect(desktopContribution(checked.manifest, checked.files)?.engines?.[0]?.id).toBe("agent");
  expect(() => desktopContribution(m, {})).toThrowError();
  const contribution = (m.payload as any).plumsDesktop;
  contribution.engines = [];
  expect(() => desktopContribution(m, files)).toThrowError();
  delete contribution.engines;
  expect(() => desktopContribution(m, files)).toThrowError();
  m.payload = {};
  expect(() => desktopContribution(m, files)).toThrowError();
  m.payload = {plumsDesktop: {...contribution, engines: [{id: "agent", title: "Agent", entry: "engine/main.js", runtime: "node", platforms: ["darwin-arm64"], protocol: "jsonrpc-jsonl-v1"}]}};
  m.permissions = [];
  expect(() => desktopContribution(m, files)).toThrowError();
});
