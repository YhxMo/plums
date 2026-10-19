import { afterEach, expect, it, vi } from "vitest";
import connector from "../extensions/connectors/deepseek.js";
import upper from "../extensions/services/upper.js";
import { Host } from "../modules/extension-host/host";
import { agentExtension } from "../modules/agents/provider";
import type { Platform, StoredState } from "../modules/sdk";
import type { AgentProvider } from "../modules/agents/contract";
import type { Transformer } from "../extensions/contracts";
import {
  FakeCredentialPlatform,
  type FakeTransport,
} from "./fixtures/credential-platform";

const id = "connector.deepseek";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanups.splice(0).reverse()) await close();
});
const completion = (text = "synthetic reply", reason = "stop") => ({
  status: 200,
  body: JSON.stringify({
    choices: [
      {
        index: 0,
        finish_reason: reason,
        message: { role: "assistant", content: text },
      },
    ],
  }),
});
function fixture(
  send: FakeTransport = async () => completion(),
  configuration?: { version: number; values: Record<string, string | number> },
) {
  const dispatch = vi.fn(send);
  const platform = new FakeCredentialPlatform(
    [
      {
        owner: `extension.${id}`,
        id: "text",
        target: "https://model.invalid/chat/completions",
      },
    ],
    dispatch,
  );
  const call = vi.spyOn(platform, "call");
  // Agents keep their own state; credentials stay on the fake credential path.
  const states = new Map<string, StoredState>();
  const host = new Host({
    kind: "browser",
    available: (name) => name.startsWith("state.") || platform.available(name),
    grant: (owner, capabilities) =>
      platform.grant(
        owner,
        capabilities.filter((name) => !name.startsWith("state.")),
      ),
    async call(owner, name, payload, signal) {
      const { key, remove, revision, value } = (payload ?? {}) as Partial<
        StoredState & { key: string; remove: boolean }
      >;
      const slot = key ? `${owner}+${key}` : owner;
      if (name === "state.read") return states.get(slot) ?? null;
      if (name !== "state.write")
        return platform.call(owner, name, payload, signal);
      if (remove) {
        states.delete(slot);
        return null;
      }
      const next = { revision: revision! + 1, value };
      states.set(slot, next);
      return next;
    },
  } satisfies Platform);
  let service: Transformer;
  let agents: AgentProvider;
  host.install(connector, configuration);
  host.install(agentExtension());
  host.install({
    manifest: {
      id: "consumer.text",
      version: "1",
      apiVersion: 1,
      requires: { "text.transform": 1, agents: 1 },
    },
    activate(ctx) {
      service = ctx.use<Transformer>("text.transform");
      agents = ctx.use<AgentProvider>("agents");
    },
  });
  cleanups.push(async () => {
    for (const extension of host.ids().reverse()) await host.stop(extension);
  });
  return {
    host,
    platform,
    call,
    dispatch,
    get service() {
      return service;
    },
    get agents() {
      return agents;
    },
    async enable() {
      await host.grant(id, ["credential.request"]);
      await host.grant("agents.local", ["state.read", "state.write"]);
      await host.start(id);
      await host.start("agents.local");
      await host.start("consumer.text");
    },
  };
}

it("connects the existing Agent consumer with connector-owned credentials and only the current text", async () => {
  const f = fixture();
  await f.enable();
  expect(f.dispatch).not.toHaveBeenCalled();
  const agent = await f.agents.create({
    name: "synthetic Agent",
    description: "role description stays local",
  });
  await f.agents.send(agent.id, "first");
  await f.agents.send(agent.id, "second");
  expect(f.dispatch).toHaveBeenCalledTimes(2);
  const [owner, capability, payload] = f.call.mock.calls[1];
  expect(owner).toBe(`extension.${id}`);
  expect(capability).toBe("credential.request");
  expect(Object.keys(payload as object).sort()).toEqual([
    "binding",
    "body",
    "version",
  ]);
  expect(payload).toMatchObject({ version: 1, binding: "text" });
  expect(JSON.parse((payload as { body: string }).body)).toEqual({
    model: "deepseek-flash",
    messages: [{ role: "user", content: "second" }],
    max_tokens: 256,
    thinking: { type: "disabled" },
    stream: false,
  });
  expect(f.agents.list()[0].sessions[0].messages.map((m) => m.text)).toEqual([
    "first",
    "synthetic reply",
    "second",
    "synthetic reply",
  ]);
  expect(f.agents.list()[0].extensionId).toBe("agents.local");
});

it("keeps model and output budget in extension configuration", async () => {
  const f = fixture(undefined, {
    version: 1,
    values: { model: "deepseek-pro", maxTokens: 128 },
  });
  await f.enable();
  await f.service.transform("text", new AbortController().signal);
  expect(JSON.parse(f.dispatch.mock.calls[0][0].body)).toMatchObject({
    model: "deepseek-pro",
    max_tokens: 128,
  });
});

