import { spawn } from "node:child_process";
import { cp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import electron from "../packages/desktop/node_modules/electron/index.js";
// The bundled broker resolves its native dependencies beside the dev application.
const stage = path.resolve(".artifacts/desktop-dev");
await mkdir(stage, { recursive: true });
await cp("packages/desktop/dist", path.join(stage, "dist"), {
  recursive: true,
});
await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify({ type: "module", main: "dist/main.js" }),
);
const hostRequire = createRequire(path.resolve("packages/host/package.json"));
const coreRequire = createRequire(path.resolve("packages/core/package.json"));
for (const [name, require] of [
  ["isolated-vm", hostRequire],
  ["better-sqlite3", coreRequire],
]) {
  const target = path.join(stage, "node_modules", name);
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { force: true });
  await symlink(path.dirname(require.resolve(name + "/package.json")), target);
}
const child = spawn(electron, [stage, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, PLUMS_NODE: process.execPath },
});
child.on("exit", (code) => process.exit(code ?? 1));
