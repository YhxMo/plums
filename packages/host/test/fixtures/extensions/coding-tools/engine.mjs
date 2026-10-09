import { createInterface } from "node:readline";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
let project;
// Stable fixture validation; the production boundary must be provided by Seatbelt.
function inside(value) {
  if (!project || typeof value !== "string")
    throw Error("FIXTURE_INPUT_INVALID");
  const file = path.resolve(project, value);
  if (file !== project && !file.startsWith(project + path.sep))
    throw Error("FIXTURE_PATH_OUTSIDE");
  return file;
}
function limited(value) {
  const bytes = Buffer.from(value ?? "", "utf8");
  if (bytes.length <= 65536)
    return { text: bytes.toString("utf8"), truncated: false };
  let end = 65536;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}
createInterface({ input: process.stdin }).on("line", async (line) => {
  const m = JSON.parse(line);
  if (!m.method || m.method === "$/cancelRequest") return;
  try {
    let result;
    if (m.method === "initialize") {
      project = m.params.context.projects[0]?.path;
      if (!project || !path.isAbsolute(project))
        throw Error("FIXTURE_PROJECT_REQUIRED");
      project = path.resolve(project);
      result = { protocol: "jsonrpc-jsonl-v1" };
    } else if (m.method === "write_file") {
      await writeFile(inside(m.params.path), m.params.content);
      result = { ok: true };
    } else if (m.method === "read_file")
      result = await readFile(inside(m.params.path), "utf8");
    else if (m.method === "list_dir")
      result = await readdir(inside(m.params.path ?? "."));
    else if (m.method === "run") {
      if (
        typeof m.params.program !== "string" ||
        !m.params.program ||
        !Array.isArray(m.params.args) ||
        m.params.args.some((arg) => typeof arg !== "string")
      )
        throw Error("FIXTURE_INPUT_INVALID");
      const child = spawnSync(m.params.program, m.params.args, {
        cwd: inside(m.params.cwd ?? "."),
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 1 << 20,
        env: process.env,
      });
      if (child.error || child.status === null)
        throw Error("FIXTURE_COMMAND_FAILED");
      const stdout = limited(child.stdout),
        stderr = limited(child.stderr);
      result = {
        exitCode: child.status,
        stdout: stdout.text,
        stderr: stderr.text,
        ...(stdout.truncated || stderr.truncated ? { truncated: true } : {}),
      };
    } else throw Error("FIXTURE_METHOD_UNKNOWN");
    console.log(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }));
  } catch (error) {
    console.log(
      JSON.stringify({
        jsonrpc: "2.0",
        id: m.id,
        error: {
          code: -32000,
          message:
            /^FIXTURE_(INPUT_INVALID|PATH_OUTSIDE|PROJECT_REQUIRED|COMMAND_FAILED|METHOD_UNKNOWN)$/.test(
              error?.message,
            )
              ? error.message
              : "FIXTURE_PROJECT_FAILED",
        },
      }),
    );
  }
});
