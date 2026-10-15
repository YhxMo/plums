import { expect, it } from "vitest";
import { ExperimentPlatform, type Bridge } from "./host-transport/platform";
const owner = "extension.probe.alpha";
const cap = "credential.request";
const payload = { version: 1, binding: "text", body: "plum" };
function fixture() {
  const calls: Array<[string, Record<string, unknown> | undefined]> = [];
  const bridge: Bridge = async (command, args) => {
    calls.push([command, args]);
    return command === "probe_execute"
      ? { status: 200, body: "echo:plum" }
      : { pending: 0 };
  };
  return { calls, bridge };
}
it("refuses connection when native experimental commands are absent", async () => {
  await expect(
    ExperimentPlatform.connect(async () => {
      throw "unknown command";
    }),
  ).rejects.toThrow();
});
it("derives native owner only from Platform owner and restricts payload", async () => {
  const f = fixture();
  const p = await ExperimentPlatform.connect(f.bridge);
  await p.grant(owner, [cap]);
  expect(await p.call(owner, cap, payload)).toEqual({
    status: 200,
    body: "echo:plum",
  });
  expect(f.calls.find(([name]) => name === "probe_prepare")?.[1]).toMatchObject(
    { owner: "probe.alpha", binding: "echo", body: "plum" },
  );
  const before = f.calls.length;
  await expect(
    p.call(owner, cap, { ...payload, owner: "probe.beta" }),
  ).rejects.toMatchObject({ outcome: "not-dispatched" });
  await expect(p.call("extension.other", cap, payload)).rejects.toThrow();
  expect(f.calls).toHaveLength(before);
});
it("cancels a reservation resolved after abort without execute", async () => {
  let finish!: () => void;
  const f = fixture();
  const c = new AbortController();
  const p = await ExperimentPlatform.connect(async (command, args) => {
    const result = await f.bridge(command, args);
    if (command === "probe_prepare")
      await new Promise<void>((resolve) => (finish = resolve));
    return result;
  });
  await p.grant(owner, [cap]);
  const result = p.call(owner, cap, payload, c.signal);
  await Promise.resolve();
  await Promise.resolve();
  c.abort();
  finish();
  await expect(result).rejects.toMatchObject({ outcome: "not-dispatched" });
  expect(f.calls.some(([name]) => name === "probe_cancel")).toBe(true);
  expect(f.calls.some(([name]) => name === "probe_execute")).toBe(false);
});
it("does not deliver a result after revoke and regrant", async () => {
  let finish!: (value: unknown) => void;
  let executing!: () => void;
  const started = new Promise<void>((resolve) => (executing = resolve));
  const f = fixture();
  const p = await ExperimentPlatform.connect(async (command, args) =>
    command === "probe_execute"
      ? new Promise((resolve) => {
          finish = resolve;
          executing();
        })
      : f.bridge(command, args),
  );
  await p.grant(owner, [cap]);
  const result = p.call(owner, cap, payload);
  await started;
  await p.grant(owner, []);
  await p.grant(owner, [cap]);
  finish({ status: 200, body: "late" });
  await expect(result).rejects.toMatchObject({ outcome: "unknown" });
});
it("sanitizes unknown bridge failures", async () => {
  const f = fixture();
  const p = await ExperimentPlatform.connect(async (command, args) => {
    if (command === "probe_execute") throw "sensitive upstream detail";
    return f.bridge(command, args);
  });
  await p.grant(owner, [cap]);
  await expect(p.call(owner, cap, payload)).rejects.toMatchObject({
    message: "Experimental transport failed",
    outcome: "unknown",
  });
});

