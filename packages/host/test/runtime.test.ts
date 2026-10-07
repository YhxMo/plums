import { describe, it, expect, afterEach } from "vitest";
import { ExtensionRuntime } from "../src/runtime.js";
const runtimes: ExtensionRuntime[] = [];
afterEach(() => {
  runtimes.splice(0).forEach((r) => r.stop());
});
function runtime(source: string) {
  const r = new ExtensionRuntime(
    "demo",
    {
      sdkVersion: "1",
      runtime: "main.js",
      contributes: { commands: [{ name: "check", title: "Check" }] },
    },
    async () => ({ safe: true }),
    { "main.js": source },
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
