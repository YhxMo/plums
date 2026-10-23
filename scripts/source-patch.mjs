import { execFileSync } from "node:child_process";
import { closeSync, openSync } from "node:fs";

/** @param {string} root @param {string} destination @param {Set<string>} sourceFiles */
export function writeSourcePatch(root, destination, sourceFiles) {
  const output = openSync(destination, "w");
  // Git writes into one file descriptor; large patches never enter a JS buffer.
  const append = (/** @type {string[]} */ args) =>
    execFileSync("git", args, {
      cwd: root,
      stdio: ["ignore", output, "pipe"],
    });
  try {
    append(["diff", "--binary", "HEAD"]);
    const untracked = execFileSync(
      "git",
      ["ls-files", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    );
    for (const path of untracked.split("\0")) {
      if (!sourceFiles.has(path) || path === "goal.md") continue;
      try {
        append(["diff", "--binary", "--no-index", "--", "/dev/null", path]);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "status" in error &&
          error.status === 1
        ))
          throw error;
      }
    }
  } finally {
    closeSync(output);
  }
}
