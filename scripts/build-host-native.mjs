import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform === "darwin") {
  mkdirSync(root + "packages/host/dist", { recursive: true });
  execFileSync(
    "clang",
    [
      "-O2",
      "-mmacosx-version-min=13.5",
      "-Wno-deprecated-declarations",
      root + "packages/host/native/secure-fs.c",
      "-o",
      root + "packages/host/dist/secure-fs",
    ],
    { stdio: "inherit" },
  );
}
