import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * package.json holds the app version: the Tauri config reads it from there,
 * and Cargo, which cannot, must repeat the same value.
 * @param {string} root
 */
export function versionProblems(root) {
  const read = (/** @type {string} */ path) =>
    readFileSync(join(root, path), "utf8");
  const { version } = JSON.parse(read("package.json"));
  const problems = [];
  const tauri = JSON.parse(read("src-tauri/tauri.conf.json"));
  if (tauri.version !== "../package.json")
    problems.push(
      'src-tauri/tauri.conf.json: version must be "../package.json"',
    );
  const crate = read("src-tauri/Cargo.toml")
    .split(/^\[/m)
    .find((section) => section.startsWith("package]"))
    ?.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  if (crate !== version)
    problems.push(
      `src-tauri/Cargo.toml: version ${crate} differs from package.json ${version}`,
    );
  return problems;
}
