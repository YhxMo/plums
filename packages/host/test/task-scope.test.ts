import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import https from "node:https";
import {
  createArchive,
  MemorySecretStore,
  RecordingFsSink,
  type ManifestV2,
  type AuditEvent,
} from "@plums/core";
import { DesktopHost } from "../src/host.js";
import { HttpsSink, SecureFsSink } from "../src/io.js";
vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.215.14", family: 4 }],
}));
const dirs: string[] = [],
  hosts: DesktopHost[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  hosts.splice(0).forEach((h) => h.close());
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture(realFiles = false) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-task-host-"));
  dirs.push(dir);
  const stores = new Map<string, MemorySecretStore>();
  const confirm = { ask: vi.fn(async () => true) },
    fs = new RecordingFsSink();
  const options = {
    dataDir: dir,
    confirm,
    fs: realFiles
      ? new SecureFsSink(path.resolve("packages/host/dist/secure-fs"))
      : fs,
    egress: new HttpsSink(),
    secretStore(id: string) {
      if (!stores.has(id)) stores.set(id, new MemorySecretStore());
      return stores.get(id)!;
    },
  };
  const host = new DesktopHost(options);
  hosts.push(host);
  await host.initialize();
  const manifest: ManifestV2 = {
    formatVersion: "2.0",
    id: "service",
    kind: "connector",
    name: "Service",
    version: "1.0.0",
    description: "",
    dependencies: [],
    permissions: [
      {
        id: "net",
        kind: "egress",
        target: "api.example.com",
        reason: "Task API",
      },
      {
        id: "files",
        kind: "fs",
        target: "agent-data",
        operations: ["read", "write", "list"],
        reason: "Task files",
      },
    ],
    settingsSchema: {
      type: "object",
      properties: {
        key: {
          type: "string",
          title: "API key",
          description: "Synthetic key",
          "x-secret": true,
        },
      },
      required: ["key"],
    },
    payload: {
      plumsDesktop: {
        sdkVersion: "1",
        runtime: "main.js",
        credentials: [
          {
            permissionId: "net",
            setting: "key",
            header: "Authorization",
            prefix: "Bearer ",
          },
        ],
        contributes: {
          commands: [
            { name: "send", title: "Send" },
            { name: "files", title: "Files" },
            { name: "escape", title: "Escape" },
            { name: "read", title: "Read" },
            { name: "list", title: "List" },
          ],
        },
      },
    },
  };
  const bytes = await createArchive({
    "manifest.json": Buffer.from(JSON.stringify(manifest)),
    "main.js": Buffer.from(
      `export function activate(s){for(const operation of ['read','list'])s.register('commands',operation,()=>s.capability('files',{kind:'fs',operation,path:operation==='list'?'.':'task.txt'}));s.register('commands','send',async()=>{await s.capability('net',{kind:'egress',url:'https://api.example.com/a',headers:{Authorization:'untrusted'}});return s.capability('net',{kind:'egress',url:'https://api.example.com/b'})});s.register('commands','files',async()=>{await s.capability('files',{kind:'fs',operation:'write',path:'task.txt',data:[111,107]});return s.capability('files',{kind:'fs',operation:'read',path:'task.txt'})});s.register('commands','escape',()=>s.capability('net',{kind:'egress',url:'https://elsewhere.example.com/'}))}`,
    ),
  });
  const preview = (await host.preview(bytes)) as { token: string };
  const item = await host.importLibrary(preview.token);
  const agent = await host.createAgent("Task", [item.digest]);
  await host.setSettings(
    agent.instanceId,
    "service",
    {},
    { key: "fake-task-secret" },
  );
  await host.enable(agent.instanceId, "service");
  await writeFile(
    path.join(dir, "instances", agent.instanceId, "agent-data", "task.txt"),
    "fixture",
  );
  const grant = async () =>
    host.grantTaskScope(
      agent.instanceId,
      (await host.taskScopePlan(agent.instanceId)).fingerprint,
      60_000,
    );
  const invoke = (command: string) =>
    host.invoke(
      agent.instanceId,
      "service",
      "service",
      "commands",
      command,
      {},
    );
  return { host, agent, dir, confirm, fs, grant, invoke, options };
}
function mockTransport() {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  vi.spyOn(https, "request").mockImplementation(((
    url: URL,
    options: { headers: Record<string, string> },
    callback: (response: EventEmitter) => void,
  ) => {
    requests.push({ url: url.href, headers: options.headers });
    const req = new EventEmitter() as EventEmitter & {
      setTimeout: () => void;
      end: () => void;
      write: () => void;
    };
    req.setTimeout = () => {};
    req.write = () => {};
    req.end = () =>
      queueMicrotask(() => {
        const response = Object.assign(new EventEmitter(), {
          statusCode: 200,
          headers: {},
        });
        callback(response);
        response.emit("data", Buffer.from("echo fake-task-secret"));
        response.emit("end");
        req.emit("close");
      });
    return req;
  }) as typeof https.request);
  return requests;
}
it("executes real runtime/SDK/HTTPS adapter within task, binds credentials and redacts returned values and audit", async () => {
  const requests = mockTransport(),
    w = await fixture();
  await w.grant();
  const result = await w.invoke("send");
  expect(requests).toHaveLength(2);
  expect(w.confirm.ask).not.toHaveBeenCalled();
  expect(
    requests.every(
      (r) => r.headers.Authorization === "Bearer fake-task-secret",
    ),
  ).toBe(true);
  expect(JSON.stringify(result)).not.toContain("fake-task-secret");
  const audit = JSON.stringify(await w.host.audit(w.agent.instanceId));
  expect(audit).not.toContain("fake-task-secret");
  expect(audit).not.toContain(w.dir);
  await expect(w.invoke("escape")).rejects.toBeDefined();
  expect(requests).toHaveLength(2);
  await w.host.revokeTaskScope(w.agent.instanceId);
  expect(
    (await w.host.taskScopePlan(w.agent.instanceId)).active,
  ).toBeUndefined();
  await w.invoke("send");
  expect(w.confirm.ask).toHaveBeenCalledTimes(2);
});
it("revokes task on configuration change and rejects a stale plan", async () => {
  mockTransport();
  const w = await fixture();
  const plan = await w.host.taskScopePlan(w.agent.instanceId);
  await w.grant();
  await w.host.setSettings(
    w.agent.instanceId,
    "service",
    {},
    { key: "new-fake-secret" },
  );
  expect(
    (await w.host.taskScopePlan(w.agent.instanceId)).active,
  ).toBeUndefined();
  await expect(
    w.host.grantTaskScope(w.agent.instanceId, plan.fingerprint, 1000),
  ).rejects.toBeDefined();
});
it.runIf(process.platform === "darwin")(
  "writes and reads actual files through the macOS directory-handle adapter in one task",
  async () => {
    const w = await fixture(true);
    await w.grant();
    await w.invoke("files");
    await w.invoke("files");
    expect(
      await readFile(
        path.join(
          w.dir,
          "instances",
          w.agent.instanceId,
          "agent-data",
          "task.txt",
        ),
        "utf8",
      ),
    ).toBe("ok");
    expect(w.confirm.ask).not.toHaveBeenCalled();
  },
);

