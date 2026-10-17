import { vi } from "vitest";
import type { StoredState } from "../modules/sdk";

const runtimeFixture = vi.hoisted(() => ({
  saved: null as StoredState | null,
  write: vi.fn(),
  install: vi.fn(),
  start: vi.fn(),
  connectShell: vi.fn(),
}));
export { runtimeFixture };
vi.mock("../src/agent-ui", () => ({
  agentUI: () => ({
    manifest: { id: "ui.agents", version: "1", apiVersion: 1 },
    activate() {},
  }),
}));
vi.mock("../src/platform", () => ({
  PlatformAdapter: class {
    kind = "browser";
    credentials = { initialize: async () => {} };
    initializeDocuments = async () => {};
    grant = async () => {};
    call = async (
      _owner: string,
      capability: string,
      payload?: unknown,
      signal?: AbortSignal,
    ) =>
      capability === "state.read"
        ? runtimeFixture.saved
        : runtimeFixture.write(payload, signal);
  },
}));
vi.mock("../modules/extension-host/host", () => ({
  Host: class {
    install = runtimeFixture.install;
    start = runtimeFixture.start;
    connectShell = runtimeFixture.connectShell;
  },
  loadExtension: async (_url: string, id: string) => ({
    manifest: { id, version: "1", apiVersion: 1 },
    activate() {},
  }),
}));

export function prepareRuntime(value: unknown = { version: 1 }) {
  runtimeFixture.saved = { revision: 7, value };
  runtimeFixture.write.mockReset().mockImplementation(async (next) => ({
    revision: next.revision + 1,
    value: next.value,
  }));
  runtimeFixture.install.mockClear();
  runtimeFixture.start.mockClear();
  runtimeFixture.connectShell.mockClear();
  vi.stubGlobal("location", new URL("http://localhost:1420/"));
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => [] })),
  );
}
