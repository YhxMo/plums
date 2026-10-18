import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { projectFiles } from "./project-files.mjs";

// Manually lower a cap after splitting a file; never regenerate or raise caps.
/** @type {Record<string, number>} */
export const sizeLimits = {
  "src-tauri/src/documents.rs": 510,
  "src-tauri/src/credential_bindings.rs": 454,
  "modules/extension-host/host.ts": 455,
  "modules/text-workbench/view.ts": 528,
  "src-tauri/src/credentials.rs": 233,
  "src-tauri/src/credentials_native.rs": 263,
  "src-tauri/src/transport_probe.rs": 350,
  // Existing files outside the original inventory. Stage A preserves behavior.
  "src/styles.css": 445,
  "tests/abort-reentrancy.test.ts": 441,
  "tests/documents/probe.ts": 648,
  "tests/navigation/probe.ts": 424,
  "tests/web/agent-flow.spec.ts": 690,
};

export function checkSize(root = ".") {
  const rows = [];
  let failures = 0;
  for (const file of projectFiles(root)) {
    if (!/\.(?:ts|tsx|js|mjs|rs|kt|css)$/.test(file)) continue;
    const text = readFileSync(`${root}/${file}`, "utf8");
    const lines = text
      ? text.split("\n").length - Number(text.endsWith("\n"))
      : 0;
    const limit = sizeLimits[file] ?? 400;
    if (lines <= 400 && !(file in sizeLimits)) continue;
    const failed = lines > limit;
    if (failed) failures++;
    rows.push(
      `${file} | ${lines} | ${limit} | ${limit - lines}${failed ? " | 请拆分或说明理由" : ""}`,
    );
  }
  return { rows, failures };
}

// Importing the checker in tests does not scan the caller's working directory.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { rows, failures } = checkSize();
  console.log("文件 | 当前行数 | 上限 | 剩余额度");
  console.log(rows.join("\n"));
  console.log(`行数检查：${failures} 个超限文件。上限只允许人工降低。`);
  if (failures) process.exitCode = 1;
}
