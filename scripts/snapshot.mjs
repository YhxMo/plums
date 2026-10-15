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
writeFileSync(
  "evidence/source-manifest.json",
  JSON.stringify(document, null, 2) + "\n",
);
console.log(JSON.stringify({ sha256, fileCount: Object.keys(files).length }));
