import type { Platform, StoredState } from "@modules/sdk";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
/** Caller must require confirmation and reload after any uncertain result. Never replaces a backup. */
export async function recoverComposition(
  platform: Platform,
  saved: StoredState,
  backupOwner: string,
) {
  if (!backupOwner.startsWith("host.recovery."))
    throw Error("Invalid recovery owner");
  await platform.grant(backupOwner, ["state.read", "state.write"]);
  await platform.call(backupOwner, "state.write", {
    revision: 0,
    value: saved.value,
  });
  const backup = (await platform.call(
    backupOwner,
    "state.read",
  )) as StoredState | null;
  if (
    backup?.revision !== 1 ||
    canonical(backup.value) !== canonical(saved.value)
  )
    throw Error("备份校验失败，未重置原配置。");
  const value = { ...(saved.value as Record<string, unknown>) };
  delete value.composition;
  await platform.call("host.shell", "state.write", {
    revision: saved.revision,
    value,
  });
}
