import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "cn";
import { forwardFileDrops, type WindowDrop } from "./file-drops";

/**
 * Files dragged anywhere in the shell go to the shown workspace's `drop`;
 * while they hover, one hint over the window says what a drop would do.
 */
export function WindowDropHint({
  root,
  drop,
}: {
  root: RefObject<HTMLElement | null>;
  drop: WindowDrop | undefined;
}) {
  const [hover, setHover] = useState<WindowDrop | null>(null);
  const current = useRef(drop);
  current.current = drop;
  useEffect(
    () => forwardFileDrops(root.current!, () => current.current, setHover),
    [root],
  );
  if (!hover) return null;
  return (
    <div
      data-slot="window-drop"
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-2 z-50 grid place-items-center rounded-2xl border-2 border-dashed bg-chat/80 p-6 text-center text-sm",
        hover.add
          ? "border-brand/60 text-muted-foreground"
          : "border-border text-muted-foreground/80",
      )}
    >
      {hover.label}
    </div>
  );
}
