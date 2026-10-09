import { CommonTasks } from "../src/common-tasks.js";
import { afterEach, it, expect, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { CommonActor } from "@plums/sdk";
const dirs: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
it.each([false, true])(
  "an elapsed deadline wins a provider %s settlement before its delayed timer runs",
  async (reject) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const { tasks } = await setup();
    const t = tasks.create(owner, "signature", "front", "frontend", 250);
    let signal!: AbortSignal;
    await tasks.start(
      t.taskId,
      owner,
      "signature",
      randomUUID(),
      async (active, started) => {
        signal = active;
        started();
        now.mockReturnValue(1250);
        if (reject) throw Error("private provider failure");
        return "private late result";
      },
    );
    expect(tasks.status(t.taskId, owner, "signature")).toMatchObject({
      status: { state: "stopped" },
      result: { outcome: { ok: false, error: { code: "DEADLINE_EXCEEDED" } } },
    });
    expect(signal.aborted).toBe(true);
    expect(
      JSON.stringify(tasks.poll(t.taskId, owner, "signature", -1)),
    ).not.toContain("private");
  },
);
const owner: CommonActor = {
  agentId: "agent",
  componentId: "component",
  installId: "installed",
  artifactDigest: "a".repeat(64),
  instanceId: "instance",
  generation: 1,
};
async function setup() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-common-queue-"));
  dirs.push(dir);
  return { dir, tasks: new CommonTasks(dir) };
}
const hold = (signal: AbortSignal) =>
  new Promise<null>((r) => {
    if (signal.aborted) r(null);
    else signal.addEventListener("abort", () => r(null), { once: true });
  });
it("a low acknowledgement never discards events the consumer has not acknowledged", async () => {
  const { tasks } = await setup(),
    t = tasks.create(owner, "signature", "front", "frontend");
  await tasks.start(
    t.taskId,
    owner,
    "signature",
    randomUUID(),
    async (signal, started) => {
      started();
      return hold(signal);
    },
  );
  for (let i = 0; i < 200; i++)
    await tasks.emitCall(t.taskId, "progress", { i });
  tasks.acknowledge(t.taskId, owner, "signature", 0);
  expect(
    tasks.poll(t.taskId, owner, "signature", 0).messages[0]?.sequence,
  ).toBe(1);
  tasks.acknowledge(t.taskId, owner, "signature", 180);
  expect(() => tasks.poll(t.taskId, owner, "signature", 0)).toThrow();
  expect(
    tasks.poll(t.taskId, owner, "signature", 179).messages[0]?.sequence,
  ).toBe(180);
  await tasks.stop(t.taskId, owner, "signature");
});
it("a producer overflow cancels work and keeps an independent terminal result", async () => {
  const { tasks } = await setup(),
    t = tasks.create(owner, "signature", "front", "frontend");
  await tasks.start(
    t.taskId,
    owner,
    "signature",
    randomUUID(),
    async (signal, started) => {
      started();
      return hold(signal);
    },
  );
  for (let i = 0; i < 255; i++)
    await tasks.emitCall(t.taskId, "progress", { i });
  await expect(
    tasks.emitCall(t.taskId, "progress", null),
  ).rejects.toMatchObject({ details: { reason: "LIMIT_EXCEEDED" } });
  await tasks.stop(t.taskId, owner, "signature");
  expect(tasks.status(t.taskId, owner, "signature").result).toMatchObject({
    executionState: "unknown",
    outcome: { ok: false, error: { code: "LIMIT_EXCEEDED" } },
  });
});
it("an existing task deadline can only shorten and result expiry never restores execution", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
  const { tasks, dir } = await setup(),
    t = tasks.create(owner, "signature", "front", "frontend", 250);
  await tasks.start(
    t.taskId,
    owner,
    "signature",
    randomUUID(),
    async (signal, started) => {
      started();
      return hold(signal);
    },
  );
  tasks.shorten(t.taskId, owner, "signature", 5000);
  await vi.advanceTimersByTimeAsync(250);
  expect(tasks.status(t.taskId, owner, "signature").result).toMatchObject({
    outcome: { ok: false, error: { code: "DEADLINE_EXCEEDED" } },
  });
  await vi.advanceTimersByTimeAsync(300001);
  expect(tasks.status(t.taskId, owner, "signature").result).toBeUndefined();
  expect(tasks.status(t.taskId, owner, "signature").status.state).toBe(
    "stopped",
  );
  await expect(
    tasks.start(
      t.taskId,
      owner,
      "signature",
      randomUUID(),
      async () => "must not run",
    ),
  ).rejects.toBeDefined();
  expect(
    await readFile(path.join(dir, t.taskId + ".json"), "utf8"),
  ).not.toContain('"result"');
});
it("revocation erases retained bodies while keeping durable status", async () => {
  const { tasks } = await setup(),
    t = tasks.create(owner, "signature", "front", "frontend");
  await tasks.start(
    t.taskId,
    owner,
    "signature",
    randomUUID(),
    async (_signal, started) => {
      started();
      return { secretBody: "fixture" };
    },
  );
  expect(tasks.status(t.taskId, owner, "signature").result).toBeDefined();
  await tasks.stopAgent(owner.agentId);
  expect(tasks.status(t.taskId, owner, "signature").result).toBeUndefined();
  expect(tasks.status(t.taskId, owner, "signature").status.state).toBe(
    "completed",
  );
});

