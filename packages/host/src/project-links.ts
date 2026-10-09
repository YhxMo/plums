import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PlumsError } from "@plums/core";
const run = promisify(execFile);
/** Trusted project roots only; descriptor traversal counts all aliases visible in each root.
 * This is admission validation, not a kernel inode boundary or a runtime guarantee. */
export async function checkProjectLinks(root: string): Promise<void> {
  try {
    if (process.platform !== "darwin" || process.arch !== "arm64")
      throw Error();
    const sibling = fileURLToPath(new URL("./project-scan", import.meta.url));
    const helper = existsSync(sibling)
      ? sibling
      : fileURLToPath(new URL("../dist/project-scan", import.meta.url));
    const result = await run(helper, [root], {
      env: {},
      timeout: 8000,
      maxBuffer: 1024,
    });
    if (result.stdout.trim() !== "verified") throw Error();
  } catch {
    throw new PlumsError({
      code: "TIER_UNAVAILABLE",
      message: "无法确认项目文件的全部硬链接别名均在项目内，请检查目录。",
      details: { reason: "PROJECT_ALIASES_UNVERIFIED" },
    });
  }
}
