import { useEffect, useRef, useState, type DragEvent } from "react";

export function useFileDrop(onFile: (file: File) => void, disabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  useEffect(() => {
    if (disabled) {
      depth.current = 0;
      setDragging(false);
    }
  }, [disabled]);
  return {
    dragging: dragging && !disabled,
    handlers: {
      onDragEnter(event: DragEvent) {
        if (!disabled && event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          depth.current++;
          setDragging(true);
        }
      },
      onDragLeave() {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      },
      onDragOver(event: DragEvent) {
        event.preventDefault();
      },
      onDrop(event: DragEvent) {
        event.preventDefault();
        depth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (!disabled && file) onFile(file);
      },
    },
  };
}
