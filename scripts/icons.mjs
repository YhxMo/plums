import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = join(root, ".cache/icon-generation");
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@tauri-apps/cli/tauri.js",
    "icon",
    "src-tauri/icons/source.png",
    "--output",
    output,
  ],
  { cwd: root, stdio: "inherit" },
);
if (result.error) throw result.error;
if (result.status !== 0)
  throw new Error(`Icon generation failed: ${result.status ?? result.signal}`);
for (const name of ["icon.png", "icon.icns", "android"])
  cpSync(join(output, name), join(root, "src-tauri/icons", name), {
    recursive: true,
  });
for (const name of [
  "mipmap-anydpi-v26/ic_launcher.xml",
  "values/ic_launcher_background.xml",
]) {
  const path = join(root, "src-tauri/icons/android", name);
  writeFileSync(path, readFileSync(path, "utf8").trimEnd() + "\n");
}
mkdirSync(join(root, "extensions/brand"), { recursive: true });
cpSync(join(output, "128x128.png"), join(root, "extensions/brand/plums.png"));
console.log("Updated macOS, Android and web icons from source.png.");
