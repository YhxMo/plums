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
  expect(catalog.mock.calls).toEqual([
    ["https://models.dev/api.json"],
    ["https://models.dev/api.json"],
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
