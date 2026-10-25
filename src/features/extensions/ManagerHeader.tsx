import { ArrowLeftIcon } from "lucide-react";
import type { ManagerHeaderController } from "./controllers";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";

export function ManagerHeader({
  controller,
}: {
  controller: ManagerHeaderController;
}) {
  return (
    <div
      className="flex h-14 shrink-0 items-center gap-2 border-b pr-4 pl-3"
      data-tauri-drag-region="deep"
    >
      <Tooltip label={controller.backLabel}>
        <Button
          variant="ghost"
          size="icon"
          aria-label={controller.backLabel}
          onClick={controller.close}
        >
          <ArrowLeftIcon />
        </Button>
      </Tooltip>
      <h2
        ref={controller.heading}
        tabIndex={-1}
        className="text-base font-semibold outline-none"
      >
        扩展
      </h2>
      <span className="text-xs text-muted-foreground">
        {controller.count} 个
      </span>
      <Button
        className="ml-auto"
        onClick={(event) => controller.install(event.currentTarget)}
      >
        安装扩展
      </Button>
    </div>
  );
}
