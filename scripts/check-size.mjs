import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { projectFiles } from "./project-files.mjs";

// Past `review`, a file is listed as a reminder to check whether it still
// reads as one responsibility; only `ceiling` fails. Split by responsibility,
// never just to get under a number.
export const sizeLimits = { review: 400, ceiling: 800 };

export function checkSize(root = ".") {
  const rows = [];
  let failures = 0;
  for (const file of projectFiles(root)) {
    if (!/\.(?:ts|tsx|js|mjs|rs|kt|css)$/.test(file)) continue;
    const text = readFileSync(`${root}/${file}`, "utf8");
    const lines = text
      ? text.split("\n").length - Number(text.endsWith("\n"))
      : 0;
    if (lines <= sizeLimits.review) continue;
    const failed = lines > sizeLimits.ceiling;
    if (failed) failures++;
    rows.push(`${file} | ${lines}${failed ? " | 超过上限，请拆分" : ""}`);
  }
  return { rows, failures };
}

// Importing the checker in tests does not scan the caller's working directory.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { rows, failures } = checkSize();
  console.log(
    `超过 ${sizeLimits.review} 行的文件（改动时留意是否仍是单一职责）：`,
  );
  console.log(rows.join("\n") || "无");
  console.log(
    `行数检查：${failures} 个文件超过 ${sizeLimits.ceiling} 行上限。`,
  );
  if (failures) process.exitCode = 1;
}
