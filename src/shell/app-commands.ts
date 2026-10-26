/**
 * The commands of the native menu (`src-tauri/src/menu.rs`) and the keys the
 * browser preview gives them. A test keeps the two lists in step.
 */
export const appCommandKeys = {
  settings: ",",
  new: "n",
  find: "f",
} as const;

export type AppCommand = keyof typeof appCommandKeys;

export function isAppCommand(id: unknown): id is AppCommand {
  return typeof id === "string" && Object.hasOwn(appCommandKeys, id);
}

/** The command a key press stands for: ⌘ on a Mac, Ctrl elsewhere, nothing else held. */
export function commandOf(
  event: Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
  >,
  mac: boolean,
): AppCommand | undefined {
  if (
    event.shiftKey ||
    event.altKey ||
    (mac ? !event.metaKey || event.ctrlKey : !event.ctrlKey || event.metaKey)
  )
    return undefined;
  const key = event.key.toLowerCase();
  return (Object.keys(appCommandKeys) as AppCommand[]).find(
    (command) => appCommandKeys[command] === key,
  );
}
