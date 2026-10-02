#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const script = realpathSync(fileURLToPath(import.meta.url));
const entry = fileURLToPath(new URL("../dist/main.js", pathToFileURL(script)));
if (!existsSync(entry)) {
  process.stderr.write("plums: 找不到 dist/main.js。请先在仓库根目录运行 pnpm build。\n");
  process.exit(1);
}

// dist/main.js starts the CLI only when it is the process entry.
process.argv[1] = entry;
await import(pathToFileURL(entry).href);
