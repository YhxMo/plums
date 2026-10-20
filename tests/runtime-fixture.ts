import { vi } from "vitest";
import type { StoredState } from "../modules/sdk";

const runtimeFixture = vi.hoisted(() => ({
  saved: null as StoredState | null,
  write: vi.fn(),
  install: vi.fn(),
  start: vi.fn(),
  connectShell: vi.fn(),
  documentsError: null as string | null,
  credentialsError: null as string | null,
}));
export { runtimeFixture };
vi.mock("../src/agents/extension", () => ({
  agentUI: () => ({
    manifest: { id: "ui.agents", version: "1", apiVersion: 1 },
    activate() {},
  }),
}));
vi.mock("../src/models/extension", () => ({
  modelConnectorWithPage: () => ({
    manifest: { id: "connector.models", version: "1", apiVersion: 1 },
    activate() {},
  }),
}));
vi.mock("../src/platform", () => ({
  PlatformAdapter: class {
    kind = "browser";
    credentials = {
      initialize: async () => {},
      initializationError: null as string | null,
    };
    network = {};
    get documentsInitializationError() {
      return runtimeFixture.documentsError;
    }
    get credentialsInitializationError() {
      return runtimeFixture.credentialsError;
    }
    initializeDocuments = async () => {};
    available = (name: string) => name.startsWith("state.");
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
    ids = () => [];
    grant = async () => {};
    start = runtimeFixture.start;
    connectShell = runtimeFixture.connectShell;
  },
}));
vi.mock("../modules/extension-host/definition", () => ({
  loadExtension: async (_url: string, id: string) => ({
    manifest: { id, version: "1", apiVersion: 1 },
    activate() {},
  }),
}));

export function prepareRuntime(value: unknown = { version: 1 }) {
  runtimeFixture.saved = { revision: 7, value };
  runtimeFixture.documentsError = null;
  runtimeFixture.credentialsError = null;
  runtimeFixture.write.mockReset().mockImplementation(async (next) => ({
    revision: next.revision + 1,
    value: next.value,
  }));
  runtimeFixture.install.mockClear();
  runtimeFixture.start.mockReset();
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
