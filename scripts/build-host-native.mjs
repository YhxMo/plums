import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform === "darwin") {
  mkdirSync(root + "packages/host/dist", { recursive: true });
  for (const name of ["secure-fs", "controlled-probe"])
    execFileSync(
      "clang",
      [
        "-O2",
        "-mmacosx-version-min=13.5",
        "-Wno-deprecated-declarations",
        root + "packages/host/native/" + name + ".c",
        "-o",
        root + "packages/host/dist/" + name,
      ],
      { stdio: "inherit" },
    );
}

await build({
  entryPoints: [root + "packages/host/src/controlled-worker.ts"],
  outfile: root + "packages/host/dist/controlled-worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node26",
});

await build({
  entryPoints: [root + "packages/host/src/worker.ts"],
  outfile: root + "packages/host/dist/worker.js",
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["isolated-vm"],
  target: "node26",
});
