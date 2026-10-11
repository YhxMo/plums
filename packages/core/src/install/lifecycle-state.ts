import { IMPORT_INVALID, PlumsError } from "../errors.js";

export interface InstallIdentity {
  installationId: string;
  version: string;
}

export interface LifecycleRecord {
  format: 1;
  token: string;
  kind: "import" | "update" | "uninstall";
  phase: "prepared" | "committed" | "aborting";
  before: InstallIdentity | null;
  version: string;
  secretRefs: string[];
}

export interface LifecycleLease {
  id: string;
  owner: string;
  record: LifecycleRecord | null;
}

export function lifecycleFailure(
  id: string,
  reason:
    | "LIFECYCLE_BUSY"
    | "INSTALLATION_CHANGED"
    | "LIFECYCLE_RECOVERY_REQUIRED",
): PlumsError {
  return new PlumsError({
    code: IMPORT_INVALID,
    message:
      reason === "LIFECYCLE_BUSY"
        ? "这个包正在安装、更新或卸载，请等待操作完成后重试。"
        : reason === "INSTALLATION_CHANGED"
          ? "安装状态已经变化，本次操作没有提交。请重新读取当前状态。"
          : "这个包的中断操作尚未恢复，已保留文件和记录，请重试恢复。",
    details: { id, reason },
  });
}

/** No timeout takeover: a stopped or slow live writer may still resume file I/O. */
export function lifecycleOwnerAlive(pid: number | null): boolean {
  if (pid === null) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export function parseLifecycleRecord(
  id: string,
  value: string | null,
): LifecycleRecord | null {
  if (value === null) return null;
  try {
    const record = JSON.parse(value) as LifecycleRecord;
    if (
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(id) ||
      id === "." ||
      id === ".." ||
      record.format !== 1 ||
      !/^[a-f0-9-]{36}$/.test(record.token) ||
      !["import", "update", "uninstall"].includes(record.kind) ||
      !["prepared", "committed", "aborting"].includes(record.phase) ||
      (record.phase === "aborting" && record.kind !== "import") ||
      (record.kind === "import"
        ? record.before !== null
        : record.before === null) ||
      typeof record.version !== "string" ||
      !(
        record.before === null ||
        (typeof record.before.installationId === "string" &&
          typeof record.before.version === "string")
      ) ||
      !Array.isArray(record.secretRefs) ||
      !record.secretRefs.every(
        (ref) => typeof ref === "string" && ref.startsWith(`secret:${id}/`),
      )
    )
      throw Error();
    return record;
  } catch {
    throw lifecycleFailure(id, "LIFECYCLE_RECOVERY_REQUIRED");
  }
}
