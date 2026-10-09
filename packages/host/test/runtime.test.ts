import { describe, it, expect, afterEach, vi } from "vitest";
import { ExtensionRuntime } from "../src/runtime.js";
import type { RuntimeBridge } from "../src/foundation-runtime.js";
import { CAPABILITY_FAILED, PlumsError } from "@plums/core";
const runtimes: ExtensionRuntime[] = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(runtimes.splice(0).map((r) => r.close()));
});
function runtime(
  source: string,
  bridge: RuntimeBridge = async () => ({ safe: true }),
  lifecycle?: () => void,
) {
  const r = new ExtensionRuntime(
    "demo",
    {
      sdkVersion: "1",
      runtime: "main.js",
      contributes: { commands: [{ name: "check", title: "Check" }] },
    },
    bridge,
    { "main.js": source },
    undefined,
    undefined,
    lifecycle,
  );
  runtimes.push(r);
  return r;
}
describe("V8 extension boundary", () => {
  it("runs module handlers without exposing Node or isolated-vm references", async () => {
    const r = runtime(
      `export function activate(sdk){sdk.register('commands','check',async()=>({process:typeof process,require:typeof require,fetch:typeof fetch,bridge:await sdk.settings(),constructor:sdk.settings.constructor('return typeof process')()}));}`,
    );
    await r.ready();
    expect(
      await r.invoke(
        "commands",
        "check",
        {},
        { callers: [], ancestry: ["demo"], signal: r.controller.signal },
      ),
    ).toEqual({
      process: "undefined",
      require: "undefined",
      fetch: "undefined",
      bridge: { safe: true },
      constructor: "undefined",
    });
  });
  it("refuses undeclared handlers and external module imports", async () => {
    const r = runtime(
      `export function activate(sdk){sdk.register('commands','check',()=>1)}`,
    );
    await r.ready();
    await expect(
      r.invoke(
        "tools",
        "hidden",
        {},
        { callers: [], ancestry: ["demo"], signal: r.controller.signal },
      ),
    ).rejects.toThrow();
    const external = runtime(
      `import fs from 'node:fs';export function activate(){}`,
    );
    await expect(external.ready()).rejects.toThrow();
  });
  it("transports opaque JSON keys as data across invocation, replies and events", async () => {
    const payload = JSON.parse(
      '{"__proto__":{"opaque":true},"nested":{"__proto__":{"deep":true}},"text":"literal ); globalThis.injected = true; ("}',
    );
    const r = new ExtensionRuntime(
      "opaque-json",
      {
        sdkVersion: "2",
        runtime: "main.js",
        contributes: { commands: [{ name: "check", title: "Check" }] },
      },
      async () => payload,
      {
        "main.js": `let event;const inspect=value=>({value,own:Object.hasOwn(value,'__proto__'),plain:Object.getPrototypeOf(value)===Object.prototype,nested:Object.hasOwn(value.nested,'__proto__')});export function activate(sdk){sdk.onEvent('update',value=>{event=value.data});sdk.register('commands','check',async input=>({input:inspect(input),reply:inspect(await sdk.settings()),event:inspect(event),injected:typeof globalThis.injected,process:typeof process}));}`,
      },
    );
    runtimes.push(r);
    await r.ready();
    const context = {
      callers: [],
      ancestry: ["opaque-json"],
      signal: r.controller.signal,
    };
    await r.deliverEvent(
      "update",
      { packageId: "publisher", topic: "update", data: payload },
      context,
    );
    const expected = { value: payload, own: true, plain: true, nested: true };
    expect(await r.invoke("commands", "check", payload, context)).toEqual({
      input: expected,
      reply: expected,
      event: expected,
      injected: "undefined",
      process: "undefined",
    });
    expect(Object.getPrototypeOf(payload)).toBe(Object.prototype);
    await r.close();
  });
  it("terminates an infinite loop without terminating the host", async () => {
    const r = runtime(
      `export function activate(sdk){sdk.register('commands','check',()=>{while(true){}})}`,
    );
    await r.ready();
    await expect(
      r.invoke(
        "commands",
        "check",
        {},
        { callers: [], ancestry: ["demo"], signal: r.controller.signal },
      ),
    ).rejects.toThrow();
    expect(1 + 1).toBe(2);
  });
});
it("refuses I/O during activation and preserves capability failure metadata", async () => {
  const r = runtime(
    `export async function activate(s){let denied=false;try{await s.capability('files',{kind:'fs',operation:'list',path:'.'});}catch{denied=true;}s.register('commands','check',()=>denied)}`,
  );
  await r.ready();
  expect(
    await r.invoke(
      "commands",
      "check",
      {},
      { callers: [], ancestry: ["demo"], signal: r.controller.signal },
    ),
  ).toBe(true);
});
it("delivers events through copied data and runs the optional deactivation hook", async () => {
  const r = runtime(
    `let last;export function activate(s){s.onEvent('update',e=>{last=e});s.register('commands','check',()=>last)}export function deactivate(){}`,
  );
  await r.ready();
  const ctx = { callers: [], ancestry: ["demo"], signal: r.controller.signal };
  await r.deliverEvent(
    "update",
    { packageId: "publisher", topic: "update", data: { a: 1 } },
    ctx,
  );
  expect(await r.invoke("commands", "check", {}, ctx)).toEqual({
    packageId: "publisher",
    topic: "update",
    data: { a: 1 },
  });
  r.stop();
});

