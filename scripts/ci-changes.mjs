import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";

const { CI_BASE, CI_HEAD, CI_EVENT, GITHUB_OUTPUT } = process.env;
if (!CI_BASE || !CI_HEAD || !GITHUB_OUTPUT)
  throw new Error("CI_BASE, CI_HEAD and GITHUB_OUTPUT are required.");

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
const initial = /^0+$/.test(CI_BASE);
const base = initial
  ? undefined
  : CI_EVENT === "pull_request"
    ? git("merge-base", CI_BASE, CI_HEAD).trim()
    : CI_BASE;
// Include both sides of renames so moving source into docs cannot skip CI.
const names = base
  ? git("diff", "--name-only", "--no-renames", "-z", base, CI_HEAD, "--")
  : git("ls-tree", "-r", "--name-only", "-z", CI_HEAD);
const paths = names.split("\0").filter(Boolean);
// Markdown fixtures and extension inputs are code, not project documentation.
const docsOnly =
  paths.length > 0 &&
  paths.every((path) => /^(?:[^/]+|(?:docs|evidence)\/.+)\.md$/.test(path));

if (base) git("diff", "--check", base, CI_HEAD, "--");
appendFileSync(GITHUB_OUTPUT, `code=${!docsOnly}\n`);
console.log(
  `${paths.length} changed paths: ${docsOnly ? "documentation only" : "full verification"}`,
);
