import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  createArchive,
  MemorySecretStore,
  RecordingFsSink,
  RecordingExecSink,
  RecordingEgressSink,
  PlumsError,
  redact,
  type AuditEvent,
  type ManifestV2,
} from "@plums/core";
import { DesktopHost } from "../src/host.js";
import { ControlledExecution } from "../src/controlled-execution.js";

const hosts: DesktopHost[] = [],
  directories: string[] = [];
afterEach(async () => {
  for (const host of hosts.splice(0)) await host.close();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
    await assert.rejects(lstat(directory), { code: "ENOENT" });
  }
});

type Mode = "read" | "write" | "list" | "exec" | "egress" | "service";
async function fixture(
  value: string,
  options: {
    persisted?: boolean;
    failure?: boolean;
    refused?: boolean;
    connection?: boolean;
  } = {},
) {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "plums-sdk-controls-"),
  );
  directories.push(directory);
  const work = path.join(directory, "work");
  await mkdir(work);
  await writeFile(path.join(work, "item"), "Synthetic path metadata");
  const events: Readonly<AuditEvent>[] = [],
    secrets = new MemorySecretStore();
  const body = JSON.stringify({
    callId: value,
    kind: value,
    operation: value,
    completed: value,
    result: { callId: value },
    __proto__: null,
  });
  const fs = new RecordingFsSink({
    data: new Uint8Array([9, 8, 7]),
    entries: [{ name: value, type: "file" }],
  });
  const exec = new RecordingExecSink({ stdout: body, stderr: value });
  const run = vi
    .spyOn(ControlledExecution.prototype, "run")
    .mockImplementation(
      async (program, args, cwd, _reads, _writes, _signal, check) => {
        await check();
        return exec.run({ program, args, cwd, rootPath: work });
      },
    );
  const egress = new RecordingEgressSink({}, { status: 200, body });
  const host = new DesktopHost({
    dataDir: path.join(directory, "data"),
    nodePath: path.resolve(".artifacts/node-v26.5.1-darwin-arm64/bin/node"),
    secretStore: () => secrets,
    fs,
    egress,
    confirm: { ask: async () => !options.refused },
    ...(options.persisted
      ? {}
      : {
          audit: async (_id: string, event: Readonly<AuditEvent>) => {
            events.push(event);
            if (
              options.failure &&
              event.kind === "fs" &&
              event.phase === "result"
            )
              throw Error("Synthetic audit failure");
          },
        }),
  });
  hosts.push(host);
  await host.initialize();
  const packageId = "fixture.sdk-controls";
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    kind: "connector",
    id: packageId,
    name: "Synthetic controls",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [
      {
        id: "files",
        kind: "fs",
        target: "work",
        operations: ["read", "write", "list"],
        reason: "Synthetic",
      },
      {
        id: "command",
        kind: "exec",
        target: "test-program",
        cwdRoots: ["work"],
        reason: "Synthetic",
      },
      {
        id: "network",
        kind: "egress",
        target: "sdk.plums-fixture.test",
        reason: "Synthetic",
      },
      {
        id: "api",
        kind: "service",
        target: "https",
        operations: ["request"],
        reason: "Synthetic",
      },
    ],
    settingsSchema: {
      type: "object",
      properties: {
        token: {
          type: "string",
          "x-secret": true,
          title: "Token",
          description: "Synthetic",
        },
        url: {
          type: "string",
          title: "URL",
          description: "Synthetic",
          default: "https://sdk.plums-fixture.test/base",
        },
      },
    },
    payload: {
      plumsDesktop: {
        sdkVersion: "2",
        runtime: "main.js",
        foundation: {
          requirementVersion: "1.0",
          protocolRange: "^1.0.0",
          sdk: { id: "org.plums.sdk", version: "2.0.0" },
          features: ["sdk.register", "sdk.capability", "sdk.connection"],
        },
        connections: options.connection
          ? [
              {
                id: "endpoint",
                permissionId: "api",
                baseURLSetting: "url",
                credentials: [{ setting: "token", header: "X-Synthetic" }],
              },
            ]
          : [],
        contributes: {
          commands: [
            {
              name: "check",
              title: "Check",
              inputSchema: {},
              outputSchema: {},
            },
          ],
        },
      },
    },
  };
  // Boolean observations avoid redacting the SDK measurement itself. The persisted
  // audit case also returns its UUID as data for an exact correlation check.
  const source = `export function activate(s){s.register('commands','check',async input=>{
    if(input.echo)return input.echo;
    let request,permission;
    const mode=input.mode;
    if(['read','write','list'].includes(mode)){permission='files';request={kind:'fs',operation:mode,path:mode==='list'?'.':'item',...(mode==='write'?{data:[1]}:{})};}
    else if(mode==='exec'){permission='command';request={kind:'exec',args:[],cwd:{root:'work',path:'.'}};}
    else if(mode==='egress'){permission='network';request={kind:'egress',url:'https://sdk.plums-fixture.test/item'};}
    else {permission='api';const b=await s.connection('endpoint');request={kind:'service',operation:'request',binding:b.binding,sources:[],input:{path:'/item'}};}
    try {
      const r=await s.capability(permission,request);
      if(input.correlation)return [r.callId];
      if(input.failResponse){try{await s.failResponse(r.callId,'RESPONSE_INVALID');}catch(e){return [typeof r.callId==='string',e.details?.callId===r.callId,e.details?.executionState==='completed'];}}
      const keys=['callId','kind',...(['read','write','list','service'].includes(mode)?['operation']:[]),...(mode==='read'?['data']:mode==='write'?['completed']:mode==='list'?['entries']:['result'])];
      const content=mode==='read'?r.data:mode==='write'?r.completed:mode==='list'?r.entries:r.result;
      return [typeof r.callId==='string'&&/^[0-9a-f-]{36}$/.test(r.callId),r.kind===request.kind,keys.every(k=>Object.hasOwn(r,k)),(['read','write','list'].includes(mode)?r.operation===mode:true),mode==='write'?content===true:mode==='read'?JSON.stringify(content)==='[9,8,7]':content!==undefined,mode==='service'?r.operation===input.expectedOperation:true,mode==='write'||mode==='read'?true:JSON.stringify(content)===input.expectedContent];
    } catch(e) {return [false,typeof e.details?.callId==='string',e.details?.phase==='audit_result',e.details?.executionState==='completed'];}
  });}`;
  const item = await host.importLibrary(
    (
      (await host.preview(
        await createArchive({
          "manifest.json": Buffer.from(JSON.stringify(manifest)),
          "main.js": Buffer.from(source),
        }),
      )) as { token: string }
    ).token,
  );
  const agent = await host.createAgent("Synthetic SDK controls", [item.digest]);
  await host.setSettings(agent.instanceId, packageId, {}, { token: value });
  await host.bindRoot(agent.instanceId, "work", work);
  await host.bindControlledProgram(
    agent.instanceId,
    "test-program",
    "/usr/bin/true",
    ["work"],
    [],
  );
  await host.enable(agent.instanceId, packageId);
  const invoke = (mode: Mode, extra: Record<string, unknown> = {}) => {
    const content =
      mode === "list"
        ? [{ name: value, type: "file" }]
        : mode === "exec"
          ? { exitCode: 0, stdout: body, stderr: value }
          : { status: 200, body };
    return host.invoke(
      agent.instanceId,
      packageId,
      packageId,
      "commands",
      "check",
      {
        mode,
        expectedContent: JSON.stringify(redact(content, [value])),
        expectedOperation: redact("request", [value]),
        ...extra,
      },
    );
  };
  return { host, agent, packageId, events, fs, exec, egress, run, invoke };
}