it("a missing ordinary runtime closes after spawn failure without hanging host cleanup", async () => {
  const runtime = new ExtensionRuntime(
    "missing",
    { runtime: "main.js", contributes: {} },
    async () => null,
    { "main.js": "export function activate() {}" },
    "/no/fixture/node",
  );
  await expect(runtime.ready()).rejects.toBeDefined();
  await runtime.close();
}, 3000);

it("resumes idle lifecycle checks after a pending host request settles", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let entered!: () => void,
    release!: () => void,
    stale = false;
  const requested = new Promise<void>((resolve) => (entered = resolve));
  const response = new Promise<void>((resolve) => (release = resolve));
  const r = runtime(
    `export function activate(s){s.register('commands','check',()=>s.settings());}`,
    async () => {
      entered();
      await response;
      return { safe: true };
    },
    () => {
      if (stale) throw Error("private lifecycle detail");
    },
  );
  try {
    await r.ready();
    const work = r.invoke(
      "commands",
      "check",
      {},
      {
        callers: [],
        ancestry: ["demo"],
        signal: r.controller.signal,
      },
    );
    await requested;
    stale = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(r.alive).toBe(true);
    release();
    expect(await work).toEqual({ safe: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.alive).toBe(false);
    await expect(
      r.invoke(
        "commands",
        "check",
        {},
        {
          callers: [],
          ancestry: ["demo"],
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toThrow("Extension stopped");
  } finally {
    release();
    await r.close();
  }
});

it("ordinary cancellation still stops a runtime during a pending host request", async () => {
  let entered!: () => void, release!: () => void;
  const requested = new Promise<void>((resolve) => (entered = resolve));
  const response = new Promise<void>((resolve) => (release = resolve));
  const r = runtime(
    `export function activate(s){s.register('commands','check',()=>s.settings());}`,
    async () => {
      entered();
      await response;
      return null;
    },
  );
  try {
    await r.ready();
    const controller = new AbortController();
    const work = r
      .invoke(
        "commands",
        "check",
        {},
        {
          callers: [],
          ancestry: ["demo"],
          signal: controller.signal,
        },
      )
      .catch((error: unknown) => error);
    await requested;
    controller.abort();
    expect(await work).toMatchObject({ message: "Extension stopped" });
    expect(await work).not.toHaveProperty("code");
    expect(r.alive).toBe(false);
  } finally {
    release();
    await r.close();
  }
});

it("preserves a trusted host failure while its SDK reply awaits the worker result", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  let replied!: () => void,
    stale = false;
  const acknowledged = new Promise<void>((resolve) => (replied = resolve));
  const failure = new PlumsError({
    code: CAPABILITY_FAILED,
    message: "能力调用失败。",
    details: {
      callId: "trusted-host-call",
      phase: "sink",
      executionState: "unknown",
    },
  });
  const r = runtime(
    `export function activate(s){s.register('commands','check',async()=>{try{await s.capability('data',{kind:'fs',operation:'read',path:'fixture'});}catch(error){await s.settings();const until=Date.now()+1000;while(Date.now()<until){};throw error;}});}`,
    async (method) => {
      if (method === "capability") throw failure;
      replied();
      return null;
    },
    () => {
      if (stale) throw Error("private lifecycle detail");
    },
  );
  try {
    await r.ready();
    const work = r
      .invoke(
        "commands",
        "check",
        {},
        {
          callers: [],
          ancestry: ["demo"],
          signal: r.controller.signal,
        },
      )
      .catch((error: unknown) => error);
    await acknowledged;
    await new Promise<void>((resolve) => setImmediate(resolve));
    stale = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(await work).toBe(failure);
    await vi.advanceTimersByTimeAsync(1000);
    expect(r.alive).toBe(false);
  } finally {
    await r.close();
  }
});

const busy = (ms: number) =>
  `const end=Date.now()+${ms};while(Date.now()<end){}`;
const invokeCheck = (r: ExtensionRuntime) =>
  r.invoke(
    "commands",
    "check",
    {},
    { callers: [], ancestry: ["demo"], signal: r.controller.signal },
  );

it("counts overlapping isolate evaluations once and resets the budget for each invocation", async () => {
  const r = runtime(
    `export function activate(s){s.register('commands','check',async()=>{await s.settings();${busy(4600)}return {ok:true};});}`,
  );
  try {
    await r.ready();
    expect(await invokeCheck(r)).toEqual({ ok: true });
    expect(await invokeCheck(r)).toEqual({ ok: true });
  } finally {
    await r.close();
  }
});
it("shares the five-second startup budget between entry evaluation and activation", async () => {
  const r = runtime(
    `${busy(2700)}export function activate(s){${busy(2700)}s.register('commands','check',()=>true);}`,
  );
  try {
    await expect(r.ready()).rejects.toThrow("Extension stopped");
    expect(r.alive).toBe(false);
  } finally {
    await r.close();
  }
});
it("enforces the cumulative execution budget across separate host replies", async () => {
  let calls = 0;
  const r = runtime(
    `export function activate(s){s.register('commands','check',async()=>{for(let i=0;i<3;i++){await s.settings();${busy(1800)}}return true;});}`,
    async () => {
      calls++;
      return null;
    },
  );
  try {
    await r.ready();
    await expect(invokeCheck(r)).rejects.toThrow("Extension stopped");
    expect(calls).toBe(3);
    expect(r.alive).toBe(false);
  } finally {
    await r.close();
  }
});
it("gives an event and the following invocation separate execution budgets", async () => {
  const r = runtime(
    `export function activate(s){s.onEvent('slow',async()=>{await s.settings();${busy(4600)}});s.register('commands','check',async()=>{await s.settings();${busy(4600)}return true;});}`,
  );
  try {
    await r.ready();
    await r.deliverEvent(
      "slow",
      { packageId: "publisher", topic: "slow", data: {} },
      { callers: [], ancestry: ["demo"], signal: r.controller.signal },
    );
    expect(await invokeCheck(r)).toBe(true);
  } finally {
    await r.close();
  }
});
it("stops an isolate exceeding its memory limit while leaving the host alive", async () => {
  const r = runtime(
    `export function activate(s){s.register('commands','check',()=>{const retained=[];while(true)retained.push(new Array(1000000).fill('retained'));});}`,
  );
  try {
    await r.ready();
    await expect(invokeCheck(r)).rejects.toThrow("Extension stopped");
    expect(r.alive).toBe(false);
    expect(1 + 1).toBe(2);
  } finally {
    await r.close();
  }
});
it("preserves the second trusted failure after overlapping long host waits", async () => {
  let entered!: () => void,
    firstRelease!: () => void,
    secondRelease!: () => void;
  const waiting = new Promise<void>((resolve) => (entered = resolve)),
    firstWait = new Promise<void>((resolve) => (firstRelease = resolve)),
    secondWait = new Promise<void>((resolve) => (secondRelease = resolve));
  let waits = 0,
    calls = 0,
    stale = false;
  const first = new PlumsError({
    code: CAPABILITY_FAILED,
    message: "First",
    details: { callId: "first", phase: "sink", executionState: "unknown" },
  });
  const second = new PlumsError({
    code: CAPABILITY_FAILED,
    message: "Second",
    details: {
      callId: "second",
      phase: "audit_result",
      executionState: "completed",
    },
  });
  const r = runtime(
    `export function activate(s){s.register('commands','check',async()=>{try{await s.capability('data',{kind:'fs',operation:'read',path:'first'});}catch{};await Promise.all([s.settings(),s.settings()]);try{await s.capability('data',{kind:'fs',operation:'read',path:'second'});}catch(error){${busy(1000)}throw error;}});}`,
    async (method) => {
      if (method === "capability") throw ++calls === 1 ? first : second;
      if (++waits === 1) await firstWait;
      else {
        entered();
        await secondWait;
      }
      return null;
    },
    () => {
      if (stale) throw Error("private stale detail");
    },
  );
  let work: Promise<unknown> | undefined;
  try {
    await r.ready();
    work = invokeCheck(r).catch((error: unknown) => error);
    await waiting;
    stale = true;
    await new Promise((resolve) => setTimeout(resolve, 3100));
    firstRelease();
    await new Promise((resolve) => setTimeout(resolve, 3100));
    expect(r.alive).toBe(true);
    secondRelease();
    expect(await work).toBe(second);
    expect(calls).toBe(2);
    expect(waits).toBe(2);
  } finally {
    firstRelease();
    secondRelease();
    await r.close();
    await work;
  }
});
it("does not renew the error-delivery allowance on another host failure", async () => {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((resolve) => (entered = resolve)),
    response = new Promise<void>((resolve) => (release = resolve));
  let stale = false,
    calls = 0;
  // Keep the first error handler idle for 3 seconds before it starts the next RPC.
  const r = runtime(
    `export function activate(s){s.register('commands','check',async()=>{try{await s.capability('data',{kind:'fs',operation:'read',path:'first'});}catch{const end=Date.now()+3000;while(Date.now()<end){}}await s.settings();try{await s.capability('data',{kind:'fs',operation:'read',path:'second'});}catch{await new Promise(()=>{});}});}`,
    async (method) => {
      if (method === "capability") {
        calls++;
        throw Error("private host failure");
      }
      entered();
      await response;
      return null;
    },
    () => {
      if (stale) throw Error("private stale detail");
    },
  );
  let work: Promise<unknown> | undefined;
  try {
    await r.ready();
    work = invokeCheck(r).catch((error: unknown) => error);
    await waiting;
    stale = true;
    release();
    const outcome = await Promise.race([
      work,
      new Promise((resolve) =>
        setTimeout(() => resolve({ unfinished: true }), 4000),
      ),
    ]);
    expect(outcome).toMatchObject({ message: "Extension stopped" });
    expect(outcome).not.toHaveProperty("code");
    expect(calls).toBe(2);
    expect(r.alive).toBe(false);
  } finally {
    release();
    await r.close();
    await work;
  }
});

it("clears failure delivery state after results and grants a fresh allowance to the next invocation", async () => {
  let count = 0,
    stale = false;
  const failure = new PlumsError({
    code: CAPABILITY_FAILED,
    message: "Trusted",
    details: { callId: "fresh-call", phase: "sink", executionState: "unknown" },
  });
  const r = runtime(
    `let count=0;export function activate(s){s.register('commands','check',async()=>{count++;try{await s.capability('data',{kind:'fs',operation:'read',path:'fixture'});}catch(error){await s.settings();const end=Date.now()+(count===1?1800:3600);while(Date.now()<end){};if(count===2)throw error;}return true;});}`,
    async (method) => {
      if (method === "capability") throw failure;
      stale = ++count === 2;
      return null;
    },
    () => {
      if (stale) throw Error("private stale detail");
    },
  );
  try {
    await r.ready();
    expect(await invokeCheck(r)).toBe(true);
    expect(await invokeCheck(r).catch((error: unknown) => error)).toBe(failure);
    expect(count).toBe(2);
  } finally {
    await r.close();
  }
});
it.each(["cancel", "exit"] as const)(
  "keeps ordinary %s semantics after a cached host failure",
  async (action) => {
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => (entered = resolve));
    const failure = new PlumsError({
      code: CAPABILITY_FAILED,
      message: "Trusted",
      details: {
        callId: "not-selected-on-stop",
        phase: "sink",
        executionState: "unknown",
      },
    });
    const r = runtime(
      `export function activate(s){s.register('commands','check',async()=>{try{await s.capability('data',{kind:'fs',operation:'read',path:'fixture'});}catch{};await s.settings();await new Promise(()=>{});});}`,
      async (method) => {
        if (method === "capability") throw failure;
        entered();
        return null;
      },
    );
    let work: Promise<unknown> | undefined;
    try {
      await r.ready();
      work = invokeCheck(r).catch((error: unknown) => error);
      await waiting;
      if (action === "cancel") r.controller.abort();
      else
        process.kill(
          (r as unknown as { child: { pid: number } }).child.pid,
          "SIGKILL",
        );
      expect(await work).toMatchObject({ message: "Extension stopped" });
      expect(await work).not.toHaveProperty("code");
      expect(r.alive).toBe(false);
    } finally {
      await r.close();
      await work;
    }
  },
);
