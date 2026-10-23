import type { ReactNode } from "react";
import { cn } from "cn";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";

/** An icon-only destination: rail grey, selection orange when current. */
export function RailButton({
  label,
  active,
  onClick,
  side = "right",
  className,
  children,
  ...data
}: {
  label: string;
  active?: boolean;
  onClick: (source: HTMLElement) => void;
  /** Where the name shows: beside the rail, or below the title bar. */
  side?: "right" | "bottom";
  className?: string;
  children: ReactNode;
  "data-shell-entry"?: string;
}) {
  return (
    <Tooltip label={label} side={side}>
      <Button
        {...data}
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "text-rail-icon hover:bg-foreground/6 hover:text-rail-icon aria-[current=page]:text-selection dark:hover:bg-foreground/8",
          className,
        )}
        onClick={(event) => onClick(event.currentTarget)}
      >
        {children}
      </Button>
    </Tooltip>
  );
}
