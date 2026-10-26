import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "cn";
import { forwardFileDrops, type WindowDrop } from "./file-drops";

/**
 * Files dragged anywhere in the shell go to the shown workspace's `drop`;
 * while they hover, one hint says what a drop would do. It covers the area
 * the workspace marked with `data-drop-area` under the pointer, else the
 * window.
 */
export function WindowDropHint({
  root,
  drop,
}: {
  root: RefObject<HTMLElement | null>;
  drop: WindowDrop | undefined;
}) {
  const [hover, setHover] = useState<{
    drop: WindowDrop;
    area?: DOMRect;
  } | null>(null);
  const current = useRef(drop);
  current.current = drop;
  useEffect(
    () =>
      forwardFileDrops(
        root.current!,
        () => current.current,
        (drop, area) => {
          const rect = area?.getBoundingClientRect();
          // dragover repeats while the pointer moves; keep the same hint.
          setHover((last) =>
            !drop
              ? null
              : last?.drop === drop && same(last.area, rect)
                ? last
                : { drop, area: rect },
          );
        },
      ),
    [root],
  );
  if (!hover) return null;
  const { area } = hover;
  return (
    <div
      data-slot="window-drop"
      aria-hidden="true"
      style={
        area && {
          top: area.top,
          left: area.left,
          width: area.width,
          height: area.height,
        }
      }
      className={cn(
        "pointer-events-none fixed z-50 grid place-items-center rounded-2xl border-2 border-dashed bg-chat/80 p-6 text-center text-sm",
        !area && "inset-2",
        hover.drop.add
          ? "border-brand/60 text-muted-foreground"
          : "border-border text-muted-foreground/80",
      )}
    >
      {hover.drop.label}
    </div>
  );
}

const same = (a?: DOMRect, b?: DOMRect) =>
  a === b ||
  (!!a &&
    !!b &&
    a.top === b.top &&
    a.left === b.left &&
    a.width === b.width &&
    a.height === b.height);
