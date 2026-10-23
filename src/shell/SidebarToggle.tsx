import { PanelRightIcon } from "lucide-react";
import { cn } from "cn";
import type { TitleBarProps } from "./controllers";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";

/** Opens or closes the right sidebar: the extension's own, else the built-in one. */
export function SidebarToggle({
  chrome,
  side,
  className,
}: Pick<TitleBarProps, "chrome"> & {
  side?: "bottom" | "right";
  className?: string;
}) {
  return (
    <Tooltip
      label={chrome.custom ? `切换 ${chrome.custom.label}` : "展开或收起右侧栏"}
      side={side}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="展开或收起右侧栏"
        aria-pressed={chrome.open}
        className={cn(
          "text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground",
          className,
        )}
        onClick={(event) => chrome.toggle(event.currentTarget)}
      >
        <PanelRightIcon />
      </Button>
    </Tooltip>
  );
}
