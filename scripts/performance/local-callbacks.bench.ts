import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { writeFile, rm } from "node:fs/promises";
import os from "node:os";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { callbackFixture } from "../../packages/host/test/local-callback-fixture.js";
import { AgentExecutionService } from "../../packages/host/src/local-execution.js";
import { currentRecheck } from "../../packages/host/src/recheck-cache.js";
import type { Session } from "../../packages/host/src/host.js";
import { CommonTasks } from "../../packages/host/src/common-tasks.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  if (process.env.PLUMS_BENCH_SCENARIO !== "diagnostic") return original;
  return {
    ...original,
    lstat: (...args: Parameters<typeof original.lstat>) =>
      measured("metadata.lstat", () => original.lstat(...args)),
    readdir: (...args: Parameters<typeof original.readdir>) =>
      measured("metadata.readdir", () => original.readdir(...args)),
  };
});
const scenario = process.env.PLUMS_BENCH_SCENARIO!;
if (
  !["idle", "concurrent", "cancel", "diagnostic"].includes(scenario) ||
  !process.env.PLUMS_BENCH_REPORT
)
  throw Error(
    "Run this sampler with node scripts/bench-host.mjs --out /absolute/report.json",
  );
const width = scenario === "concurrent" || scenario === "diagnostic" ? 4 : 1;
const fixtures: Awaited<ReturnType<typeof callbackFixture>>[] = [];
const samples: unknown[] = [];
const metrics: Record<string, { count: number; inclusiveMs: number }> = {};
let entryStarted = false;
const revisions = new Map<string, string>();
const diagnostic = scenario === "diagnostic";
let collecting = false;
async function measured<T>(label: string, fn: () => Promise<T>): Promise<T> {
  if (!collecting) return fn();
  const start = performance.now();
  try {
    return await fn();
  } finally {
    const m = (metrics[label] ??= { count: 0, inclusiveMs: 0 });
    m.count++;
    m.inclusiveMs += performance.now() - start;
  }
}
beforeAll(async () => {
  for (let i = 0; i < width; i++) {
    const f = await callbackFixture({}, (host, dir) =>
      fixtures.push({ host, dir } as typeof f),
    );
    await f.host.engineStatus(f.id, "engine-demo", "local");
    fixtures[i] = f;
  }
  if (scenario === "cancel") {
    const original = CommonTasks.prototype.emitCall;
    vi.spyOn(CommonTasks.prototype, "emitCall").mockImplementation(function (
      ...args
    ) {
      const result = original.apply(this, args);
      if (args[1] === "benchmark.started") entryStarted = true;
      return result;
    });
  }
  if (diagnostic) {
    const original = AgentExecutionService.prototype.authorize;
    vi.spyOn(AgentExecutionService.prototype, "authorize").mockImplementation(
      function (...args) {
        return measured("authorize", () => original.apply(this, args));
      },
    );
    for (const f of fixtures) {
      const host = f.host as unknown as {
        assertAgentFoundation(s: Session): Promise<void>;
      };
      const original = host.assertAgentFoundation.bind(f.host);
      vi.spyOn(host, "assertAgentFoundation").mockImplementation((s) => {
        const scope = currentRecheck();
        return measured(
          `foundation.${scope ? (scope.full ? "full" : "nonFull") : "outside"}`,
          () => original(s),
        );
      });
    }
  }
});
const success = {
  kind: "result",
  executionState: "completed",
  outcome: { ok: true },
};
it("warms each synthetic chain before sampling", async () => {
  for (const f of fixtures)
    expect(await f.run({ op: "list" })).toMatchObject(success);
});
for (let round = 0; round < 5; round++) {
  it(`samples ${scenario} round ${round + 1} within the existing 20s test budget`, async () => {
    const delay = monitorEventLoopDelay({ resolution: 10 });
    delay.enable();
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    const start = performance.now();
    const durations: number[] = [];
    const failures: string[] = [];
    const errors: unknown[] = [];
    collecting = diagnostic;
    try {
      await Promise.all(
        fixtures.map(async (f) => {
          const started = performance.now();
          try {
            if (scenario === "cancel") {
              const abort = new AbortController();
              entryStarted = false;
              const settled = f
                .run({ op: "benchmark-hang" }, abort.signal)
                .then(
                  () => false,
                  () => true,
                );
              let cancelAt: number;
              try {
                await expect
                  .poll(() => entryStarted, { timeout: 8000 })
                  .toBe(true);
                cancelAt = performance.now();
              } finally {
                abort.abort();
              }
              expect(await settled).toBe(true);
              await expect
                .poll(
                  async () =>
                    (await f.host.commonTasks(f.id))
                      .filter(
                        (t) => t.description.owner.componentId === "middle",
                      )
                      .at(-1)?.snapshot.status.state,
                )
                .toBe("stopped");
              durations.push(performance.now() - cancelAt!);
              expect(
                await f.host.engineStatus(f.id, "engine-demo", "local"),
              ).toMatchObject({ state: "running" });
            } else {
              expect(
                await f.run({
                  op: "write",
                  value: "synthetic",
                  revision: revisions.get(f.id) ?? "0",
                }),
              ).toMatchObject(success);
              const read = await f.run({ op: "read" });
              expect(read).toMatchObject({
                ...success,
                outcome: {
                  ok: true,
                  value: { exists: true, value: "synthetic" },
                },
              });
              revisions.set(
                f.id,
                (read as { outcome: { value: { revision: string } } }).outcome
                  .value.revision,
              );
              durations.push(performance.now() - started);
            }
          } catch (error) {
            errors.push(error);
            // Allowlisted failure category only; never retain raw diagnostic errors.
            failures.push(
              typeof (error as { code?: unknown }).code === "string"
                ? String((error as { code: string }).code)
                : "ASSERTION_OR_RUNTIME_FAILURE",
            );
          }
        }),
      );
    } finally {
      collecting = false;
      delay.disable();
      const after = process.memoryUsage();
      samples.push({
        round: round + 1,
        width,
        durationsMs: durations,
        failures,
        batchMs: performance.now() - start,
        eventLoopP95Ms: delay.percentile(95) / 1e6,
        eventLoopMaxMs: delay.max / 1e6,
        memoryDelta: {
          rss: after.rss - memory.rss,
          heapUsed: after.heapUsed - memory.heapUsed,
        },
        cpuMicros: process.cpuUsage(cpu),
      });
    }
    if (errors.length) throw errors[0];
    expect(failures).toEqual([]);
  });
}
afterAll(async () => {
  // Save evidence before cleanup, even when assertions fail.
  try {
    await writeFile(
      process.env.PLUMS_BENCH_REPORT!,
      JSON.stringify(
        {
          environment: {
            node: process.version,
            platform: process.platform,
            arch: process.arch,
            cpu: os.cpus()[0]?.model,
            release: os.release(),
          },
          instrumented: diagnostic,
          samples,
          metrics,
          limitations: [
            "in-process hosts; not the historical four-Vitest-worker workload",
            "inclusive timings overlap; IPC, execution and queue are not separately measured",
            "cancel durations start after the fixture entry emits its started event",
            "parent-process CPU and memory only; no child-process peak sampling",
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    vi.restoreAllMocks();
    for (const f of fixtures) {
      await f.host.close();
      await rm(f.dir, { recursive: true, force: true });
    }
  }
});
