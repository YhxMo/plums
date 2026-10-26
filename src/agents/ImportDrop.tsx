import { useRef, useState, type DragEvent, type ReactNode } from "react";

/** What the add page can read: role cards and whole-Agent files. */
const importable = /\.(png|json|plums)$/i;

const hasFiles = (event: DragEvent) =>
  event.dataTransfer.types.includes("Files");

/**
 * The Agent list's own drop zone: a role card or `.plums` file dropped here
 * starts an import, while files dropped on the conversation stay
 * attachments. It takes the drag before the shell, so the window's hint
 * gives way to this one over the list.
 */
export function ImportDrop({
  onImport,
  onRefuse,
  children,
}: {
  onImport: (file: File) => void;
  onRefuse: (message: string) => void;
  children: ReactNode;
}) {
  const [hover, setHover] = useState(false);
  // Entering a child comes before leaving its parent.
  const depth = useRef(0);
  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragEnter={(event) => {
        if (hasFiles(event)) depth.current++;
      }}
      onDragLeave={(event) => {
        if (!hasFiles(event)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setHover(false);
      }}
      onDragOver={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setHover(true);
      }}
      onDrop={(event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        depth.current = 0;
        setHover(false);
        const files = [...event.dataTransfer.files];
        if (files.length !== 1) onRefuse("一次只能导入一个文件。");
        else if (!importable.test(files[0].name))
          onRefuse("这里只能导入角色卡（PNG、JSON）或 Agent 包（.plums）。");
        else onImport(files[0]);
      }}
    >
      {children}
      {hover && (
        <div
          data-slot="import-drop"
          aria-hidden="true"
          className="pointer-events-none absolute inset-2 z-50 grid place-items-center rounded-2xl border-2 border-dashed border-brand/60 bg-chat/80 p-6 text-center text-sm text-muted-foreground"
        >
          松开以导入角色卡或 Agent
        </div>
      )}
    </div>
  );
}
