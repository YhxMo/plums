import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { format } from "prettier";
import { projectEnvironment } from "./environment.mjs";

const check = process.argv.includes("--check");
for (const experimental of [false, true]) {
  const args = [
    "run",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--locked",
    "--offline",
    "--quiet",
    "--example",
    "export-ipc",
  ];
  if (experimental) args.push("--features", "native-transport-experiment");
  const result = spawnSync("cargo", args, {
    env: projectEnvironment(),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw Error(result.stderr || `IPC export exited ${result.status}`);
  const output = await format(result.stdout, { parser: "typescript" });
  const path = resolve(
    "src/native",
    experimental ? "experimental.generated.ts" : "contract.generated.ts",
  );
  if (check) {
    if (readFileSync(path, "utf8") !== output)
      throw Error(`IPC contract is stale: ${path}; run npm run ipc:generate`);
  } else writeFileSync(path, output);
  console.log(
    `${check ? "Checked" : "Generated"} ${experimental ? "experimental" : "default"} IPC contract`,
  );
}