it.each(["callId", "kind", "fs", "operation", "write", "completed", "a"])(
  "preserves platform-generated write controls when a synthetic credential is %s",
  async (value) => {
    const f = await fixture(value);
    expect(await f.invoke("write")).toEqual(Array(7).fill(true));
    expect(f.fs.records).toHaveLength(1);
    expect(f.egress.records).toEqual([]);
    expect(f.exec.records).toEqual([]);
    const events = f.events.filter(
      (e) => e.kind === "fs" && ["allow", "result"].includes(e.phase),
    );
    expect(events).toHaveLength(2);
    expect(events[0]!.callId).toBe(events[1]!.callId);
    expect(events[1]!.executionState).toBe("completed");
  },
);

it.each([
  ["read", "callId"],
  ["read", "a"],
  ["read", "data"],
  ["list", "callId"],
  ["list", "a"],
  ["list", "entries"],
  ["list", "list"],
  ["exec", "callId"],
  ["exec", "a"],
  ["exec", "result"],
  ["exec", "exec"],
  ["egress", "callId"],
  ["egress", "a"],
  ["egress", "result"],
  ["egress", "egress"],
  ["service", "callId"],
  ["service", "result"],
  ["service", "service"],
  ["service", "operation"],
  ["service", "request"],
] as const)(
  "preserves the %s envelope but redacts Sink data for credential %s",
  async (mode, value) => {
    const f = await fixture(value, { connection: mode === "service" });
    expect(await f.invoke(mode)).toEqual(Array(7).fill(true));
    expect(
      f.fs.records.length + f.egress.records.length + f.exec.records.length,
    ).toBe(1);
    expect(f.run).toHaveBeenCalledTimes(mode === "exec" ? 1 : 0);
  },
);

