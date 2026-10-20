import type { ReactNode } from "react";
import { ChevronRightIcon, FlaskConicalIcon } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";

export function DiagnosticsPanel({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle(open: boolean): void;
  children: ReactNode;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onToggle}
      className="rounded-xl bg-card shadow-panel"
    >
      <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-4 py-3 text-left text-[13px] font-semibold outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <FlaskConicalIcon className="size-4 text-muted-foreground" />
        诊断与实验
        <ChevronRightIcon className="ml-auto size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
      </CollapsibleTrigger>
      <CollapsibleContent className="grid gap-2.5 border-t px-4 pt-3 pb-4">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
