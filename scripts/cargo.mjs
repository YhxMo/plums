import { spawn } from "node:child_process";
import { projectEnvironment } from "./environment.mjs";
const [command, ...args] = process.argv.slice(2);
const child = spawn(
  "cargo",
  [command, "--manifest-path", "src-tauri/Cargo.toml", ...args],
  { env: projectEnvironment(), stdio: "inherit" },
);
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
