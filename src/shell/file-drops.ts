/**
 * A file dropped where no view takes it would make the WebView open that
 * file in place of the app. Drop zones call preventDefault themselves; any
 * other spot refuses the drag, so the cursor shows it and no drop follows.
 */
export function refuseStrayFileDrops(target: Window) {
  const refuse = (event: DragEvent) => {
    if (event.defaultPrevented || !event.dataTransfer?.types.includes("Files"))
      return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "none";
  };
  target.addEventListener("dragover", refuse);
  target.addEventListener("drop", refuse);
}
