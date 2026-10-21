import type { ReactNode } from "react";
import {
  Code2Icon,
  EllipsisIcon,
  IdCardIcon,
  InfoIcon,
  PuzzleIcon,
  SettingsIcon,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export function SettingsMenu({
  onChoose,
  views = [],
  onView,
  side = "bottom",
  icon = <EllipsisIcon />,
  className,
}: {
  onChoose: (
    action: "extensions" | "settings" | "diagnostics" | "about",
  ) => void;
  views?: { id: string; label: string }[];
  onView?: (view: { id: string; label: string }) => void;
  /** Where the menu opens: below a title bar, or beside a rail. */
  side?: "bottom" | "right";
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          aria-label="应用菜单"
        >
          {icon}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="应用菜单"
        side={side}
        align="end"
        sideOffset={side === "right" ? 8 : 4}
        className="min-w-48"
      >
        <DropdownMenuItem onSelect={() => onChoose("extensions")}>
          <PuzzleIcon />
          扩展管理
        </DropdownMenuItem>
        {views.map((view) => (
          <DropdownMenuItem key={view.id} onSelect={() => onView?.(view)}>
            <IdCardIcon />
            {view.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onChoose("settings")}>
          <SettingsIcon />
          应用设置
        </DropdownMenuItem>
        {import.meta.env.DEV && (
          <DropdownMenuItem onSelect={() => onChoose("diagnostics")}>
            <Code2Icon />
            诊断工具
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => onChoose("about")}>
          <InfoIcon />
          关于 Plums
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
