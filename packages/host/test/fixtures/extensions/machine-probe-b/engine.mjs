import { createInterface } from "node:readline";
import { writeFile } from "node:fs/promises";
let context;
const send = (value) =>
  console.log(JSON.stringify({ jsonrpc: "2.0", ...value }));
createInterface({ input: process.stdin }).on("line", async (line) => {
  const message = JSON.parse(line);
  if (!message.method || message.method === "$/cancelRequest") return;
  try {
    let result;
    if (message.method === "initialize") {
      context = message.params.context;
      result = { protocol: "jsonrpc-jsonl-v1" };
    } else if (message.method === "pid") result = process.pid;
    else if (message.method === "context") result = context;
    else if (message.method === "write") {
      await writeFile(message.params.path, message.params.content);
      result = "written";
    } else if (message.method === "environment") {
      result = {
        syntheticCredentialPresent: Object.values(process.env).some((value) =>
          value?.includes(message.params.credential),
        ),
      };
    } else throw Error("PROBE_UNKNOWN");
    send({ id: message.id, result });
  } catch {
    send({ id: message.id, error: { code: -32000, message: "PROBE_FAILED" } });
  }
});