it("treats failed cancellation receipt after reservation as unknown", async () => {
  const f = fixture();
  const c = new AbortController();
  const p = await ExperimentPlatform.connect(async (command, args) => {
    if (command === "probe_cancel") throw "bridge unavailable";
    const result = await f.bridge(command, args);
    if (command === "probe_prepare") c.abort();
    return result;
  });
  await p.grant(owner, [cap]);
  await expect(p.call(owner, cap, payload, c.signal)).rejects.toMatchObject({
    outcome: "unknown",
  });
  expect(f.calls.some(([name]) => name === "probe_execute")).toBe(false);
});
it("does not retain local permission after unknown grant receipt", async () => {
  const f = fixture();
  let fail = false;
  const p = await ExperimentPlatform.connect(async (command, args) => {
    if (command === "probe_grant" && fail) throw "private detail";
    return f.bridge(command, args);
  });
  await p.grant(owner, [cap]);
  fail = true;
  await expect(p.grant(owner, [])).rejects.toMatchObject({
    outcome: "unknown",
  });
  const before = f.calls.length;
  await expect(p.call(owner, cap, payload)).rejects.toMatchObject({
    outcome: "not-dispatched",
  });
  expect(f.calls).toHaveLength(before);
});
it("rejects an already aborted operation before native work", async () => {
  const f = fixture();
  const p = await ExperimentPlatform.connect(f.bridge);
  await p.grant(owner, [cap]);
  const before = f.calls.length;
  const c = new AbortController();
  c.abort();
  await expect(p.call(owner, cap, payload, c.signal)).rejects.toMatchObject({
    outcome: "not-dispatched",
  });
  expect(f.calls).toHaveLength(before);
});
it.each([
  { version: 2, binding: "text", body: "x" },
  { ...payload, binding: "report" },
  { ...payload, body: "x".repeat(4097) },
])("rejects incompatible or overbroad request %j", async (input) => {
  const f = fixture();
  const p = await ExperimentPlatform.connect(f.bridge);
  await p.grant(owner, [cap]);
  const before = f.calls.length;
  await expect(p.call(owner, cap, input)).rejects.toMatchObject({
    outcome: "not-dispatched",
  });
  expect(f.calls).toHaveLength(before);
});

it("does not restore permission from a delayed grant receipt after revoke", async () => {
  const f = fixture();
  let finish!: () => void;
  const p = await ExperimentPlatform.connect(async (command, args) => {
    const value = await f.bridge(command, args);
    if (command === "probe_grant" && args?.allow)
      await new Promise<void>((resolve) => (finish = resolve));
    return value;
  });
  const granting = p.grant(owner, [cap]);
  await Promise.resolve();
  await Promise.resolve();
  await p.grant(owner, []);
  finish();
  await granting;
  await expect(p.call(owner, cap, payload)).rejects.toMatchObject({
    outcome: "not-dispatched",
  });
});
it("does not execute after unknown prepare receipt or claim cleanup when cancel fails", async () => {
  const f = fixture();
  const p = await ExperimentPlatform.connect(async (command, args) => {
    if (["probe_prepare", "probe_cancel"].includes(command))
      throw "private bridge state";
    return f.bridge(command, args);
  });
  await p.grant(owner, [cap]);
  await expect(p.call(owner, cap, payload)).rejects.toMatchObject({
    message: "Experimental transport failed",
    outcome: "unknown",
  });
  expect(f.calls.some(([name]) => name === "probe_execute")).toBe(false);
});

it("allows an unmapped capability-free reader to uninstall without native authorization", async () => {
  const { Host } = await import("../modules/extension-host/host");
  const f = fixture();
  const p = await ExperimentPlatform.connect(f.bridge);
  const host = new Host(p);
  host.install({
    manifest: { id: "probe.reader", version: "1", apiVersion: 1 },
    activate() {},
  });
  await host.start("probe.reader");
  await host.stop("probe.reader");
  const before = f.calls.length;
  await host.uninstall("probe.reader");
  expect(host.ids()).toEqual([]);
  expect(f.calls).toHaveLength(before);
  await expect(p.grant("extension.probe.reader", [cap])).rejects.toThrow();
});