it("producer byte occupancy includes the full envelope and overflow cancels instead of discarding unread events", async () => {
  const { tasks } = await setup(),
    t = tasks.create(owner, "signature", "front", "frontend");
  const callId = randomUUID();
  await tasks.start(
    t.taskId,
    owner,
    "signature",
    callId,
    async (signal, started) => {
      started();
      return hold(signal);
    },
  );
  const envelope = {
    commonVersion: "1.0",
    kind: "event",
    callId,
    sequence: 1,
    channel: "chunk",
    data: "",
  };
  for (let i = 0; i < 31; i++)
    await tasks.emitCall(
      t.taskId,
      "chunk",
      "x".repeat(
        256 * 1024 -
          Buffer.byteLength(JSON.stringify({ ...envelope, sequence: i + 1 })) -
          (i === 0 ? 100 : 0),
      ),
    );
  await expect(
    tasks.emitCall(
      t.taskId,
      "chunk",
      "x".repeat(
        256 * 1024 -
          Buffer.byteLength(JSON.stringify({ ...envelope, sequence: 32 })),
      ),
    ),
  ).rejects.toMatchObject({ details: { reason: "LIMIT_EXCEEDED" } });
  await tasks.stop(t.taskId, owner, "signature");
  expect(tasks.status(t.taskId, owner, "signature").result).toMatchObject({
    outcome: { ok: false, error: { code: "LIMIT_EXCEEDED" } },
  });
});

