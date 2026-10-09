import { createInterface } from "node:readline";
createInterface({ input: process.stdin }).on("line", (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.method === "$/cancelRequest") return;
  if (m.method === "crash") process.exit(23);
  const result =
    m.method === "initialize" ? { protocol: "jsonrpc-jsonl-v1" } : process.pid;
  console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
});
