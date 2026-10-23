import { expect, it, vi } from "vitest";
import {
  owner,
  deepseek,
  KEY,
  catalogText,
  fixture,
  signal,
  body,
} from "./model-connector-fixture";

it("reads models.dev once an hour and lists models without it when it fails", async () => {
  const { api, read, catalog } = await fixture();
  const id = (await api.save(deepseek, undefined, KEY)) as string;
  const list = {
    status: 200,
    body: JSON.stringify({ data: [{ id: "deepseek-chat" }] }),
  };
  read.mockResolvedValue(list);
  catalog.mockRejectedValueOnce(
    Object.assign(new Error("读取超时。"), { outcome: "unknown" }),
  );
  await expect(api.fetchModels(id, signal())).resolves.toEqual([
    { name: "deepseek-chat" },
  ]);
  // A failed read is tried again; a good one is kept.
  for (let i = 0; i < 2; i++)
    await expect(api.fetchModels(id, signal())).resolves.toEqual([
      { name: "deepseek-chat", context: 1_048_576 },
    ]);
  expect(catalog.mock.calls.map(([url]) => url)).toEqual([
    "https://models.dev/api.json",
    "https://models.dev/api.json",
  ]);
  catalog.mockResolvedValueOnce({ status: 200, body: "{" });
  vi.useFakeTimers({ now: Date.now() + 3_600_001, toFake: ["Date"] });
  try {
    await expect(api.fetchModels(id, signal())).resolves.toEqual([
      { name: "deepseek-chat" },
    ]);
  } finally {
    vi.useRealTimers();
  }
});

it("lists models without waiting long for a slow models.dev", async () => {
  const { api, read, catalog } = await fixture();
  const id = (await api.save(deepseek, undefined, KEY)) as string;
  read.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ data: [{ id: "deepseek-chat" }] }),
  });
  let finish!: (value: { status: number; body: string }) => void;
  catalog.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const controller = new AbortController();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const listed = api.fetchModels(id, controller.signal);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(listed).resolves.toEqual([{ name: "deepseek-chat" }]);
  } finally {
    vi.useRealTimers();
  }
  // Closing the form does not stop the read; the next list gets the windows.
  controller.abort();
  finish({ status: 200, body: catalogText });
  await expect(api.fetchModels(id, signal())).resolves.toEqual([
    { name: "deepseek-chat", context: 1_048_576 },
  ]);
  expect(catalog).toHaveBeenCalledTimes(1);
});

it("stops waiting for models.dev when the form is closed", async () => {
  const { api, read, catalog } = await fixture();
  const id = (await api.save(deepseek, undefined, KEY)) as string;
  read.mockResolvedValue({
    status: 200,
    body: JSON.stringify({ data: [{ id: "deepseek-chat" }] }),
  });
  // Never answers; ends only when the host stops the extension.
  catalog.mockImplementationOnce(
    (_url, stop) =>
      new Promise((_, reject) =>
        stop?.addEventListener("abort", () => reject(stop.reason)),
      ),
  );
  const controller = new AbortController();
  const listed = api.fetchModels(id, controller.signal);
  await vi.waitFor(() => expect(read).toHaveBeenCalled());
  controller.abort(new Error("closed"));
  await expect(listed).rejects.toThrow("closed");
});

it("trims each model's history to its own window", async () => {
  const { api, chat, send } = await fixture();
  const id = (await api.save(
    { ...deepseek, windows: { "user-model-a": 1_000_000 } },
    undefined,
    KEY,
  )) as string;
  const history = Array.from({ length: 100 }, (_, i) => [
    { role: "user" as const, text: `${i}` + "问".repeat(4000) },
    { role: "agent" as const, text: `${i}` + "答".repeat(4000) },
  ]).flat();
  for (const model of ["user-model-a", "user-model-b"])
    await chat().reply(
      { model: `${id}/${model}`, history, input: "总结" },
      signal(),
    );
  const [own, shared] = [0, 1].map(
    (call) => (body(send, call).messages as unknown[]).length,
  );
  expect(own).toBe(201);
  expect(shared).toBeLessThan(40);
});

it("drops a removed model's window and refuses one out of range", async () => {
  const { api } = await fixture();
  const id = await api.save(
    {
      ...deepseek,
      models: ["user-model-a"],
      windows: { "user-model-a": 200_000, gone: 200_000 },
    },
    undefined,
    KEY,
  );
  expect(api.list()[0].windows).toEqual({ "user-model-a": 200_000 });
  await expect(
    api.save({ ...deepseek, windows: { "user-model-a": 8000 } }, id),
  ).rejects.toThrow("模型的上下文窗口");
  await expect(
    api.save(
      { ...deepseek, maxTokens: 64_000, windows: { "user-model-a": 32_000 } },
      id,
    ),
  ).rejects.toThrow("最大输出须小于 user-model-a 的上下文窗口");
});

it("gives version 5 records no per-model windows", async () => {
  const saved = {
    version: 5,
    providers: [
      {
        ...deepseek,
        windows: undefined,
        id: "p-aaaaaaaa",
        alias: "c-00000000",
      },
    ],
  };
  const { api, states } = await fixture({ saved });
  expect(api.list()[0]).toMatchObject({ windows: {}, context: 128_000 });
  expect(states.get(owner)?.value).toBe(saved);
});

it("keeps each model's own way of thinking, and drops or refuses what does not fit", async () => {
  const { api, chat, send } = await fixture();
  const id = (await api.save(
    {
      ...deepseek,
      preset: "custom",
      models: ["user-model-a", "user-model-b"],
      thinking: { "user-model-a": "openai", gone: "openai" },
    },
    undefined,
    KEY,
  )) as string;
  expect(api.list()[0].thinking).toEqual({ "user-model-a": "openai" });
  const listed = chat().models();
  expect(listed.find((m) => m.id === `${id}/user-model-a`)?.reasoning).toEqual([
    "low",
    "medium",
    "high",
  ]);
  expect(listed.find((m) => m.id === `${id}/user-model-b`)).not.toHaveProperty(
    "reasoning",
  );
  await chat().reply(
    { model: `${id}/user-model-a`, history: [], input: "想想", effort: "high" },
    signal(),
  );
  expect(body(send, 0).reasoning_effort).toBe("high");
  // A way of the other format, or an unknown one, is refused.
  for (const thinking of [
    { "user-model-a": "adaptive" },
    { "user-model-a": "x" },
  ])
    await expect(
      api.save({ ...deepseek, preset: "custom", thinking } as never, id),
    ).rejects.toThrow("思考方式");
});

it("gives version 6 records no chosen ways of thinking", async () => {
  const saved = {
    version: 6,
    providers: [
      {
        ...deepseek,
        thinking: undefined,
        id: "p-aaaaaaaa",
        alias: "c-00000000",
      },
    ],
  };
  const { api, states } = await fixture({ saved });
  expect(api.list()[0]).toMatchObject({ thinking: {} });
  expect(states.get(owner)?.value).toBe(saved);
});