it.each(["revoke", "settings", "bind", "unbind"])(
  "keeps read/list confirmation after %s invalidates the task and rebuilds its core",
  async (change) => {
    const w = await fixture();
    const root = await mkdtemp(path.join(os.tmpdir(), "plums-scope-root-"));
    dirs.push(root);
    if (change === "unbind")
      await w.host.bindRoot(w.agent.instanceId, "project", root);
    await w.grant();
    if (change === "revoke") await w.host.revokeTaskScope(w.agent.instanceId);
    if (change === "settings")
      await w.host.setSettings(
        w.agent.instanceId,
        "service",
        {},
        { key: "new-key" },
      );
    if (change === "bind")
      await w.host.bindRoot(w.agent.instanceId, "project", root);
    if (change === "unbind")
      await w.host.unbindRoot(w.agent.instanceId, "project");
    expect(
      (await w.host.taskScopePlan(w.agent.instanceId)).active,
    ).toBeUndefined();
    w.confirm.ask.mockResolvedValue(false);
    for (const operation of ["read", "list"])
      await expect(w.invoke(operation)).rejects.toBeDefined();
    expect(w.confirm.ask).toHaveBeenCalledTimes(2);
    expect(w.fs.records).toHaveLength(0);
  },
);
it("requires desktop read/list confirmation before any task, and reuses selected file operations", async () => {
  const w = await fixture();
  w.confirm.ask.mockResolvedValue(false);
  for (const operation of ["read", "list"])
    await expect(w.invoke(operation)).rejects.toBeDefined();
  expect(w.fs.records).toHaveLength(0);
  expect(w.confirm.ask).toHaveBeenCalledTimes(2);
  await w.grant();
  await w.invoke("files");
  await w.invoke("files");
  await w.invoke("list");
  await w.invoke("list");
  expect(w.fs.records).toHaveLength(6);
  expect(w.confirm.ask).toHaveBeenCalledTimes(2);
});

