import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { projectFiles } from "./project-files.mjs";

const files = Object.fromEntries(
  projectFiles()
    .filter((name) => !name.endsWith(".md") && !name.startsWith("evidence/"))
    .map((name) => [
      name,
      createHash("sha256").update(readFileSync(name)).digest("hex"),
    ]),
);
const sha256 = createHash("sha256").update(JSON.stringify(files)).digest("hex");
const document = {
  schema: 1,
  scope:
    "implementation, tests, configuration and lockfiles; excludes prose, private goal, evidence and generated artifacts",
  sha256,
  files,
};
mkdirSync("evidence", { recursive: true });
const path = `evidence/source-manifest-${sha256}.json`;
writeFileSync(path, JSON.stringify(document, null, 2) + "\n", { flag: "wx" });
console.log(
  JSON.stringify({ path, sha256, fileCount: Object.keys(files).length }),
);
