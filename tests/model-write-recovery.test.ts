import { expect, it } from "vitest";
import {
  fixture,
  deepseek,
  KEY,
  owner,
  signal,
} from "./model-connector-fixture";

it("locks all mutations after a lost write receipt without recycling a live alias", async () => {
  const { api, connect, states, connections, failNextWrite } = await fixture();
  failNextWrite(true);
  await expect(api.save(deepseek, undefined, KEY)).rejects.toThrow();
  const saved = states.get(owner)!.value as {
    providers: Array<{ id: string; alias: string }>;
  };
  const [a] = saved.providers;
  const calls = connect.mock.calls.length;
  await expect(
    api.save(
      { ...deepseek, name: "另一个账户" },
      undefined,
      "sk-other-synthetic",
    ),
  ).rejects.toThrow();
  await expect(api.remove(a.id)).rejects.toThrow();
  expect(connect).toHaveBeenCalledTimes(calls);
  expect(connections.get(a.alias)?.label).toBe(deepseek.name);

  await api.reload();
  expect(api.list()).toEqual([
    expect.objectContaining({ id: a.id, status: "ready" }),
  ]);
  await api.save(
    { ...deepseek, name: "另一个账户" },
    undefined,
    "sk-other-synthetic",
  );
  expect(new Set(api.list().map((p) => p.alias)).size).toBe(2);
  expect(connections.get(a.alias)?.label).toBe(deepseek.name);
});

it("keeps uncertain providers unsendable until an authoritative read succeeds", async () => {
  const { api, chat, send, connect, failNextWrite, failReads } =
    await fixture();
  const id = await api.save(deepseek, undefined, KEY);
  failNextWrite(true);
  await expect(
    api.save({ ...deepseek, name: "已落盘的新名称" }, id),
  ).rejects.toThrow();
  await api.refresh();
  expect(api.list()[0].status).toBe("pending");
  await expect(
    chat().reply(
      { model: `${id}/user-model-a`, history: [], input: "hi" },
      signal(),
    ),
  ).rejects.toMatchObject({ outcome: "not-dispatched" });
  expect(send).not.toHaveBeenCalled();
  failReads(1);
  await expect(api.reload()).rejects.toThrow("连接配置不可读");
  await expect(api.remove(id)).rejects.toThrow();
  expect(connect).toHaveBeenCalledTimes(1);
  await api.reload();
  expect(api.list()[0]).toMatchObject({
    name: "已落盘的新名称",
    status: "ready",
  });
});

it("reconciles an uncertain deletion before another save", async () => {
  const { api, failNextWrite } = await fixture();
  const id = await api.save(deepseek, undefined, KEY);
  failNextWrite(true);
  await expect(api.remove(id)).rejects.toThrow();
  await expect(api.save(deepseek, undefined, KEY)).rejects.toThrow();
  await api.reload();
  expect(api.list()).toEqual([]);
  await api.save(deepseek, undefined, KEY);
  expect(api.list()).toHaveLength(1);
});

it("serializes provider mutations around credentials and revisioned state", async () => {
  const { api, states } = await fixture();
  await Promise.all([
    api.save(deepseek, undefined, KEY),
    api.save(
      { ...deepseek, name: "另一个账户" },
      undefined,
      "sk-other-synthetic",
    ),
  ]);
  expect(api.list()).toHaveLength(2);
  expect(states.get(owner)?.revision).toBe(2);
});

it("rejects requests begun while locked before any asynchronous lookup can race recovery", async () => {
  const { api, chat, list, send, read, catalog, failNextWrite } =
    await fixture();
  const id = await api.save(deepseek, undefined, KEY);
  failNextWrite(true);
  await expect(
    api.save({ ...deepseek, models: ["new-model"] }, id),
  ).rejects.toThrow();
  const lookups = list.mock.calls.length;
  const pending = chat()
    .reply({ model: `${id}/user-model-a`, history: [], input: "hi" }, signal())
    .catch((error: unknown) => error);
  expect(list).toHaveBeenCalledTimes(lookups);
  await api.reload();
  expect(await pending).toMatchObject({ outcome: "not-dispatched" });
  expect(send).not.toHaveBeenCalled();
  failNextWrite(true);
  await expect(api.save(deepseek, id)).rejects.toThrow();
  await expect(api.fetchModels(id, signal())).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(catalog).not.toHaveBeenCalled();
});

it("re-resolves the model after an asynchronous connection check", async () => {
  const { api, chat, list, send } = await fixture();
  const id = await api.save(deepseek, undefined, KEY);
  const ready = await list();
  let release!: () => void;
  let entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const checking = new Promise<void>((resolve) => {
    entered = resolve;
  });
  list.mockImplementationOnce(async () => {
    entered();
    await gate;
    return ready;
  });
  const pending = chat()
    .reply({ model: `${id}/user-model-a`, history: [], input: "hi" }, signal())
    .catch((error: unknown) => error);
  await checking;
  try {
    await api.save({ ...deepseek, models: ["new-model"] }, id);
  } finally {
    release();
  }
  expect(await pending).toMatchObject({ outcome: "not-dispatched" });
  expect(send).not.toHaveBeenCalled();
});
