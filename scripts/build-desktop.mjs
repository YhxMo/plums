import { build } from "esbuild";
import { copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
for (const kind of ["agent", "manager", "confirm"])
  await build({
    entryPoints: [root + `packages/desktop/src/${kind}-preload.ts`],
    outfile: root + `packages/desktop/dist/${kind}-preload.cjs`,
    bundle: true,
    platform: "node",
    format: "cjs",
    external: ["electron"],
    target: "node24",
  });
await build({
  entryPoints: [root + "packages/desktop/src/broker.ts"],
  outfile: root + "packages/desktop/dist/broker.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  external: ["better-sqlite3", "isolated-vm"],
  target: "node26",
  banner: {
    js: "import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);",
  },
});
await copyFile(
  root + "packages/host/dist/worker.js",
  root + "packages/desktop/dist/worker.js",
);
// The secure file helper is macOS-only; Linux builds can validate JS/UI without it.
if (process.platform === "darwin")
  await copyFile(
    root + "packages/host/dist/secure-fs",
    root + "packages/desktop/dist/secure-fs",
  );
