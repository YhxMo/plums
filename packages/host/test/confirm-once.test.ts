import { afterEach, expect, it, vi } from "vitest";
import { rm } from "node:fs/promises";
import { secretRef } from "@plums/core";
import { confirmOnce } from "../src/confirm-once.js";
import { callbackFixture } from "./local-callback-fixture.js";
import type { Session } from "../src/host.js";
const fixtures: Awaited<ReturnType<typeof callbackFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.host.close();
    await rm(f.dir, { recursive: true, force: true });
  }
});
it("aborted signal returns false without asking", async () => {
  const ask = vi.fn(async () => true);
  expect(
    await confirmOnce({ ask }, { message: "synthetic" }, AbortSignal.abort()),
  ).toBe(false);
  expect(ask).not.toHaveBeenCalled();
});
it.each([true, false, undefined, null, 1, "true", {}, []])(
  "only boolean true approves (%j)",
  async (value) => {
    expect(
      await confirmOnce(
        { ask: async () => value as boolean },
        { message: "synthetic" },
        new AbortController().signal,
      ),
    ).toBe(value === true);
  },
);
it("ask rejection returns false", async () => {
  expect(
    await confirmOnce(
      {
        ask: async () => {
          throw Error("synthetic");
        },
      },
      { message: "synthetic" },
      new AbortController().signal,
    ),
  ).toBe(false);
});
it("late true after abort is ignored", async () => {
  let finish!: (value: boolean) => void;
  const controller = new AbortController();
  const pending = confirmOnce(
    {
      ask: () =>
        new Promise((r) => {
          finish = r;
        }),
    },
    { message: "synthetic" },
    controller.signal,
  );
  await Promise.resolve();
  controller.abort();
  finish(true);
  expect(await pending).toBe(false);
});
it("120s timeout returns false", async () => {
  vi.useFakeTimers();
  // Node's native AbortSignal.timeout does not use fake timers. Control its clock only.
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  const pending = confirmOnce(
    { ask: () => new Promise(() => {}) },
    { message: "synthetic" },
    new AbortController().signal,
  );
  expect(timeout).toHaveBeenCalledWith(120_000);
  let settled = false;
  void pending.then(() => {
    settled = true;
  });
  await vi.advanceTimersByTimeAsync(119_999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toBe(false);
});
it.each(["resource", "policy"])(
  "%s confirmations refresh and redact secret values in the message",
  async (mode) => {
    const f = await callbackFixture({
      noRange: mode === "resource",
      ...(mode === "policy"
        ? {
            policy:
              "if(c.category==='local')return decision('confirm');return decision(c.category==='resource'&&c.operation==='write'?'confirm':'allow');",
          }
        : {}),
    });
    fixtures.push(f);
    const s = (
      f.host as unknown as { sessions: Map<string, Session> }
    ).sessions.get(f.id)!;
    const ref = secretRef(
      "store",
      "local-00000000-0000-4000-8000-000000000003/value",
    );
    await s.core.reserveLocalCredentialReferences(
      "store",
      (await s.core.getPackage("store")).installed.installedAt,
      [ref],
    );
    await s.secrets.set(ref, "SYNTHETIC_INITIAL_CONFIRM_VALUE");
    // Introduce a synthetic secret after the audit's refresh: the shared host gate must refresh again.
    const secret = mode === "policy" ? "策略请求确认" : s.record.name;
    let changed = false;
    f.setAudit(async (event) => {
      if (event.phase === "confirmation" && event.outcome === "requested") {
        changed = true;
        await s.secrets.set(ref, secret);
      }
    });
    expect(await f.run({ op: "write", value: "synthetic" })).toMatchObject({
      kind: "result",
      executionState: "completed",
      outcome: { ok: true },
    });
    expect(changed).toBe(true);
    expect(f.confirm.ask).toHaveBeenCalledOnce();
    expect(f.confirm.ask).toHaveBeenLastCalledWith(
      expect.objectContaining({ message: expect.not.stringContaining(secret) }),
    );
  },
);

it.each(["resource", "policy"])(
  "%s: a secret read failure while preparing a confirmation denies instead of throwing",
  async (mode) => {
    const f = await callbackFixture({
      noRange: mode === "resource",
      ...(mode === "policy"
        ? {
            policy:
              "if(c.category==='local')return decision('confirm');return decision(c.category==='resource'&&c.operation==='write'?'confirm':'allow');",
          }
        : {}),
    });
    fixtures.push(f);
    const s = (
      f.host as unknown as { sessions: Map<string, Session> }
    ).sessions.get(f.id)!;
    const ref = secretRef(
      "store",
      "local-00000000-0000-4000-8000-000000000004/value",
    );
    await s.core.reserveLocalCredentialReferences(
      "store",
      (await s.core.getPackage("store")).installed.installedAt,
      [ref],
    );
    await s.secrets.set(ref, "SYNTHETIC_CONFIRM_READ_VALUE");
    const host = f.host as any,
      originalConfirm = host.confirmOperation.bind(host),
      originalGet = s.secrets.get.bind(s.secrets);
    let preparing = false,
      failed = false;
    const confirmation = vi
      .spyOn(host, "confirmOperation")
      .mockImplementation(async (...args) => {
        preparing = true;
        try {
          return await originalConfirm(...args);
        } finally {
          preparing = false;
        }
      });
    vi.spyOn(s.secrets, "get").mockImplementation(async (value) => {
      if (preparing && !failed) {
        failed = true;
        throw Error("synthetic-confirm-secret-read-error");
      }
      return originalGet(value);
    });
    expect(await f.run({ op: "write", value: "forbidden" })).toMatchObject({
      outcome: { ok: false, error: { code: "NOT_AUTHORIZED" } },
    });
    expect(confirmation).toHaveBeenCalledOnce();
    expect(f.confirm.ask).not.toHaveBeenCalled();
    expect(f.audit).toContainEqual(
      expect.objectContaining({
        phase: "confirmation",
        outcome: "denied",
        ...(mode === "policy" ? { reason: "POLICY_CONFIRM" } : {}),
      }),
    );
    expect(
      f.audit.filter(
        (e) =>
          e.kind === "resource" &&
          e.phase === "allow" &&
          e.operation === "write",
      ),
    ).toHaveLength(0);
    expect(await f.direct({ op: "read" })).toMatchObject({ exists: false });
    expect(JSON.stringify(f.audit)).not.toContain(
      "synthetic-confirm-secret-read-error",
    );
  },
);