it("keeps desktop read/list fail-closed after expiry and host restart without resurrecting grants", async () => {
  const w = await fixture();
  await w.host.grantTaskScope(
    w.agent.instanceId,
    (await w.host.taskScopePlan(w.agent.instanceId)).fingerprint,
    1,
  );
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10);
  w.confirm.ask.mockResolvedValue(false);
  for (const operation of ["read", "list"])
    await expect(w.invoke(operation)).rejects.toMatchObject({
      code: "CONFIRMATION_DENIED",
    });
  expect(w.fs.records).toHaveLength(0);
  vi.restoreAllMocks();
  await w.grant();
  w.host.close();
  const reopened = new DesktopHost(w.options);
  hosts.push(reopened);
  await reopened.initialize();
  expect(
    (await reopened.taskScopePlan(w.agent.instanceId)).active,
  ).toBeUndefined();
  w.confirm.ask.mockResolvedValue(false);
  for (const operation of ["read", "list"])
    await expect(
      reopened.invoke(
        w.agent.instanceId,
        "service",
        "service",
        "commands",
        operation,
        {},
      ),
    ).rejects.toMatchObject({ code: "CONFIRMATION_DENIED" });
  expect(w.fs.records).toHaveLength(0);
});
it("revokes a pending single-use read before the sink and requires confirmation on reinvoke", async () => {
  const w = await fixture();
  let answer: ((allow: boolean) => void) | undefined;
  w.confirm.ask.mockImplementation(
    () =>
      new Promise<boolean>((resolve) => {
        answer = resolve;
      }),
  );
  const pending = w.invoke("read").catch((error) => error);
  await vi.waitFor(() => expect(answer).toBeDefined());
  const audit = async (): Promise<AuditEvent[]> =>
    (
      await readFile(
        path.join(w.dir, "instances", w.agent.instanceId, "audit.jsonl"),
        "utf8",
      )
    )
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line));
  const requested = (await audit()).find(
    (event) =>
      event.phase === "confirmation" &&
      event.outcome === "requested" &&
      event.operation === "read",
  );
  expect(requested?.callId).toEqual(expect.any(String));
  await w.host.revokeTaskScope(w.agent.instanceId);
  answer!(true);
  expect(await pending).toMatchObject({ message: "Extension stopped" });
  await vi.waitFor(async () => {
    expect(
      (await audit()).find(
        (event) =>
          event.callId === requested!.callId && event.phase === "denied",
      ),
    ).toMatchObject({
      outcome: "denied",
      executionState: "not_started",
      code: "PERMISSION_DENIED",
    });
  });
  expect(w.fs.records).toHaveLength(0);
  w.confirm.ask.mockResolvedValue(false);
  for (const operation of ["read", "list"])
    await expect(w.invoke(operation)).rejects.toMatchObject({
      code: "CONFIRMATION_DENIED",
    });
  expect(w.fs.records).toHaveLength(0);
});
