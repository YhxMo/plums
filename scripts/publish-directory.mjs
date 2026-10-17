import { existsSync, mkdirSync, mkdtempSync, renameSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** Publish the already accepted directory, retaining the previous delivery.
 * @param {string} stage
 * @param {string} current
 * @param {string} archives
 * @param {(from: string, to: string) => void} rename
 */
export function publishDirectory(
  stage,
  current,
  archives,
  rename = renameSync,
) {
  stage = resolve(stage);
  current = resolve(current);
  if (
    stage === current ||
    stage.startsWith(current + "/") ||
    current.startsWith(stage + "/")
  )
    throw new Error(
      "Candidate and current delivery must be separate directories",
    );
  if (!existsSync(stage)) throw new Error("Candidate directory is missing");
  mkdirSync(dirname(current), { recursive: true });
  mkdirSync(archives, { recursive: true });
  const backup = existsSync(current)
    ? join(
        mkdtempSync(join(archives, `${basename(current)}-`)),
        basename(current),
      )
    : undefined;
  try {
    if (backup) rename(current, backup);
    rename(stage, current);
  } catch (error) {
    if (backup && !existsSync(current) && existsSync(backup))
      rename(backup, current);
    throw error;
  }
  return { current, archived: backup ?? null };
}
