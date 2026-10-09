// Test-only JSONL process: exercises the host's trust, I/O and cancellation boundaries.
import { createInterface } from "node:readline";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
const requests = new Map(),
  replies = new Map();
let sequence = 0;
const send = (message) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
function callback(method, params) {
  return new Promise((resolve, reject) => {
    const id = "fixture-" + ++sequence;
    replies.set(id, { resolve, reject });
    send({ id, method, params });
  });
}
async function run(input, signal) {
  const results = [];
  for (const action of input.actions ?? []) {
    signal.throwIfAborted();
    if (
      input.mode !== "full" &&
      !(await callback("host.confirm", {
        message: "Fixture " + action.type + " " + (action.path ?? ""),
      }))
    )
      throw Error("refused");
    switch (action.type) {
      case "read":
        results.push(await readFile(action.path, "utf8"));
        break;
      case "write":
        await writeFile(action.path, action.text);
        results.push({ written: true });
        break;
      case "wait":
        send({
          method: "engine.event",
          params: { topic: "fixture.wait.started", data: null },
        });
        await wait(action.ms, undefined, { signal });
        results.push({ waited: true });
        break;
      case "network": {
        const response = await fetch(action.url, { signal });
        results.push({ status: response.status, text: await response.text() });
        break;
      }
      case "connector":
        results.push(
          await callback("host.invoke", {
            packageId: action.packageId ?? "model",
            kind: "connectors",
            name: "complete",
            input: { messages: [{ role: "user", content: action.text }] },
          }),
        );
        break;
      case "exec":
        results.push(
          await new Promise((resolve, reject) => {
            const child = spawn(process.execPath, ["-e", action.code], {
              cwd: action.cwd,
              signal,
              stdio: ["ignore", "pipe", "pipe"],
            });
            let output = "";
            child.stdout.on("data", (b) => (output += b));
            child.stderr.resume();
            child.on("error", reject);
            child.on("close", (exitCode) => resolve({ exitCode, output }));
          }),
        );
        break;
      default:
        throw Error("invalid fixture operation");
    }
  }
  return { results };
}
createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line),
    response = replies.get(message.id);
  if (response) {
    replies.delete(message.id);
    message.error
      ? response.reject(Error("fixture callback failed"))
      : response.resolve(message.result);
    return;
  }
  if (message.method === "initialize") {
    send({ id: message.id, result: { protocol: "jsonrpc-jsonl-v1" } });
    return;
  }
  if (message.method === "$/cancelRequest") {
    requests.get(message.params.id)?.abort();
    return;
  }
  if (message.method === "run") {
    const controller = new AbortController();
    requests.set(message.id, controller);
    run(message.params, controller.signal)
      .then(
        (result) => send({ id: message.id, result }),
        () =>
          send({
            id: message.id,
            error: { code: -32001, message: "Fixture operation failed" },
          }),
      )
      .finally(() => requests.delete(message.id));
  }
});
