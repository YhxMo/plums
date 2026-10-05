import { createInterface } from "node:readline";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
const tasks = new Map(),
  callbacks = new Map();
let next = 0;
const send = (m) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\n");
const callback = (method, params) =>
  new Promise((resolve, reject) => {
    const id = "callback-" + ++next;
    callbacks.set(id, { resolve, reject });
    send({ id, method, params });
  });
async function execute(input, signal) {
  const results = [];
  for (const action of input.actions ?? []) {
    signal.throwIfAborted();
    if (
      ![
        "read",
        "write",
        "list",
        "exec",
        "network",
        "wait",
        "connector",
      ].includes(action.type)
    )
      throw Error("Unknown example action");
    // These modes belong to this example, not the host. The default asks the actual user.
    const mode = input.mode ?? "ask";
    if (!["ask", "full", "review"].includes(mode))
      throw Error("Unknown example mode");
    if (
      mode === "review" &&
      !["read", "list", "wait", "connector"].includes(action.type)
    )
      throw Error("Example automatic review refused this operation");
    if (
      mode === "ask" &&
      !(await callback("host.confirm", {
        message: `本机引擎准备执行 ${action.type}${action.path ? `：${action.path}` : ""}，是否允许？`,
      }))
    )
      throw Error("User refused");
    let result;
    if (action.type === "read") result = await readFile(action.path, "utf8");
    if (action.type === "write") {
      await writeFile(action.path, action.text);
      result = { written: true };
    }
    if (action.type === "list") result = await readdir(action.path);
    if (action.type === "network") {
      const response = await fetch(action.url, { signal });
      result = { status: response.status, text: await response.text() };
    }
    if (action.type === "wait") {
      await delay(Math.min(60_000, action.ms), undefined, { signal });
      result = { waited: true };
    }
    if (action.type === "connector")
      result = await callback("host.invoke", {
        packageId: action.packageId ?? "model",
        kind: "connectors",
        name: "complete",
        input: { messages: [{ role: "user", content: action.text }] },
      });
    if (action.type === "exec")
      result = await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["-e", action.code], {
          cwd: action.cwd,
          signal,
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
          output += chunk;
          if (output.length > 64 * 1024) child.kill();
        });
        child.stderr.on("data", () => {});
        child.on("error", reject);
        child.on("exit", (code) => resolve({ exitCode: code, output }));
      });
    results.push(result);
    send({
      method: "engine.event",
      params: { topic: "progress", data: { completed: results.length } },
    });
  }
  return { results };
}
createInterface({ input: process.stdin }).on("line", (line) => {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    process.exit(2);
  }
  if (m.method === "initialize") {
    send({ id: m.id, result: { protocol: "jsonrpc-jsonl-v1" } });
    return;
  }
  if (m.method === "$/cancelRequest") {
    tasks.get(m.params.id)?.abort();
    return;
  }
  if (m.method === "run") {
    const controller = new AbortController();
    tasks.set(m.id, controller);
    void execute(m.params, controller.signal)
      .then(
        (result) => send({ id: m.id, result }),
        () =>
          send({
            id: m.id,
            error: {
              code: -32001,
              message: controller.signal.aborted ? "Cancelled" : "Task failed",
            },
          }),
      )
      .finally(() => tasks.delete(m.id));
    return;
  }
  const p = callbacks.get(m.id);
  if (p) {
    callbacks.delete(m.id);
    m.error ? p.reject(Error("Callback refused")) : p.resolve(m.result);
    return;
  }
  if (m.id !== undefined)
    send({ id: m.id, error: { code: -32601, message: "Method not found" } });
});
