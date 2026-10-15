import { readdirSync } from "node:fs";
import { join } from "node:path";

const excluded = new Set([
  ".git",
  "node_modules",
  ".cache",
  ".dev-data",
  "dist",
  "target",
  "gen",
  "test-results",
  "playwright-report",
  "raw",
]);
export function projectFiles(root = ".", prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      if (excluded.has(entry.name) || entry.name === ".DS_Store") return [];
      if (!prefix && entry.name === "release" && entry.isDirectory()) return [];
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink())
        throw new Error(`Unexpected source symlink: ${relative}`);
      return entry.isDirectory() ? projectFiles(root, relative) : [relative];
    })
    .sort();
}
