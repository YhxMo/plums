import { expect, it, vi } from "vitest";
import { recoverComposition } from "../modules/shell/composition-recovery";
import type { Platform, StoredState } from "../modules/sdk";
const original = {
  revision: 7,
  value: {
    version: 1,
    composition: { schema: 99 },
    agents: [{ name: "synthetic" }],
    imports: [],
    theme: "dark",
  },
};
function setup() {
  const states = new Map<string, StoredState>([
    ["host.shell", structuredClone(original)],
  ]);
  const platform: Platform = {
    kind: "browser",
    available: () => true,
    grant: async () => {},
    call: vi.fn(async (owner, cap, payload) => {
      if (cap === "state.read") return states.get(owner) ?? null;
      const p = payload as StoredState;
      const current = states.get(owner);
      if ((current?.revision ?? 0) !== p.revision)
        throw Object.assign(Error("conflict"), { outcome: "not-committed" });
      const next = { revision: p.revision + 1, value: p.value };
      states.set(owner, next);
      return next;
    }),
  };
  return { states, platform };
}
it("backs up original value before resetting only composition", async () => {
  const { states, platform } = setup();
  await recoverComposition(platform, original, "host.recovery.test");
  expect(states.get("host.recovery.test")?.value).toEqual(original.value);
  expect(states.get("host.shell")?.value).toEqual({
    version: 1,
    agents: original.value.agents,
    imports: [],
    theme: "dark",
  });
  expect(original.value.composition).toEqual({ schema: 99 });
});
it("backup failure leaves original untouched", async () => {
  const { states, platform } = setup();
  vi.mocked(platform.call).mockRejectedValueOnce(Error("backup failed"));
  await expect(
    recoverComposition(platform, original, "host.recovery.test"),
  ).rejects.toThrow();
  expect(states.get("host.shell")).toEqual(original);
});
it("existing backup and source revision conflict never overwrite data", async () => {
  const { states, platform } = setup();
  states.set("host.recovery.test", { revision: 1, value: "keep" });
  await expect(
    recoverComposition(platform, original, "host.recovery.test"),
  ).rejects.toThrow();
  expect(states.get("host.recovery.test")?.value).toBe("keep");
  states.set("host.shell", { revision: 8, value: "newer" });
  await expect(
    recoverComposition(platform, original, "host.recovery.fresh"),
  ).rejects.toThrow("conflict");
  expect(states.get("host.shell")?.value).toBe("newer");
  expect(states.get("host.recovery.fresh")?.value).toEqual(original.value);
});
it("failed backup verification does not reset source", async () => {
  const { states, platform } = setup();
  const call = platform.call;
  platform.call = async (owner, cap, payload) =>
    owner !== "host.shell" && cap === "state.read"
      ? { revision: 1, value: "wrong" }
      : call(owner, cap, payload);
  await expect(
    recoverComposition(platform, original, "host.recovery.test"),
  ).rejects.toThrow();
  expect(states.get("host.shell")).toEqual(original);
});
it("unknown backup receipt never proceeds to source reset", async () => {
  const { states, platform } = setup();
  const call = platform.call;
  platform.call = async (owner, cap, payload) => {
    const result = await call(owner, cap, payload);
    if (owner !== "host.shell" && cap === "state.write")
      throw Error("receipt lost");
    return result;
  };
  await expect(
    recoverComposition(platform, original, "host.recovery.test"),
  ).rejects.toThrow("receipt lost");
  expect(states.get("host.shell")).toEqual(original);
  expect(states.get("host.recovery.test")?.value).toEqual(original.value);
});
it("unknown source receipt retains backup even if reset committed", async () => {
  const { states, platform } = setup();
  const call = platform.call;
  platform.call = async (owner, cap, payload) => {
    const result = await call(owner, cap, payload);
    if (owner === "host.shell" && cap === "state.write")
      throw Error("receipt lost");
    return result;
  };
  await expect(
    recoverComposition(platform, original, "host.recovery.test"),
  ).rejects.toThrow("receipt lost");
  expect(states.get("host.recovery.test")?.value).toEqual(original.value);
  expect(states.get("host.shell")?.value).not.toHaveProperty("composition");
});