it("keeps the successful SDK correlation tied to the default persisted audit", async () => {
  const f = await fixture("callId", { persisted: true });
  const reply = await f.invoke("write", { correlation: true });
  const events = (
    (await f.host.audit(f.agent.instanceId)) as AuditEvent[]
  ).filter((e) => e.kind === "fs" && ["allow", "result"].includes(e.phase));
  expect(events).toHaveLength(2);
  expect(reply).toEqual([events[0]!.callId]);
  expect(typeof events[0]!.callId).toBe("string");
  expect(events[0]!.callId).toBe(events[1]!.callId);
  expect(events[1]!.executionState).toBe("completed");
});

it.each(["callId", "completed"])(
  "keeps completed failure delivery unchanged for credential %s",
  async (value) => {
    const f = await fixture(value, { failure: true });
    expect(await f.invoke("write")).toEqual([false, true, true, true]);
    expect(f.fs.records).toHaveLength(1);
  },
);

it("uses the successful SDK callId for the current service response receipt", async () => {
  const f = await fixture("callId", { connection: true });
  expect(await f.invoke("service", { failResponse: true })).toEqual([
    true,
    true,
    true,
  ]);
  expect(f.egress.records).toHaveLength(1);
});

it.each(["callId", "completed", "a"])(
  "redacts fabricated business controls and nested same-name fields for credential %s",
  async (value) => {
    const f = await fixture(value);
    const echo = JSON.parse(
      `{"callId":"${value}","kind":"${value}","operation":"${value}","completed":"${value}","nested":{"callId":"${value}","__proto__":{"completed":"${value}"}}}`,
    );
    expect(await f.invoke("write", { echo })).toEqual(redact(echo, [value]));
    expect(f.fs.records).toEqual([]);
    expect(f.egress.records).toEqual([]);
    expect(
      redact(
        new PlumsError({
          code: "CAPABILITY_FAILED",
          message: value,
          details: echo,
        }),
        [value],
      ).details,
    ).toEqual(redact(echo, [value]));
  },
);

it("does not execute a capability when the confirmation is refused", async () => {
  const f = await fixture("callId", { refused: true });
  expect(await f.invoke("write")).toEqual([false, false, false, false]);
  expect(f.fs.records).toEqual([]);
});
