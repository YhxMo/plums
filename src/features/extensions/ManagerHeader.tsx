import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import type { ManagerHeaderController } from "./controllers";
import { Tooltip } from "../../components/Tooltip";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";

export function ManagerHeader({
  controller,
}: {
  controller: ManagerHeaderController;
}) {
  return (
    <div className="shrink-0 border-b px-6 py-3 max-[1020px]:px-4 max-md:px-4">
      <div className="mx-auto flex max-w-310 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
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
            className="text-[17px] font-semibold tracking-tight outline-none"
          >
            扩展与状态
          </h2>
          <Badge variant="secondary">{controller.count}</Badge>
        </div>
        <Button
          className="max-md:w-full"
          onClick={(event) => controller.install(event.currentTarget)}
        >
          <PlusIcon data-icon="inline-start" />
          安装扩展
        </Button>
      </div>
    </div>
  );
}
