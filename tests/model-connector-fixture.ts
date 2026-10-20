/** Shared model-connector fixture; closes each test's host afterwards. */
import { afterEach, expect, vi } from "vitest";
import { Host } from "../modules/extension-host/host";
import {
  MODEL_PAGE,
  modelConnector,
  type ModelConnectionsApi,
} from "../modules/models/extension";
import type { ProviderDraft } from "../modules/models/providers";
import type { ChatService } from "../extensions/contracts";
import type { Platform, StoredState } from "../modules/sdk";

export const owner = "extension.connector.models";
export const deepseek: ProviderDraft = {
  name: "DeepSeek",
  notes: "",
  website: "https://www.deepseek.com",
  preset: "deepseek",
  protocol: "openai-chat",
  base: "https://api.deepseek.com",
  models: ["user-model-a", "user-model-b"],
  windows: {},
  maxTokens: null,
  context: 128_000,
};
export const KEY = "sk-synthetic";
export const deepseekTarget = "https://api.deepseek.com/chat/completions";
export const claude: ProviderDraft = {
  name: "Claude",
  notes: "公司网关",
  website: "",
  preset: "custom",
  protocol: "anthropic-messages",
  base: "https://gateway.example",
  models: ["user-claude"],
  windows: {},
  maxTokens: 512,
  context: 1_000_000,
};
/** models.dev's shape, trimmed to one service. */
export const catalogText = JSON.stringify({
  deepseek: {
    api: "https://api.deepseek.com",
    models: { "deepseek-chat": { limit: { context: 1_048_576 } } },
  },
});
export const completion = (content: string) => ({
  status: 200,
  body: JSON.stringify({
    choices: [
      {
        index: 0,
        finish_reason: "stop",
        message: { role: "assistant", content },
      },
    ],
  }),
});

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});

/** Test-only platform: keyed state, native connection connect and transport. */
export async function fixture({
  credentials = true,
  saved,
}: { credentials?: boolean; saved?: unknown } = {}) {
  const states = new Map<string, StoredState>();
  if (saved !== undefined) states.set(owner, { revision: 1, value: saved });
  const connections = new Map<
    string,
    { target: string; protocol: string; label: string }
  >();
  const connect = vi.fn(async (_request: Record<string, unknown>) => "saved");
  const send = vi.fn(async (_alias: string, _target: string, _body: string) =>
    completion("你是 nanan。"),
  );
  const read = vi.fn(
    async (_alias: string, _target: string, _path: string) =>
      ({ status: 404, body: "" }) as { status: number; body: string },
  );
  const catalog = vi.fn(async (_url: string) => ({
    status: 200,
    body: catalogText,
  }));
  let next = 0;
  let writeFailure: Error | undefined;
  let listFailures = 0;
  const platform: Platform = {
    kind: credentials ? "native" : "browser",
    available: (name) => credentials || name.startsWith("state."),
    async grant() {},
    async call(caller, name, payload) {
      expect(caller).toBe(owner);
      const request = (payload ?? {}) as Record<string, unknown>;
      if (name === "state.read") return states.get(owner) ?? null;
      if (name === "state.write") {
        const failure = writeFailure;
        writeFailure = undefined;
        if (failure) throw failure;
        const stored = {
          revision: (request.revision as number) + 1,
          value: request.value,
        };
        states.set(owner, stored);
        return stored;
      }
      if (name === "credential.connect") {
        if (request.action === "list" && listFailures-- > 0)
          throw new Error("连接记录不可用");
        if (request.action === "list")
          return [...connections].map(([alias, item]) => ({
            alias,
            ...item,
            status: "ready",
          }));
        const status = await connect(request);
        if (status !== "saved") return { alias: request.alias ?? "", status };
        if (request.action === "remove") {
          connections.delete(request.alias as string);
          return { alias: request.alias, status };
        }
        const alias = (request.alias as string) ?? `c-0000000${next++}`;
        connections.set(alias, {
          target: request.target as string,
          protocol: request.protocol as string,
          label: request.label as string,
        });
        return { alias, status };
      }
      if (name === "network.read") return catalog(request.url as string);
      if (name === "credential.request") {
        const item = connections.get(request.binding as string);
        if (!item)
          throw Object.assign(new Error("未就绪"), {
            outcome: "not-dispatched",
          });
        if (request.method === "GET")
          return read(
            request.binding as string,
            item.target,
            request.path as string,
          );
        return send(
          request.binding as string,
          item.target,
          request.body as string,
        );
      }
      throw new Error("Permission denied");
    },
  };
  const host = new Host(platform);
  let api!: ModelConnectionsApi;
  let chat!: ChatService;
  host.install(
    modelConnector({
      mountPage(_container, value) {
        api = value;
        return () => {};
      },
    }),
  );
  host.install({
    manifest: {
      id: "consumer.chat",
      version: "1",
      apiVersion: 1,
      requires: { chat: 1 },
    },
    activate(ctx) {
      chat = ctx.use<ChatService>("chat");
    },
  });
  const capabilities = [
    "state.read",
    "state.write",
    "credential.request",
    "credential.connect",
    "network.read",
  ];
  await host.grant("connector.models", capabilities.filter(platform.available));
  await host.start("connector.models").catch(() => {});
  cleanups.push(() => host.stop("connector.models"));
  if (host.inspect("connector.models").status === "active") {
    await host.start("consumer.chat");
    host.mountView(MODEL_PAGE, {} as HTMLElement);
  }
  return {
    host,
    api,
    chat: () => chat,
    connect,
    send,
    read,
    catalog,
    states,
    connections,
    failNextWrite: () => void (writeFailure = new Error("磁盘已满")),
    failLists: (count: number) => void (listFailures = count),
  };
}
export const signal = () => new AbortController().signal;
export const body = (send: ReturnType<typeof vi.fn>, call = 0) =>
  JSON.parse(send.mock.calls[call][2] as string) as Record<string, unknown>;
