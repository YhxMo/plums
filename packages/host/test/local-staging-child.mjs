import { createRequire } from "node:module";
import { syncBuiltinESMExports } from "node:module";
const require = createRequire(import.meta.url);
const fs = require("node:fs");
const promises = require("node:fs/promises");
const [directory, marker] = process.argv.slice(2);
const writeFile = promises.writeFile;
// Stop after the real production write, before its rename; the parent sends SIGKILL.
promises.writeFile = async (...args) => {
  await writeFile(...args);
  if (String(args[0]).endsWith(".pending")) {
    fs.writeFileSync(marker, "ready", { mode: 0o600 });
    setInterval(() => {}, 1000);
    await new Promise(() => {});
  }
};
syncBuiltinESMExports();
const { LocalSecretStore } = await import("../dist/secrets.js");
await new LocalSecretStore(directory).set(
  "synthetic-crash-reference",
  "SYNTHETIC_CRASH_VALUE",
);
