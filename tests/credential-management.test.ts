import { beforeEach, expect, it, vi } from "vitest";
import { CredentialAccess } from "../src/credentials";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
const record = {
  owner: "extension.connector.test",
  alias: "text",
  source: "/connectors/test.js",
  version: "1",
  declaration: {
    label: "synthetic",
    target: "https://model.invalid/text",
    contentType: "application/json",
    headers: {},
    authentication: { type: "bearer" as const },
  },
  route: { type: "direct" as const },
  revision: 1,
  status: "ready" as const,
};
beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => {
    if (command === "credential_supported") return true;
    if (command === "credential_inventory") return [record];
    if (command === "credential_list") return [record];
    return { status: "saved" };
  });
});
it("does not call native APIs for browser preview", async () => {
  const access = new CredentialAccess();
  await access.initialize(false);
  expect(await access.list(record.owner)).toEqual([]);
  expect(await access.route(record.owner, "text", 1)).toEqual({
    status: "rejected",
    reason: "unavailable",
  });
  expect(invoke).not.toHaveBeenCalled();
});
it("keeps a failed native probe distinct from an unsupported platform", async () => {
  invoke.mockRejectedValueOnce(new Error("ipc unavailable"));
  const access = new CredentialAccess();
  await access.initialize(true);
  expect(access.supported).toBe(false);
  expect(access.initializationError).toBe("ipc unavailable");
});
it("keeps an empty probe failure observable", async () => {
  invoke.mockRejectedValueOnce(new Error(""));
  const access = new CredentialAccess();
  await access.initialize(true);
  expect(access.initializationError).toBe("初始化探测失败");
  expect(access.supported).toBe(false);
});
it("passes the typed key to native storage with the binding metadata", async () => {
  const access = new CredentialAccess();
  await access.initialize(true);
  const result = await access.configure(
    record.owner,
    record.alias,
    record.source,
    record.version,
    record.declaration,
    1,
    "sk-synthetic",
  );
  expect(invoke.mock.calls.at(-1)).toEqual([
    "credential_configure",
    {
      owner: record.owner,
      alias: "text",
      source: record.source,
      version: "1",
      declaration: record.declaration,
      revision: 1,
      key: "sk-synthetic",
    },
  ]);
  // The key goes in once; nothing returned carries it.
  expect(JSON.stringify(result)).not.toContain("sk-synthetic");
});
it("keeps native management visible when metadata loading fails", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "credential_supported") return true;
    throw Error("synthetic sensitive failure");
  });
  const access = new CredentialAccess();
  await access.initialize(true);
  expect(access.supported).toBe(true);
  expect(access.initializationError).toBe("synthetic sensitive failure");
  await expect(access.list(record.owner)).rejects.toThrow("原记录已保留");
  expect(await access.delete(record.owner, "text", 1)).toEqual({
    status: "unknown",
  });
});
it("does not add a credential prerequisite to unrelated local extensions", async () => {
  const access = new CredentialAccess();
  await access.initialize(true);
  invoke.mockClear();
  await access.prepareUninstall("extension.local-only", false);
  expect(invoke).not.toHaveBeenCalled();
});
it("disables retained binding metadata before removing an installed source", async () => {
  const access = new CredentialAccess();
  await access.initialize(true);
  await access.prepareUninstall(record.owner, false);
  expect(invoke.mock.calls.at(-1)).toEqual([
    "credential_retain",
    { owner: record.owner },
  ]);
});
it("keeps the installed source if binding disable receipt is unknown", async () => {
  const access = new CredentialAccess();
  await access.initialize(true);
  invoke.mockImplementation(async (command: string) => {
    if (command === "credential_retain")
      throw Error("synthetic sensitive failure");
    return null;
  });
  await expect(access.prepareUninstall(record.owner, true)).rejects.toThrow(
    "安装路径仍保留",
  );
});
it("reports an unavailable retain as not attempted instead of a pending receipt", async () => {
  const access = new CredentialAccess();
  await access.initialize(true);
  invoke.mockImplementation(async (command: string) =>
    command === "credential_retain"
      ? { status: "rejected", reason: "unavailable" }
      : { status: "saved" },
  );
  await expect(access.prepareUninstall(record.owner, true)).rejects.toThrow(
    "操作未执行",
  );
});
