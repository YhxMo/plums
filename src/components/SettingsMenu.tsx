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
}: {
  onChoose: (
    action: "extensions" | "settings" | "diagnostics" | "about",
  ) => void;
  views?: { id: string; label: string }[];
  onView?: (view: { id: string; label: string }) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="应用菜单">
          <EllipsisIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        aria-label="应用菜单"
        align="end"
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