it("bounds terminal metadata by age and Agent while keeping recent replay and active work", async () => {
  const { dir, tasks } = await setup();
  const recent = tasks.create(owner, "signature", "front", "frontend");
  await tasks.start(
    recent.taskId,
    owner,
    "signature",
    randomUUID(),
    async () => ({ value: "recent" }),
  );
  const active = tasks.create(
    { ...owner, agentId: "other" },
    "other",
    "front",
    "frontend",
  );
  const fs = await import("node:fs/promises");
  const now = Date.now(),
    ids: string[] = [];
  for (let i = 0; i < 270; i++) {
    const taskId = randomUUID();
    ids.push(taskId);
    await fs.writeFile(
      path.join(dir, taskId + ".json"),
      JSON.stringify({
        metadataVersion: 1,
        terminalDate: now - 600000 - i,
        description: { taskId, lifetime: "frontend", owner },
        snapshot: {
          status: {
            taskId,
            state: "completed",
            executionState: "completed",
            lastSequence: 0,
            callId: randomUUID(),
          },
        },
        signature: "signature",
        origin: "front",
      }),
    );
  }
  const expired = randomUUID();
  await fs.writeFile(
    path.join(dir, expired + ".json"),
    JSON.stringify({
      metadataVersion: 1,
      terminalDate: now - 31 * 86400000,
      description: { taskId: expired, lifetime: "frontend", owner },
      snapshot: {
        status: {
          taskId: expired,
          state: "crashed",
          executionState: "unknown",
          lastSequence: 0,
        },
      },
      signature: "signature",
      origin: "front",
    }),
  );
  const recovered = new CommonTasks(dir);
  expect(recovered.list(owner.agentId)).toHaveLength(256);
  expect(recovered.status(recent.taskId, owner, "signature").status.state).toBe(
    "completed",
  );
  expect(
    recovered.status(active.taskId, { ...owner, agentId: "other" }, "other")
      .status.executionState,
  ).toBe("not_started");
  expect(() => recovered.status(ids.at(-1)!, owner, "signature")).toThrow();
  await expect(
    fs.readFile(path.join(dir, expired + ".json")),
  ).rejects.toMatchObject({ code: "ENOENT" });
  expect(tasks.status(recent.taskId, owner, "signature").result).toBeDefined();
  await tasks.stop(active.taskId, { ...owner, agentId: "other" }, "other");
});

it("refuses future or corrupt metadata without rewriting prior records or echoing private values", async () => {
  const { dir, tasks } = await setup();
  const t = tasks.create(owner, "signature", "front", "frontend");
  const fs = await import("node:fs/promises");
  const before = await fs.readFile(path.join(dir, t.taskId + ".json"));
  const file = path.join(dir, randomUUID() + ".json");
  for (const input of [
    JSON.stringify({ metadataVersion: 2, private: "fixture-private" }),
    '{"fixture-private":',
  ]) {
    await fs.writeFile(file, input);
    expect(() => new CommonTasks(dir)).toThrowError(
      expect.objectContaining({
        details: expect.objectContaining({ reason: "RUNTIME_UNAVAILABLE" }),
      }),
    );
    expect(await fs.readFile(path.join(dir, t.taskId + ".json"))).toEqual(
      before,
    );
    expect(await fs.readFile(file, "utf8")).toBe(input);
  }
  await tasks.stop(t.taskId, owner, "signature");
});

it("bounds terminal status across Agents without reviving any recovered work", async () => {
  const { dir } = await setup(),
    fs = await import("node:fs/promises"),
    now = Date.now();
  const ids: string[] = [];
  for (let i = 0; i < 1080; i++) {
    const taskId = randomUUID();
    ids.push(taskId);
    await fs.writeFile(
      path.join(dir, taskId + ".json"),
      JSON.stringify({
        metadataVersion: 1,
        terminalDate: now - 600000 - i,
        description: {
          taskId,
          lifetime: "agent",
          owner: { ...owner, agentId: "agent-" + (i % 6) },
        },
        snapshot: {
          status: {
            taskId,
            state: "crashed",
            executionState: "unknown",
            lastSequence: 0,
          },
        },
        signature: "signature",
        origin: "front",
      }),
    );
  }
  const restored = new CommonTasks(dir);
  expect(
    Array.from(
      { length: 6 },
      (_, i) => restored.list("agent-" + i).length,
    ).reduce((a, b) => a + b, 0),
  ).toBe(1024);
  expect(
    (await fs.readdir(dir)).filter((f) => f.endsWith(".json")),
  ).toHaveLength(1024);
  await expect(
    restored.start(
      ids[0]!,
      { ...owner, agentId: "agent-0" },
      "signature",
      randomUUID(),
      async () => "must not run",
    ),
  ).rejects.toMatchObject({ details: { reason: "STALE_BINDING" } });
});
