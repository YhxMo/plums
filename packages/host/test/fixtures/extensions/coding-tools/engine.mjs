import { createInterface } from "node:readline";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
let project;
createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.method === "$/cancelRequest") return;
  try {
    let result;
    if (m.method === "initialize") {
      project = m.params.context.projects[0]?.path;
      if (!project) throw Error("FIXTURE_PROJECT_REQUIRED");
      result = { protocol: "jsonrpc-jsonl-v1" };
    } else if (m.method === "write_file") {
      await writeFile(path.resolve(project, m.params.path), m.params.content);
      result = { ok: true };
    } else if (m.method === "read_file")
      result = await readFile(path.resolve(project, m.params.path), "utf8");
    else if (m.method === "list_dir")
      result = await readdir(path.resolve(project, m.params.path ?? "."));
    else if (m.method === "run") {
      const child = spawnSync("/bin/sh", ["-c", m.params.command], {
        cwd: project,
        encoding: "utf8",
        timeout: 5000,
      });
      if (child.error || child.status !== 0)
        throw Error("FIXTURE_COMMAND_FAILED");
      result = { exitCode: child.status, stdout: child.stdout };
    } else throw Error("FIXTURE_METHOD_UNKNOWN");
    console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  } catch {
    console.log(
      JSON.stringify({
        jsonrpc: "2.0",
        id: m.id,
        error: { code: -32000, message: "FIXTURE_PROJECT_FAILED" },
      }),
    );
  }
});
