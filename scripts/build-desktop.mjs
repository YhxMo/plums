import { build } from "esbuild";
import { copyFile, cp, rm } from "node:fs/promises";
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
  plugins: [
    {
      name: "trusted-host-adapter",
      setup(b) {
        b.onResolve({ filter: /^@plums\/(host|core)$/ }, () => ({
          path: "./host-adapter/index.mjs",
          external: true,
        }));
      },
    },
  ],
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

await copyFile(
  root + "packages/host/dist/engine-supervisor.js",
  root + "packages/desktop/dist/engine-supervisor.js",
);

for (const name of [
  "controlled-worker.cjs",
  "controlled-supervisor.js",
  ...(process.platform === "darwin" ? ["controlled-probe"] : []),
])
  await copyFile(
    root + "packages/host/dist/" + name,
    root + "packages/desktop/dist/" + name,
  );

await rm(root + "packages/desktop/dist/host-adapter", {
  recursive: true,
  force: true,
});
await cp(
  root + "packages/host/dist/host-adapter",
  root + "packages/desktop/dist/host-adapter",
  { recursive: true },
);

await rm(root + "packages/desktop/dist/foundation-resources", {
  recursive: true,
  force: true,
});
await cp(
  root + "packages/host/dist/foundation-resources",
  root + "packages/desktop/dist/foundation-resources",
  { recursive: true },
);
