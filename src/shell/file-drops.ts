import type { WorkspaceChromeState } from "@modules/sdk";

export type WindowDrop = NonNullable<WorkspaceChromeState["drop"]>;

const hasFiles = (event: DragEvent) =>
  event.dataTransfer?.types.includes("Files") ?? false;

/**
 * A file dropped where nothing takes it would make the WebView open that
 * file in place of the app. Drop zones and the workspace call preventDefault
 * themselves; any other drag is refused, so the cursor shows it and no drop
 * follows.
 */
export function refuseStrayFileDrops(target: Window) {
  const refuse = (event: DragEvent) => {
    if (event.defaultPrevented || !hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = "none";
  };
  target.addEventListener("dragover", refuse);
  target.addEventListener("drop", refuse);
}

/**
 * Hands files dragged anywhere inside `root` to the shown workspace. A drop
 * zone of its own (such as a dialog's) takes them first; dialogs and menus
 * portalled outside `root` never pass them on. `onHover` reports the drop
 * the dragged files would get, or null once they leave or land.
 */
export function forwardFileDrops(
  root: HTMLElement,
  current: () => WindowDrop | undefined,
  onHover: (drop: WindowDrop | null) => void,
) {
  const document = root.ownerDocument;
  // Entering the next element comes before leaving the last one, so the
  // count only reaches zero once the drag leaves the window.
  let depth = 0;
  const target = (event: DragEvent) => {
    if (event.defaultPrevented || !hasFiles(event)) return undefined;
    return root.contains(event.target as Node) ? current() : undefined;
  };
  const enter = (event: DragEvent) => {
    if (hasFiles(event)) depth++;
  };
  const leave = (event: DragEvent) => {
    if (!hasFiles(event)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) onHover(null);
  };
  const over = (event: DragEvent) => {
    const drop = target(event);
    onHover(drop ?? null);
    if (!drop) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = drop.add ? "copy" : "none";
  };
  const land = (event: DragEvent) => {
    depth = 0;
    onHover(null);
    const drop = target(event);
    if (!drop?.add) return;
    event.preventDefault();
    drop.add([...event.dataTransfer!.files]);
  };
  const end = () => {
    depth = 0;
    onHover(null);
  };
  document.addEventListener("dragenter", enter);
  document.addEventListener("dragleave", leave);
  document.addEventListener("dragover", over);
  document.addEventListener("drop", land);
  document.addEventListener("dragend", end);
  return () => {
    document.removeEventListener("dragenter", enter);
    document.removeEventListener("dragleave", leave);
    document.removeEventListener("dragover", over);
    document.removeEventListener("drop", land);
    document.removeEventListener("dragend", end);
  };
}
