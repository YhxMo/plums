import { readdirSync } from "node:fs";
import { join } from "node:path";

const excludedNames = new Set([".git", "node_modules"]);
const excludedPaths = new Set([
  ".cache",
  ".dev-data",
  "dist",
  "src-tauri/target",
  "src-tauri/gen",
  "test-results",
  "playwright-report",
  "evidence/raw",
]);
/** @returns {string[]} */
export function projectFiles(root = ".", prefix = "") {
  return readdirSync(join(root, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name === ".DS_Store" || excludedNames.has(entry.name))
        return [];
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excludedPaths.has(relative)) return [];
      if (!prefix && entry.name === "release" && entry.isDirectory()) return [];
      if (entry.isSymbolicLink())
        throw new Error(`Unexpected source symlink: ${relative}`);
      return entry.isDirectory() ? projectFiles(root, relative) : [relative];
    })
    .sort();
}
