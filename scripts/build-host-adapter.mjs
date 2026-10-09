import { build } from "esbuild";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)),
  dist = path.join(root, "packages/host/dist"),
  target = path.join(dist, "host-adapter");
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
const inputs = {};
for (const pkg of ["host", "core", "sdk"]) {
  const dir = path.join(root, "packages", pkg, "dist");
  for (const name of (await readdir(dir)).sort()) {
    if (
      !name.endsWith(".js") &&
      !name.endsWith(".cjs") &&
      ![
        "secure-fs",
        "controlled-probe",
        "project-probe",
        "project-scan",
      ].includes(name)
    )
      continue;
    inputs[pkg + "/" + name] = createHash("sha256")
      .update(await readFile(path.join(dir, name)))
      .digest("hex");
  }
}
await writeFile(
  path.join(target, "source-inputs.json"),
  JSON.stringify({ formatVersion: 1, inputs }, null, 2) + "\n",
);
await build({
  stdin: {
    contents:
      'export * from "./index.js"; export { PlumsError } from "@plums/core";',
    resolveDir: dist,
    sourcefile: "trusted-host-adapter.mjs",
  },
  outfile: path.join(target, "index.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["better-sqlite3", "isolated-vm"],
  target: "node26",
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);",
  },
});
for (const name of [
  "worker.js",
  "engine-supervisor.js",
  "controlled-supervisor.js",
  "controlled-worker.cjs",
  ...(process.platform === "darwin"
    ? ["secure-fs", "controlled-probe", "project-probe", "project-scan"]
    : []),
])
  await copyFile(path.join(dist, name), path.join(target, name));
