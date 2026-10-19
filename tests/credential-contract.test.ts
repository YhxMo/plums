import { describe, expect, it } from "vitest";
import {
  FakeCredentialPlatform,
  type FakeTransport,
} from "./fixtures/credential-platform";
import { PlatformAdapter } from "../src/platform";
const owner = "extension.probe.alpha";
const capability = "credential.request";
const request = { version: 1, binding: "text", body: "hello" };
const binding = {
  owner,
  id: "text",
  target: "https://connector.invalid/submit",
};
const ok = async () => ({ status: 200, body: "synthetic response" });
async function setup(send: FakeTransport = ok) {
  const platform = new FakeCredentialPlatform([binding], send);
  await platform.grant(owner, [capability]);
  return platform;
}
describe("credential delegation contract reference model", () => {
  it("keeps production capability unavailable", async () => {
    const p = new PlatformAdapter();
    expect(p.available(capability)).toBe(false);
    await expect(p.grant(owner, [capability])).rejects.toThrow();
    await expect(p.call(owner, capability, request)).rejects.toThrow();
  });
  it("substitutes only platform-owned target and fake credential", async () => {
    const calls: unknown[] = [];
    const p = await setup(async (input?: unknown) => {
      calls.push(input);
      return ok();
    });
    expect(await p.call(owner, capability, request)).toEqual(await ok());
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      target: binding.target,
      method: "POST",
      authorization: "Bearer fake-only:extension.probe.alpha:text",
      body: "hello",
    });
  });
  it.each([
    { ...request, owner },
    { ...request, url: "https://other.invalid" },
    { ...request, headers: {} },
    { ...request, version: 2 },
    { ...request, binding: "missing" },
    { ...request, body: 9 },
    { ...request, body: "梅".repeat(21846) },
    null,
  ])(
    "rejects invalid or overbroad request before dispatch: %j",
    async (bad) => {
      let calls = 0;
      const p = await setup(async () => {
        calls++;
        return ok();
      });
      await expect(p.call(owner, capability, bad)).rejects.toMatchObject({
        outcome: "not-dispatched",
      });
      expect(calls).toBe(0);
    },
  );
  it("rejects ungranted and cross-owner binding use", async () => {
    let calls = 0;
    const p = await setup(async () => {
      calls++;
      return ok();
    });
    const other = "extension.probe.beta";
    await expect(p.call(other, capability, request)).rejects.toMatchObject({
      outcome: "not-dispatched",
    });
    await p.grant(other, [capability]);
    await expect(p.call(other, capability, request)).rejects.toMatchObject({
      outcome: "not-dispatched",
    });
    expect(calls).toBe(0);
  });
  it.each([
    { status: 302, body: "redirect" },
    { status: 200, body: "x".repeat(2 * 1024 * 1024 + 1) },
    { status: 99, body: "bad" },
  ])("does not deliver redirect or invalid response", async (response) => {
    const p = await setup(async () => response);
    await expect(p.call(owner, capability, request)).rejects.toMatchObject({
      outcome: "unknown",
    });
  });
  it("sanitizes transport failures without claiming no remote effect", async () => {
    const p = await setup(async () => {
      throw Error("fake-only confidential upstream detail");
    });
    await expect(p.call(owner, capability, request)).rejects.toMatchObject({
      message: "Credential request failed",
      outcome: "unknown",
    });
  });
  it("rejects pre-abort without dispatch", async () => {
    let calls = 0;
    const p = await setup(async () => {
      calls++;
      return ok();
    });
    const c = new AbortController();
    c.abort();
    await expect(
      p.call(owner, capability, request, c.signal),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
    expect(calls).toBe(0);
  });
  it.each(["abort", "revoke"])(
    "rejects late result after %s, including regrant",
    async (mode) => {
      let finish!: (value: { status: number; body: string }) => void;
      let signal!: AbortSignal;
      const p = await setup(async (input) => {
        signal = input.signal;
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
      const c = new AbortController();
      const pending = p.call(owner, capability, request, c.signal);
      if (mode === "abort") c.abort();
      else {
        await p.grant(owner, []);
        await p.grant(owner, [capability]);
      }
      expect(signal.aborted).toBe(true);
      finish(await ok());
      await expect(pending).rejects.toMatchObject({ outcome: "unknown" });
    },
  );
});

it.each(["abort", "revoke"])(
  "does not dispatch after payload getter %s",
  async (mode) => {
    let calls = 0;
    const p = await setup(async () => {
      calls++;
      return ok();
    });
    const c = new AbortController();
    const input = {
      ...request,
      get body() {
        if (mode === "abort") c.abort();
        else void p.grant(owner, []);
        return "hello";
      },
    };
    await expect(
      p.call(owner, capability, input, c.signal),
    ).rejects.toMatchObject({ outcome: "not-dispatched" });
    expect(calls).toBe(0);
  },
);
it("dispatches the validated scalar snapshot only once", async () => {
  const bodies: string[] = [];
  let reads = 0;
  const p = await setup(async (input) => {
    bodies.push(input.body);
    return ok();
  });
  await p.call(owner, capability, {
    ...request,
    get body() {
      return ++reads === 1 ? "hello" : "x".repeat(5000);
    },
  });
  expect(reads).toBe(1);
  expect(bodies).toEqual(["hello"]);
});

it.each([
  "http://connector.invalid/submit",
  "https://example.com/submit",
  "https://user@connector.invalid/submit",
  "https://connector.invalid:8443/submit",
  "https://connector.invalid/submit?key=fake",
  "https://connector.invalid/submit#fragment",
])("rejects unsuitable fake binding target %s", (target) => {
  expect(
    () => new FakeCredentialPlatform([{ ...binding, target }], ok),
  ).toThrow();
});
it("rejects duplicate binding and preserves copied target", async () => {
  expect(() => new FakeCredentialPlatform([binding, binding], ok)).toThrow();
  const seed = { ...binding };
  const targets: string[] = [];
  const p = new FakeCredentialPlatform([seed], async (input) => {
    targets.push(input.target);
    return ok();
  });
  seed.target = "https://changed.invalid/";
  await p.grant(owner, [capability]);
  await p.call(owner, capability, request);
  expect(targets).toEqual([binding.target]);
});
it("allows exact byte boundaries and returns HTTP errors without retry", async () => {
  let calls = 0;
  const p = await setup(async () => {
    calls++;
    return { status: 429, body: "x".repeat(2 * 1024 * 1024) };
  });
  expect(
    await p.call(owner, capability, { ...request, body: "x".repeat(65536) }),
  ).toEqual({ status: 429, body: "x".repeat(2 * 1024 * 1024) });
  expect(calls).toBe(1);
});

it("rejects response getter revocation before delivery", async () => {
  const p: FakeCredentialPlatform = await setup(async () => ({
    status: 200,
    get body() {
      void p.grant(owner, []);
      return "hello";
    },
  }));
  await expect(p.call(owner, capability, request)).rejects.toMatchObject({
    outcome: "unknown",
  });
});
it("delivers only the validated response scalar snapshot", async () => {
  let reads = 0;
  const p = await setup(async () => ({
    status: 200,
    get body() {
      return ++reads === 1 ? "hello" : "x".repeat(2 * 1024 * 1024 + 1);
    },
  }));
  expect(await p.call(owner, capability, request)).toEqual({
    status: 200,
    body: "hello",
  });
  expect(reads).toBe(1);
});

it("Host rejects an undeclared credential capability before adapter dispatch", async () => {
  const { Host } = await import("../modules/extension-host/host");
  let calls = 0;
  const p = await setup(async () => {
    calls++;
    return ok();
  });
  const host = new Host(p);
  let context!: import("../modules/sdk").ExtensionContext;
  host.install({
    manifest: { id: "probe.alpha", version: "1", apiVersion: 1 },
    activate(ctx) {
      context = ctx;
    },
  });
  await host.start("probe.alpha");
  try {
    await expect(context.platform(capability, request)).rejects.toMatchObject({
      outcome: "not-committed",
    });
    expect(calls).toBe(0);
  } finally {
    await host.stop("probe.alpha");
  }
});