it.each(["梅".repeat(1400), '"'.repeat(2100), "   "])(
  "rejects empty or oversized serialized input before dispatch (case %#)",
  async (input) => {
    const f = fixture();
    await f.enable();
    await expect(
      f.service.transform(input, new AbortController().signal),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
    expect(f.call).not.toHaveBeenCalled();
  },
);

it.each(["length", "tool_calls", "content_filter", "aborted"])(
  "rejects an incomplete or unsupported completion: %s",
  async (reason) => {
    const f = fixture(async () => completion("untrusted partial", reason));
    await f.enable();
    const agent = await f.agents.create({ name: "failure" });
    await expect(f.agents.send(agent.id, "keep input")).rejects.toThrow(
      "DeepSeek",
    );
    expect(f.agents.list()[0].sessions[0].messages).toEqual([]);
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  },
);

it.each([
  "not JSON",
  '{"choices":[]}',
  '{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":null}}]}',
  '{"choices":[{"finish_reason":"stop","message":{"role":"assistant","content":" "}}]}',
])("rejects malformed or empty response content (case %#)", async (body) => {
  const f = fixture(async () => ({ status: 200, body }));
  await f.enable();
  await expect(
    f.service.transform("input", new AbortController().signal),
  ).rejects.toThrow("DeepSeek");
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});

it("returns only assistant text without reasoning or raw response metadata", async () => {
  const f = fixture(async () => ({
    status: 200,
    body: JSON.stringify({
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "  useful text\n",
            reasoning_content: "synthetic reasoning",
          },
        },
      ],
      metadata: "synthetic private metadata",
    }),
  }));
  await f.enable();
  expect(await f.service.transform("input", new AbortController().signal)).toBe(
    "  useful text\n",
  );
});

it.each([401, 429, 500])(
  "reports HTTP %i without exposing upstream body or retrying",
  async (status) => {
    const f = fixture(async () => ({
      status,
      body: "synthetic upstream detail",
    }));
    await f.enable();
    const error = await f.service
      .transform("input", new AbortController().signal)
      .catch((e: Error) => e);
    expect(String(error)).toContain(String(status));
    expect(String(error)).not.toContain("synthetic upstream detail");
    expect(f.dispatch).toHaveBeenCalledTimes(1);
  },
);

it.each(["not-dispatched", "unknown"] as const)(
  "preserves %s with a sanitized transport error and no retry",
  async (outcome) => {
    const f = fixture();
    await f.enable();
    f.call.mockRejectedValueOnce(
      Object.assign(Error("synthetic sensitive upstream error"), { outcome }),
    );
    const error = await f.service
      .transform("input", new AbortController().signal)
      .catch((e: Error) => e);
    expect(error).toMatchObject({ outcome });
    expect(String(error)).not.toContain("synthetic sensitive");
    if (outcome === "unknown") expect(String(error)).toContain("重复");
    expect(f.call).toHaveBeenCalledTimes(1);
  },
);

it("cancels an in-flight Agent request and discards a late response", async () => {
  let finish!: (value: ReturnType<typeof completion>) => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const f = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve;
        entered();
      }),
  );
  await f.enable();
  const agent = await f.agents.create({ name: "cancel" });
  const pending = f.agents.send(agent.id, "cancel this");
  await started;
  f.agents.cancel(agent.id);
  expect(f.dispatch.mock.calls[0][0].signal.aborted).toBe(true);
  finish(completion("late"));
  await expect(pending).rejects.toMatchObject({ outcome: "unknown" });
  expect(f.agents.list()[0].sessions[0].messages).toEqual([]);
  expect(f.host.inspect(id).tasks).toBe(0);
});

it("waits without advertising a service before authorization or platform support", async () => {
  const f = fixture();
  await f.host.start(id);
  expect(f.host.inspect(id).status).toBe("waiting");
  expect(f.host.serviceNames()).not.toContain("text.transform");
  expect(f.dispatch).not.toHaveBeenCalled();
  vi.spyOn(f.platform, "available").mockReturnValue(false);
  await f.host.start(id);
  expect(f.host.inspect(id).status).toBe("waiting");
  expect(f.host.serviceNames()).not.toContain("text.transform");
});

it("rejects a pre-cancelled call without contacting the platform", async () => {
  const f = fixture();
  await f.enable();
  const cancelled = new AbortController();
  cancelled.abort();
  await expect(
    f.service.transform("cancelled", cancelled.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(f.call).not.toHaveBeenCalled();
});

it("rejects fractional output budgets before publishing a service", async () => {
  const f = fixture(undefined, {
    version: 1,
    values: { model: "deepseek-flash", maxTokens: 1.5 },
  });
  await expect(f.enable()).rejects.toThrow("配置无效");
  expect(f.host.inspect(id).status).toBe("failed");
  expect(f.host.serviceNames()).not.toContain("text.transform");
  expect(f.call).not.toHaveBeenCalled();
});

it("an Agent switched to the local provider keeps its saved messages", async () => {
  const f = fixture();
  await f.enable();
  // The Agent footer tells the user where messages go.
  expect(f.agents.info.description).toContain("api.deepseek.com");
  const agent = await f.agents.create({ name: "switch" });
  await f.agents.send(agent.id, "remote test");
  const oldService = f.service;
  await f.host.stop(id);
  f.host.install(upper);
  await f.host.start("transform.upper");
  expect(f.agents.info.description).toContain("不连接语言模型");
  expect(f.agents.info.description).not.toContain("deepseek");
  // The Agent keeps DeepSeek switched on while it is stopped.
  await expect(f.agents.send(agent.id, "none")).rejects.toThrow("没有开启");
  await f.agents.setExtension!(agent.id, "transform.upper", true);
  await f.agents.send(agent.id, "local only");
  expect(f.agents.list()[0].sessions[0].messages.at(-1)?.text).toBe(
    "LOCAL ONLY",
  );
  expect(f.agents.list()[0].sessions[0].messages).toHaveLength(4);
  await expect(
    oldService.transform("stale", new AbortController().signal),
  ).rejects.toThrow("Extension stopped");
  expect(f.dispatch).toHaveBeenCalledTimes(1);
});
