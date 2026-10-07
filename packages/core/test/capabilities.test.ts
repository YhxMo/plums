import { execFile } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import {
  createCore,
  DEFAULT_CONFIRM_TIMEOUT_MS,
  MemorySecretStore,
  PlumsError,
  RecordingEgressSink,
  RecordingExecSink,
  RecordingFsSink,
  ScriptedConfirm,
  secretRef,
  type AuditEvent,
  type CapabilityRequest,
  type Core,
  type CreateCoreOptions,
  type ManifestV2,
} from "@plums/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  expectPlumsError,
  manifestZip,
  validManifest,
  validManifestV2,
} from "./package-helpers.js";

const cores: Core[] = [];
const dirs: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const core of cores.splice(0)) core.close();
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});
function world(extra: Partial<CreateCoreOptions> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "plums-capabilities-"));
  dirs.push(dir);
  const root = path.join(dir, "workspace");
  const outside = path.join(dir, "workspace-other");
  mkdirSync(root);
  mkdirSync(outside);
  mkdirSync(path.join(root, "sub"));
  writeFileSync(path.join(root, "file.txt"), "fixture");
  writeFileSync(path.join(root, "second.txt"), "second");
  writeFileSync(path.join(outside, "outside.txt"), "outside");
  const fs = new RecordingFsSink({
    data: new Uint8Array([0, 255]),
    entries: [
      { name: "file.txt", type: "file" },
      { name: "sub", type: "directory" },
    ],
  });
  const exec = new RecordingExecSink({
    exitCode: 7,
    stdout: "out",
    stderr: "err",
  });
  const egress = new RecordingEgressSink();
  const confirm = new ScriptedConfirm([true, true, true, true, true]);
  const secrets = new MemorySecretStore();
  const events: AuditEvent[] = [];
  const options: CreateCoreOptions = {
    dataDir: path.join(dir, "data"),
    fs,
    exec,
    egress,
    confirm,
    secrets,
    roots: { workspace: root },
    programs: { test: "/host/bin/test" },
    onAudit: (event) => {
      events.push({ ...event });
    },
    ...extra,
  };
  const core = createCore(options);
  cores.push(core);
  const manifest = validManifestV2();
  const install = async (value = manifest, enabled = true) => {
    await core.importPackage(await manifestZip(value));
    if (enabled) {
      await core.grantConsent(value.id);
      await core.enable(value.id);
    }
  };
  const call = (
    request: CapabilityRequest,
    permissionId = request.kind === "fs"
      ? "files"
      : request.kind === "exec"
        ? "test"
        : "send",
    extensionId = manifest.id,
  ) => core.runCapability({ extensionId, permissionId, request });
  const none = () => {
    expect(fs.records).toEqual([]);
    expect(exec.records).toEqual([]);
    expect(egress.records).toEqual([]);
  };
  return {
    core,
    dir,
    root,
    outside,
    fs,
    exec,
    egress,
    confirm,
    secrets,
    events,
    options,
    manifest,
    install,
    call,
    none,
  };
}
const read: CapabilityRequest = {
  kind: "fs",
  operation: "read",
  path: "file.txt",
};
const write: CapabilityRequest = {
  kind: "fs",
  operation: "write",
  path: "new.txt",
  data: new Uint8Array([1, 2]),
};
const command: CapabilityRequest = {
  kind: "exec",
  args: ["--test", "a; echo nope", "$(secret)"],
  cwd: { root: "workspace", path: "sub" },
};
const send: CapabilityRequest = {
  kind: "egress",
  url: "https://API.EXAMPLE.COM:443/send?q=private",
  method: "POST",
  body: "private-body",
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function mutateDb(dataDir: string, sql: string, ...values: unknown[]) {
  const db = new Database(path.join(dataDir, "plums.db"));
  try {
    db.prepare(sql).run(...values);
  } finally {
    db.close();
  }
}
const runProcess = promisify(execFile);
const coreEntry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
async function changeFromProcess(
  dataDir: string,
  id: string,
  change: string,
  zipPath: string,
) {
  await runProcess(process.execPath, [
    "--input-type=module",
    "-e",
    `
    import { pathToFileURL } from "node:url";
    const [entry, dataDir, id, change, zipPath] = process.argv.slice(1);
    const { createCore, MemorySecretStore, RecordingEgressSink } = await import(pathToFileURL(entry).href);
    const core = createCore({ dataDir, secrets: new MemorySecretStore(), egress: new RecordingEgressSink() });
    try {
      if (change === "permission") await core.updatePackage(zipPath, { consent: true });
      else if (change === "disable") await core.disable(id);
      else await core.uninstall(id);
    } finally { core.close(); }
  `,
    coreEntry,
    dataDir,
    id,
    change,
    zipPath,
  ]);
}

describe("2.x capability public flow", () => {
  it("installs, consents, enables and returns fs/exec/egress recording results with linked audit events", async () => {
    const w = world();
    await w.install();
    const a = await w.call(read);
    const b = await w.call({ kind: "fs", operation: "list", path: "." });
    const c = await w.call(write);
    const d = await w.call(command);
    const e = await w.call(send);
    expect(a).toMatchObject({
      kind: "fs",
      operation: "read",
      data: new Uint8Array([0, 255]),
    });
    expect(b).toMatchObject({
      kind: "fs",
      operation: "list",
      entries: [
        { name: "file.txt", type: "file" },
        { name: "sub", type: "directory" },
      ],
    });
    expect(c).toMatchObject({
      kind: "fs",
      operation: "write",
      completed: true,
    });
    expect(d).toMatchObject({
      kind: "exec",
      result: { exitCode: 7, stdout: "out", stderr: "err" },
    });
    expect(e).toMatchObject({
      kind: "egress",
      result: { status: 200, body: "" },
    });
    expect(new Set([a, b, c, d, e].map((result) => result.callId)).size).toBe(
      5,
    );
    expect(w.confirm.asked).toHaveLength(3);
    expect(w.exec.records).toEqual([
      {
        program: "/host/bin/test",
        args: command.args,
        cwd: realpathSync(path.join(w.root, "sub")),
        rootPath: realpathSync(w.root),
      },
    ]);
    expect(w.egress.records).toEqual([
      {
        url: "https://api.example.com/send?q=private",
        method: "POST",
        body: "private-body",
      },
    ]);
    expect(existsSync(path.join(w.root, "new.txt"))).toBe(false);
    expect(readFileSync(path.join(w.root, "file.txt"), "utf8")).toBe("fixture");
    expect(
      w.events
        .filter((event) => event.callId === a.callId)
        .map((event) => [event.phase, event.outcome]),
    ).toEqual([
      ["allow", "allowed"],
      ["result", "completed"],
    ]);
    expect(
      w.events
        .filter((event) => event.callId === c.callId)
        .map((event) => [event.phase, event.outcome]),
    ).toEqual([
      ["confirmation", "requested"],
      ["confirmation", "allowed"],
      ["allow", "allowed"],
      ["result", "completed"],
    ]);
    const serialized = JSON.stringify(w.events);
    for (const privateValue of [
      "private-body",
      "private",
      "$(secret)",
      "a; echo nope",
      w.root,
      "stdout",
      "stderr",
    ])
      expect(serialized).not.toContain(privateValue);
    for (const event of w.events)
      expect(event).toMatchObject({
        callId: expect.any(String),
        timestamp: expect.any(String),
        extensionId: w.manifest.id,
      });
  });
  it("does not follow redirects and confirms a second invocation separately", async () => {
    const egress = new RecordingEgressSink({
      1: "https://api.example.com/next",
    });
    const w = world({ egress });
    await w.install();
    expect(await w.call(send)).toMatchObject({
      result: { status: 302, redirectTo: "https://api.example.com/next" },
    });
    expect(egress.records).toHaveLength(1);
    await w.call({ kind: "egress", url: "https://api.example.com/next" });
    expect(egress.records).toHaveLength(2);
    expect(w.confirm.asked).toHaveLength(2);
    expect(w.confirm.asked[0]?.host).toBe("api.example.com");
    expect(w.confirm.asked[0]?.message).not.toContain("private");
  });
  it("copies and fixes directory and program bindings at creation", async () => {
    const roots: Record<string, string> = {};
    const programs = { test: "/host/original" };
    const fixture = world();
    roots.workspace = fixture.root;
    const w = world({ roots, programs });
    await w.install();
    roots.workspace = w.outside;
    programs.test = "/host/changed";
    await w.call(read);
    await w.call(command);
    expect(w.fs.records[0]?.rootPath).toBe(realpathSync(fixture.root));
    expect(w.exec.records[0]?.program).toBe("/host/original");
    expect(w.core).not.toHaveProperty("roots");
    expect(w.core).not.toHaveProperty("programs");
  });
  it("requires format 2.x and extension kind, even when payload or unknown fields claim a capability", async () => {
    const w = world();
    const legacy = {
      ...validManifest("extension"),
      dependencies: [],
      permissions: [
        {
          id: "files",
          level: "read",
          target: "workspace",
          reason: "Files",
          kind: "fs",
          operations: ["read"],
        },
      ],
    };
    await w.core.importPackage(await manifestZip(legacy));
    await w.core.grantConsent(legacy.id);
    await w.core.enable(legacy.id);
    const err = await expectPlumsError(
      w.call(read, "files", legacy.id),
      "PERMISSION_DENIED",
      "/formatVersion",
    );
    expect(err.details).toMatchObject({ reason: "FORMAT_API_MISMATCH" });
    w.none();
    await w.core.uninstall(legacy.id);
    await w.install({
      ...w.manifest,
      kind: "character",
      payload: { permissions: w.manifest.permissions },
    });
    await expectPlumsError(w.call(read), "PERMISSION_DENIED", "/kind");
    w.none();
  });
});

describe("capability authorization and validation", () => {
  it.each([
    "not installed",
    "disabled",
    "undeclared",
    "no consent",
    "stale consent",
  ])("refuses %s without calling any sink", async (state) => {
    const w = world();
    if (state !== "not installed")
      await w.install(w.manifest, state !== "disabled");
    if (state === "no consent")
      mutateDb(w.options.dataDir, "DELETE FROM consents");
    if (state === "stale consent")
      mutateDb(
        w.options.dataDir,
        "UPDATE consents SET permissions = ?",
        JSON.stringify([
          { ...w.manifest.permissions[0], operations: ["write"] },
        ]),
      );
    const err = await expectPlumsError(
      w.call(read, state === "undeclared" ? "absent" : "files"),
      state.includes("consent") ? "CONSENT_REQUIRED" : "PERMISSION_DENIED",
    );
    expect(w.events.at(-1)).toMatchObject({
      phase: "denied",
      code: err.code,
      executionState: "not_started",
    });
    expect(w.confirm.asked).toEqual([]);
    w.none();
  });
  it.each([
    ["root binding", { roots: {} }, read, "ROOT_NOT_BOUND"],
    ["program binding", { programs: {} }, command, "PROGRAM_NOT_BOUND"],
    ["fs sink", { fs: undefined }, read, "SINK_NOT_CONFIGURED"],
    ["exec sink", { exec: undefined }, command, "SINK_NOT_CONFIGURED"],
    ["cwd root binding", { roots: {} }, command, "ROOT_NOT_BOUND"],
  ] as const)("refuses missing %s", async (_label, extra, request, reason) => {
    const w = world(extra);
    await w.install();
    const err = await expectPlumsError(w.call(request), "PERMISSION_DENIED");
    expect(err.details).toMatchObject({ reason });
    w.none();
  });
  it("write does not imply read or list; permission kind and cwd root must match", async () => {
    const w = world();
    await w.install({
      ...w.manifest,
      permissions: w.manifest.permissions.map((p) =>
        p.kind === "fs" ? { ...p, operations: ["write"] } : p,
      ),
    });
    await expectPlumsError(
      w.call(read),
      "PERMISSION_DENIED",
      "/request/operation",
    );
    await expectPlumsError(
      w.call({ kind: "fs", operation: "list", path: "." }),
      "PERMISSION_DENIED",
      "/request/operation",
    );
    await expectPlumsError(
      w.call(command, "files"),
      "PERMISSION_DENIED",
      "/permissions/0/kind",
    );
    await expectPlumsError(
      w.call({ ...command, cwd: { root: "other", path: "." } }),
      "PERMISSION_DENIED",
      "/request/cwd/root",
    );
    w.none();
  });
  it.each([
    "http://api.example.com",
    "https://other.example.com",
    "https://api.example.com:8443",
    "https://u:p@api.example.com",
    "https://127.0.0.1",
    "https://api.example.com.",
  ])("rejects egress URL %s before confirmation", async (url) => {
    const w = world();
    await w.install();
    await expectPlumsError(
      w.call({ kind: "egress", url }),
      "PERMISSION_DENIED",
      "/request/url",
    );
    expect(w.confirm.asked).toEqual([]);
    w.none();
  });
  it("matches wildcard egress subdomains and declared ports", async () => {
    const w = world();
    await w.install({
      ...w.manifest,
      permissions: [
        {
          id: "send",
          kind: "egress",
          target: "*.example.com:8443",
          reason: "Send",
        },
      ],
    });
    await w.call({ kind: "egress", url: "https://a.example.com:8443" });
    expect(w.confirm.asked[0]?.host).toBe("a.example.com:8443");
    await expectPlumsError(
      w.call({ kind: "egress", url: "https://example.com:8443" }),
      "PERMISSION_DENIED",
    );
    expect(w.egress.records).toHaveLength(1);
  });
  it.each([
    null,
    {},
    { kind: "fs", operation: "mkdir", path: "." },
    { kind: "fs", operation: "write", path: "file.txt", data: "text" },
    { ...command, program: "/bin/sh" },
    { ...command, shell: "echo data" },
    { ...command, env: { TOKEN: "private" } },
    { ...command, stdin: "private" },
    { ...command, args: "--test" },
    { ...command, args: [undefined] },
    { ...command, args: new Array(2) },
    { ...command, args: ["nul\0arg"] },
    { ...command, cwd: { root: "workspace", path: ".", arbitrary: true } },
    { kind: "egress", url: "https://api.example.com", body: {} },
  ])(
    "validates and rejects malformed requests before checking install state (%j)",
    async (request) => {
      const w = world();
      await expect(
        w.call(request as CapabilityRequest, "files"),
      ).rejects.toBeInstanceOf(TypeError);
      expect(w.events).toMatchObject([
        { phase: "denied", code: "REQUEST_INVALID" },
      ]);
      w.none();
    },
  );
  it("hides exceptions thrown by request accessors", async () => {
    const w = world();
    const request = {
      get kind() {
        throw new Error("private-rejected-value");
      },
    };
    const error = await w
      .call(request as CapabilityRequest, "files")
      .catch((error) => error);
    expect(String(error)).not.toContain("private-rejected-value");
    w.none();
  });
  it.each(["PERMISSION_DENIED", "CAPABILITY_FAILED"] as const)(
    "does not trust caller-thrown %s errors while copying requests",
    async (code) => {
      const w = world();
      const injected = new PlumsError({
        code,
        message: "private-rejected-value",
        details: { executionState: "completed" },
      });
      const request = new Proxy(
        {},
        {
          getPrototypeOf() {
            throw injected;
          },
        },
      );
      const args: string[] = [];
      Object.defineProperty(args, 0, {
        get() {
          throw injected;
        },
      });
      for (const value of [request, { ...command, args }]) {
        const error = await w
          .call(value as CapabilityRequest, "files")
          .catch((error) => error);
        expect(error).toBeInstanceOf(TypeError);
        expect(String(error)).not.toContain("private-rejected-value");
      }
      expect(w.events).toMatchObject([
        { phase: "denied", code: "REQUEST_INVALID" },
        { phase: "denied", code: "REQUEST_INVALID" },
      ]);
      w.none();
    },
  );
  it("captures array elements once, preventing accessor changes from altering exec args", async () => {
    const w = world();
    await w.install();
    let reads = 0;
    const args: string[] = [];
    Object.defineProperty(args, 0, {
      enumerable: true,
      configurable: true,
      get: () => (++reads === 1 ? "original" : "changed"),
    });
    await w.call({ ...command, args });
    expect(w.exec.records[0]?.args).toEqual(["original"]);
    expect(reads).toBe(1);
  });
});

describe("filesystem boundaries", () => {
  it.each([
    "/file.txt",
    "../file.txt",
    "sub/../../file.txt",
    "C:/file.txt",
    "C:file.txt",
    "\\\\server\\file",
    "//server/file",
    "sub\\file.txt",
    "nul\0file",
  ])("rejects unsafe relative path %j for fs and exec", async (at) => {
    const w = world();
    await w.install();
    await expectPlumsError(
      w.call({ ...read, path: at }),
      "PERMISSION_DENIED",
      "/request/path",
    );
    await expectPlumsError(
      w.call({ ...command, cwd: { root: "workspace", path: at } }),
      "PERMISSION_DENIED",
      "/request/cwd/path",
    );
    w.none();
  });
  it("allows in-root symlinks for read, write, list and cwd, using canonical paths", async () => {
    const w = world();
    await w.install();
    symlinkSync("file.txt", path.join(w.root, "link"));
    symlinkSync("sub", path.join(w.root, "dirlink"), "dir");
    await w.call({ ...read, path: "link" });
    await w.call({ ...write, path: "link" });
    await w.call({ ...write, path: "dirlink/new.txt" });
    await w.call({ kind: "fs", operation: "list", path: "dirlink" });
    await w.call({ ...command, cwd: { root: "workspace", path: "dirlink" } });
    expect(w.fs.records.map((r) => r.path)).toEqual(
      ["file.txt", "file.txt", "sub/new.txt", "sub"].map((p) =>
        path.join(realpathSync(w.root), p),
      ),
    );
    expect(w.exec.records[0]?.cwd).toBe(path.join(realpathSync(w.root), "sub"));
  });
  it("rejects symlink escape, prefix sibling, dangling links and nonexistent write parents", async () => {
    const w = world();
    await w.install();
    symlinkSync(w.outside, path.join(w.root, "escape"), "dir");
    symlinkSync("missing", path.join(w.root, "dangling"));
    for (const request of [
      { ...read, path: "escape/outside.txt" },
      { ...write, path: "escape/new.txt" },
      { ...read, path: "dangling" },
      { ...write, path: "dangling" },
      { ...write, path: "missing/child.txt" },
      { kind: "fs", operation: "list", path: "escape" },
      { ...command, cwd: { root: "workspace", path: "escape" } },
    ] as CapabilityRequest[])
      await expectPlumsError(w.call(request), "PERMISSION_DENIED");
    w.none();
  });
  it.each([
    { kind: "fs", operation: "read", path: "sub" },
    { kind: "fs", operation: "list", path: "file.txt" },
    { ...write, path: "sub" },
    { ...read, path: "missing" },
    { ...command, cwd: { root: "workspace", path: "file.txt" } },
    { ...command, cwd: { root: "workspace", path: "missing" } },
  ] as CapabilityRequest[])(
    "checks existence and entry type (%j)",
    async (request) => {
      const w = world();
      await w.install();
      await expectPlumsError(w.call(request), "PERMISSION_DENIED");
      w.none();
    },
  );
  it("rejects non-directory root bindings without exposing metadata errors", async () => {
    const fixture = world();
    for (const root of [
      path.join(fixture.root, "file.txt"),
      path.join(fixture.root, "missing"),
    ]) {
      const w = world({ roots: { workspace: root } });
      await w.install();
      const error = await expectPlumsError(w.call(read), "PERMISSION_DENIED");
      expect(String(error)).not.toContain(root);
      w.none();
    }
  });
});

describe("confirmation and concurrent changes", () => {
  it.each(["missing", "false", "throw", "nonboolean"])(
    "denies %s confirmation for write/exec/egress; read and list still work",
    async (answer) => {
      const confirm =
        answer === "missing"
          ? undefined
          : {
              async ask() {
                if (answer === "throw") throw new Error("secret-confirm-error");
                return answer === "false" ? false : ("true" as never);
              },
            };
      const w = world({ confirm });
      await w.install();
      for (const request of [write, command, send])
        await expectPlumsError(w.call(request), "CONFIRMATION_DENIED");
      w.none();
      expect(
        w.events
          .filter(
            (event) =>
              event.phase === "confirmation" && event.outcome !== "requested",
          )
          .map((event) => event.outcome),
      ).toEqual(
        new Array(3).fill(
          answer === "false"
            ? "denied"
            : answer === "throw"
              ? "error"
              : answer === "nonboolean"
                ? "invalid"
                : "missing",
        ),
      );
      await w.call(read);
      await w.call({ kind: "fs", operation: "list", path: "." });
      expect(w.fs.records).toHaveLength(2);
    },
  );
  it.each([undefined, 25])(
    "times out at the default or host-configured limit (%s); late true and rejection cannot execute",
    async (timeout) => {
      expect(DEFAULT_CONFIRM_TIMEOUT_MS).toBe(120_000);
      const answer = deferred<boolean>();
      const asked = deferred<void>();
      const w = world({
        confirmTimeoutMs: timeout,
        confirm: {
          ask() {
            asked.resolve();
            return answer.promise;
          },
        },
      });
      await w.install();
      vi.useFakeTimers();
      const pending = expectPlumsError(w.call(write), "CONFIRMATION_DENIED");
      await asked.promise;
      await vi.advanceTimersByTimeAsync(
        (timeout ?? DEFAULT_CONFIRM_TIMEOUT_MS) - 1,
      );
      w.none();
      await vi.advanceTimersByTimeAsync(1);
      const error = await pending;
      expect(error.details).toMatchObject({ reason: "TIMEOUT" });
      answer.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      w.none();
      expect(w.events.some((event) => event.outcome === "timeout")).toBe(true);
      vi.useRealTimers();
      const late = deferred<boolean>();
      const laterAsked = deferred<void>();
      const other = world({
        confirmTimeoutMs: 10,
        confirm: {
          ask() {
            laterAsked.resolve();
            return late.promise;
          },
        },
      });
      await other.install();
      vi.useFakeTimers();
      const rejected = expectPlumsError(
        other.call(command),
        "CONFIRMATION_DENIED",
      );
      await laterAsked.promise;
      await vi.advanceTimersByTimeAsync(10);
      await rejected;
      late.reject(new Error("late secret"));
      await vi.advanceTimersByTimeAsync(0);
      other.none();
    },
  );
  it.each(["write", "exec", "egress"])(
    "copies the %s request before waiting for confirmation",
    async (kind) => {
      const answer = deferred<boolean>();
      const asked = deferred<void>();
      const w = world({
        confirm: {
          ask() {
            asked.resolve();
            return answer.promise;
          },
        },
      });
      await w.install();
      const request =
        kind === "write"
          ? { ...write, data: new Uint8Array([1, 2]) }
          : kind === "exec"
            ? { ...command, args: [...command.args], cwd: { ...command.cwd } }
            : { ...send };
      const pending = w.call(request);
      await asked.promise;
      if (request.kind === "fs" && request.operation === "write") {
        request.path = "second.txt";
        request.data[0] = 99;
      }
      if (request.kind === "exec") {
        request.args[0] = "changed";
        request.cwd.path = ".";
        request.cwd.root = "other";
      }
      if (request.kind === "egress") {
        request.url = "https://other.example.com";
        request.body = "changed";
      }
      answer.resolve(true);
      await pending;
      if (kind === "write")
        expect(w.fs.records[0]).toMatchObject({
          path: path.join(realpathSync(w.root), "new.txt"),
          data: new Uint8Array([1, 2]),
        });
      if (kind === "exec")
        expect(w.exec.records[0]).toMatchObject({
          args: command.args,
          cwd: path.join(realpathSync(w.root), "sub"),
        });
      if (kind === "egress")
        expect(w.egress.records[0]).toMatchObject({
          url: "https://api.example.com/send?q=private",
          body: "private-body",
        });
    },
  );
  it.each([
    "disable",
    "uninstall",
    "consent",
    "operations",
    "kind",
    "target",
    "cwdRoots",
  ])("reauthorizes after %s changes during confirmation", async (change) => {
    const answer = deferred<boolean>();
    const asked = deferred<void>();
    const w = world({
      confirm: {
        ask() {
          asked.resolve();
          return answer.promise;
        },
      },
    });
    await w.install();
    const pending = expectPlumsError(
      w.call(change === "cwdRoots" ? command : write),
      change === "consent" ? "CONSENT_REQUIRED" : "PERMISSION_DENIED",
    );
    await asked.promise;
    if (change === "disable") await w.core.disable(w.manifest.id);
    else if (change === "uninstall") await w.core.uninstall(w.manifest.id);
    else if (change === "consent")
      mutateDb(w.options.dataDir, "DELETE FROM consents");
    else {
      const permissions = w.manifest.permissions.map((p) => {
        if (change === "cwdRoots" && p.kind === "exec")
          return { ...p, cwdRoots: ["other"] };
        if (p.kind !== "fs") return p;
        if (change === "operations") return { ...p, operations: ["read"] };
        if (change === "target") return { ...p, target: "other" };
        return {
          id: p.id,
          kind: "egress",
          target: "api.example.com",
          reason: p.reason,
        };
      });
      await w.core.updatePackage(
        await manifestZip({ ...w.manifest, version: "2.0.0", permissions }),
        { consent: true },
      );
    }
    answer.resolve(true);
    await pending;
    w.none();
  });
  it.each(["outside", "inside", "root"])(
    "rechecks symlink paths changed to %s during confirmation",
    async (change) => {
      const answer = deferred<boolean>();
      const asked = deferred<void>();
      const fixture = world();
      const bound = path.join(fixture.dir, "bound");
      symlinkSync(fixture.root, bound, "dir");
      const w = world({
        roots: { workspace: bound },
        confirm: {
          ask() {
            asked.resolve();
            return answer.promise;
          },
        },
      });
      await w.install();
      const link = path.join(fixture.root, "link");
      symlinkSync("file.txt", link);
      const pending = expectPlumsError(
        w.call({ ...write, path: "link" }),
        "PERMISSION_DENIED",
      );
      await asked.promise;
      if (change === "root") {
        unlinkSync(bound);
        symlinkSync(w.root, bound, "dir");
        symlinkSync("file.txt", path.join(w.root, "link"));
      } else {
        unlinkSync(link);
        symlinkSync(
          change === "inside"
            ? "second.txt"
            : path.join(fixture.outside, "outside.txt"),
          link,
        );
      }
      answer.resolve(true);
      await pending;
      w.none();
    },
  );
  it("reauthorizes after an asynchronous allow-audit callback changes state", async () => {
    let core!: Core;
    const w = world({
      onAudit: async (event) => {
        if (event.phase === "allow") await core.disable(validManifestV2().id);
      },
    });
    core = w.core;
    await w.install();
    await expectPlumsError(w.call(read), "PERMISSION_DENIED");
    w.none();
  });
  it.each([
    ["confirmation", "disable"],
    ["confirmation", "uninstall"],
    ["confirmation", "permission"],
    ["audit", "disable"],
    ["audit", "uninstall"],
    ["audit", "permission"],
  ])(
    "rejects %s calls after another process changes %s",
    async (stage, change) => {
      const waiting = deferred<void>();
      const resume = deferred<void>();
      const events: AuditEvent[] = [];
      const w = world({
        confirm: {
          async ask() {
            if (stage === "confirmation") {
              waiting.resolve();
              await resume.promise;
            }
            return true;
          },
        },
        onAudit: async (event) => {
          events.push(event);
          if (stage === "audit" && event.phase === "allow") {
            waiting.resolve();
            await resume.promise;
          }
        },
      });
      await w.install();
      const zipPath = path.join(w.dir, "update.zip");
      writeFileSync(
        zipPath,
        await manifestZip({
          ...w.manifest,
          version: "2.0.0",
          permissions: w.manifest.permissions.map((p) =>
            p.kind === "fs" ? { ...p, operations: ["read"] } : p,
          ),
        }),
      );
      const pending = expectPlumsError(w.call(write), "PERMISSION_DENIED");
      await waiting.promise;
      try {
        await changeFromProcess(
          w.options.dataDir,
          w.manifest.id,
          change,
          zipPath,
        );
      } finally {
        resume.resolve();
      }
      const error = await pending;
      expect(events.at(-1)).toMatchObject({
        phase: "denied",
        code: error.code,
        executionState: "not_started",
      });
      expect(new Set(events.map((event) => event.callId)).size).toBe(1);
      w.none();
    },
  );
  it.each(["fs", "exec"])(
    "rechecks %s symlink destinations after an asynchronous allow audit",
    async (kind) => {
      let link!: string;
      const w = world({
        onAudit: async (event) => {
          if (event.phase === "allow") {
            await Promise.resolve();
            unlinkSync(link);
            symlinkSync(
              kind === "fs" ? "second.txt" : ".",
              link,
              kind === "fs" ? "file" : "dir",
            );
          }
        },
      });
      await w.install();
      link = path.join(w.root, "audit-link");
      symlinkSync(
        kind === "fs" ? "file.txt" : "sub",
        link,
        kind === "fs" ? "file" : "dir",
      );
      const error = await expectPlumsError(
        w.call(
          kind === "fs"
            ? { ...write, path: "audit-link" }
            : { ...command, cwd: { root: "workspace", path: "audit-link" } },
        ),
        "PERMISSION_DENIED",
      );
      expect(error.details).toMatchObject({ reason: "PATH_CHANGED" });
      w.none();
    },
  );
});

describe("audit and sink failures", () => {
  it("rejects sparse directory results and reports an unknown sink outcome", async () => {
    const fs = new RecordingFsSink({ entries: new Array(1) });
    const w = world({ fs });
    await w.install();
    const error = await expectPlumsError(
      w.call({ kind: "fs", operation: "list", path: "." }),
      "CAPABILITY_FAILED",
    );
    expect(error.details).toMatchObject({
      phase: "sink",
      executionState: "unknown",
    });
    expect(w.events.at(-1)).toMatchObject({
      phase: "result",
      outcome: "failed",
      executionState: "unknown",
    });
    expect(fs.records).toHaveLength(1);
  });
  it.each(["missing", "confirmation", "allow", "denied"])(
    "fails closed for %s audit failure",
    async (phase) => {
      const w = world({
        onAudit:
          phase === "missing"
            ? undefined
            : (event) => {
                if (event.phase === phase)
                  throw new Error("private-audit-error");
              },
      });
      await w.install();
      const error = await expectPlumsError(
        w.call(
          phase === "confirmation" ? write : read,
          phase === "denied" ? "absent" : "files",
        ),
        "CAPABILITY_FAILED",
      );
      expect(error.details).toMatchObject({
        callId: expect.any(String),
        phase: `audit_${phase === "missing" ? "allow" : phase}`,
        executionState: "not_started",
      });
      expect(String(error)).not.toContain("private-audit-error");
      w.none();
    },
  );
  it.each(["fs", "exec", "egress"])(
    "hides %s sink errors, audits failed execution and reports unknown state",
    async (kind) => {
      const error = new Error("fake-secret-in-sink-error");
      const fs = new RecordingFsSink({ error });
      const exec = new RecordingExecSink({ error });
      const egress = new RecordingEgressSink({}, { error });
      const w = world({ fs, exec, egress });
      await w.install();
      const failed = await expectPlumsError(
        w.call(kind === "fs" ? write : kind === "exec" ? command : send),
        "CAPABILITY_FAILED",
      );
      expect(failed.details).toMatchObject({
        callId: expect.any(String),
        phase: "sink",
        executionState: "unknown",
      });
      expect(w.events.at(-1)).toMatchObject({
        phase: "result",
        outcome: "failed",
        executionState: "unknown",
      });
      expect(JSON.stringify(w.events) + String(failed)).not.toContain(
        error.message,
      );
      expect(
        fs.records.length + exec.records.length + egress.records.length,
      ).toBe(1);
    },
  );
  it("reports completed execution when result audit fails, with no automatic retry", async () => {
    const w = world({
      onAudit: (event) => {
        if (event.phase === "result") throw new Error("post-audit-error");
      },
    });
    await w.install();
    const error = await expectPlumsError(w.call(write), "CAPABILITY_FAILED");
    expect(error.details).toMatchObject({
      phase: "audit_result",
      executionState: "completed",
      callId: expect.any(String),
    });
    expect(error.message).toContain("已完成");
    expect(error.message).toContain("勿自动重试");
    expect(w.fs.records).toHaveLength(1);
  });
  it("preserves unknown execution state if auditing a sink failure also fails", async () => {
    const fs = new RecordingFsSink({ error: new Error("after-effect") });
    const w = world({
      fs,
      onAudit: (event) => {
        if (event.phase === "result") throw new Error("audit-error");
      },
    });
    await w.install();
    expect(
      (await expectPlumsError(w.call(write), "CAPABILITY_FAILED")).details,
    ).toMatchObject({ phase: "audit_result", executionState: "unknown" });
    expect(fs.records).toHaveLength(1);
  });
  it("redacts known secrets in event fields, confirmation text and denial errors", async () => {
    const w = world();
    const secret = "fake-audit-secret";
    const manifest: ManifestV2 = {
      ...w.manifest,
      id: secret,
      name: secret,
      permissions: w.manifest.permissions.map((p) => ({
        ...p,
        id: `${p.id}-${secret}`,
        reason: secret,
      })),
      settingsSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            title: "Token",
            description: "Token",
            "x-secret": true,
          },
        },
      },
    };
    await w.install(manifest);
    await w.secrets.set(secretRef(manifest.id, "token"), secret);
    await w.call(write, `files-${secret}`, secret);
    const error = await expectPlumsError(
      w.call(read, "absent", secret),
      "PERMISSION_DENIED",
    );
    expect(
      JSON.stringify(w.events) +
        JSON.stringify(w.confirm.asked) +
        JSON.stringify(error) +
        error.message,
    ).not.toContain(secret);
    expect(JSON.stringify(w.events)).toContain("[REDACTED]");
  });
  it("hides SecretStore read failures and prevents execution before audit", async () => {
    const w = world({
      secrets: {
        async get() {
          throw new Error("private-secret-value");
        },
        async set() {},
        async delete() {},
      },
    });
    await w.install({
      ...w.manifest,
      settingsSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            title: "Token",
            description: "Token",
            "x-secret": true,
          },
        },
      },
    });
    const error = await expectPlumsError(w.call(write), "CAPABILITY_FAILED");
    expect(error.details).toMatchObject({
      phase: "audit_confirmation",
      executionState: "not_started",
    });
    expect(JSON.stringify(error) + error.message).not.toContain(
      "private-secret-value",
    );
    w.none();
  });
  it("cannot mutate immutable audit events to change the authorized target", async () => {
    const w = world({
      onAudit: (event) => {
        expect(Object.isFrozen(event)).toBe(true);
      },
    });
    await w.install();
    await w.call(write);
    expect(w.fs.records[0]?.rootPath).toBe(realpathSync(w.root));
  });
  it("copies sink output before awaiting result audit", async () => {
    const data = new Uint8Array([1, 2]);
    const w = world({
      fs: {
        async read() {
          return data;
        },
        async write() {},
        async list() {
          return [];
        },
      },
      onAudit: (event) => {
        if (event.phase === "result") data[0] = 99;
      },
    });
    await w.install();
    expect(await w.call(read)).toMatchObject({ data: new Uint8Array([1, 2]) });
  });
  it("retains redaction values after a concurrent uninstall removes their references", async () => {
    const secret = "fake-removed-during-confirmation";
    let core!: Core;
    const w = world({
      confirm: {
        async ask() {
          await core.uninstall(secret);
          return true;
        },
      },
    });
    core = w.core;
    await w.install({
      ...w.manifest,
      id: secret,
      settingsSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            title: "Token",
            description: "Token",
            "x-secret": true,
          },
        },
      },
    });
    await w.secrets.set(secretRef(secret, "token"), secret);
    const error = await expectPlumsError(
      w.call(write, "files", secret),
      "PERMISSION_DENIED",
    );
    expect(await w.secrets.get(secretRef(secret, "token"))).toBeUndefined();
    expect(
      JSON.stringify(w.events) + JSON.stringify(error) + error.message,
    ).not.toContain(secret);
    w.none();
  });
  it("retains redaction values when uninstall starts during the initial filesystem check", async () => {
    const secret = "fake-removed-during-path-check";
    const w = world();
    await w.install({
      ...w.manifest,
      id: secret,
      settingsSchema: {
        type: "object",
        properties: {
          token: {
            type: "string",
            title: "Token",
            description: "Token",
            "x-secret": true,
          },
        },
      },
    });
    await w.secrets.set(secretRef(secret, "token"), secret);
    const pending = expectPlumsError(
      w.call(read, "files", secret),
      "PERMISSION_DENIED",
    );
    await w.core.uninstall(secret);
    const error = await pending;
    expect(
      JSON.stringify(w.events) + JSON.stringify(error) + error.message,
    ).not.toContain(secret);
    w.none();
  });
});

describe("capability constructor contracts", () => {
  it.each([
    { fs: {} },
    { exec: {} },
    { confirm: null },
    { onAudit: {} },
    { confirmTimeoutMs: 0 },
    { confirmTimeoutMs: -1 },
    { confirmTimeoutMs: 1.5 },
    { confirmTimeoutMs: 2_147_483_648 },
    { confirmTimeoutMs: null },
    { roots: { workspace: "" } },
    { roots: [] },
    { programs: { test: "bad\0program" } },
  ])(
    "rejects invalid supplied collaborators or configuration (%j)",
    (extra) => {
      expect(() => world(extra as never)).toThrow(TypeError);
    },
  );
});
