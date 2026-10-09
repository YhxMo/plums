import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { activate } from "./fixtures/extensions/coding-tools/main.js";

const children: ChildProcessWithoutNullStreams[] = [],
  dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    children.splice(0).map(
      (child) =>
        new Promise<void>((done) => {
          if (child.exitCode !== null || child.signalCode !== null)
            return done();
          child.once("exit", () => done());
          child.kill();
        }),
    ),
  );
  await Promise.all(
    dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "plums-coding-argv-"));
  dirs.push(dir);
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "./fixtures/extensions/coding-tools/engine.mjs",
          import.meta.url,
        ),
      ),
    ],
    { env: {}, stdio: ["pipe", "pipe", "pipe"] },
  );
  children.push(child);
  let id = 0;
  const pending = new Map<number, (value: any) => void>();
  createInterface({ input: child.stdout }).on("line", (line) => {
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
    pending.delete(reply.id);
  });
  const call = (method: string, params: unknown) =>
    new Promise<any>((done) => {
      const current = ++id;
      pending.set(current, done);
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id: current, method, params }) + "\n",
      );
    });
  expect(
    (await call("initialize", { context: { projects: [{ path: dir }] } }))
      .result,
  ).toEqual({ protocol: "jsonrpc-jsonl-v1" });
  return { call, dir };
}
it("declares argv schemas and wraps call output in the protocol result", async () => {
  let contribution: any;
  activate({
    register: (_kind: string, _name: string, callback: unknown) => {
      contribution = callback;
    },
    engine: {
      start: async () => {},
      request: async () => ({ exitCode: 0, stdout: "fixture", stderr: "" }),
    },
  });
  const definitions = await contribution({ operation: "list", input: {} });
  expect(definitions).toHaveLength(4);
  expect(
    definitions.find((d: any) => d.name === "run").inputSchema.required,
  ).toEqual(["program", "args"]);
  expect(
    await contribution({
      operation: "call",
      input: { name: "run", arguments: { program: "fixture", args: [] } },
    }),
  ).toEqual({
    ok: true,
    content: JSON.stringify({ exitCode: 0, stdout: "fixture", stderr: "" }),
  });
});
it("executes argv literally and reports both streams and a nonzero exit code", async () => {
  const f = await fixture(),
    text = 'literal ; $(fixture) "quoted"';
  const { result } = await f.call("run", {
    program: process.execPath,
    args: [
      "-e",
      "process.stdout.write(process.argv[1]);process.stderr.write('err');process.exitCode=7",
      text,
    ],
  });
  expect(result).toEqual({ exitCode: 7, stdout: text, stderr: "err" });
});
it("caps each UTF-8 stream at 64 KiB without cutting a character", async () => {
  const f = await fixture();
  const { result } = await f.call("run", {
    program: process.execPath,
    args: [
      "-e",
      "process.stdout.write('界'.repeat(30000));process.stderr.write('é'.repeat(40000))",
    ],
  });
  expect(result.truncated).toBe(true);
  expect(Buffer.byteLength(result.stdout)).toBe(65535);
  expect(Buffer.byteLength(result.stderr)).toBe(65536);
  expect(result.stdout).not.toContain("�");
  expect(result.stderr).not.toContain("�");
});
it.each(["read_file", "write_file", "list_dir", "run"])(
  "rejects paths outside the fixture project for %s",
  async (method) => {
    const f = await fixture();
    expect(
      (
        await f.call(method, {
          path: "../outside",
          content: "fixture",
          program: process.execPath,
          args: [],
          cwd: "../outside",
        })
      ).error.message,
    ).toBe("FIXTURE_PATH_OUTSIDE");
  },
);
it("rejects command strings and non-string argv", async () => {
  const f = await fixture();
  for (const input of [
    { command: "printf fixture" },
    { program: process.execPath, args: [1] },
  ])
    expect((await f.call("run", input)).error.message).toBe(
      "FIXTURE_INPUT_INVALID",
    );
});
