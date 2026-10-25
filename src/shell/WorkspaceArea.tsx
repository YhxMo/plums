import { XIcon } from "lucide-react";
import type { WorkspaceAreaProps } from "./controllers";
import { ExtensionView } from "./ExtensionView";
import { Button } from "@/components/ui/button";

export function WorkspaceArea({
  host,
  workspace,
  chrome,
  hidden,
  children,
}: WorkspaceAreaProps) {
  const sidebar =
    !hidden && chrome.custom && chrome.open ? chrome.custom : null;
  return (
    <>
      <div
        className="min-w-0 flex-1 overflow-auto"
        data-workspace
        hidden={hidden}
        inert={hidden || undefined}
      >
        {!workspace.activeView && children}
        <div
          ref={workspace.slot}
          hidden={!workspace.activeView}
          className="h-full min-w-0 *:h-full"
        />
      </div>
      {sidebar && (
        <aside
          key={sidebar.id}
          className="flex w-68 shrink-0 flex-col overflow-hidden border-l border-border/70"
          aria-label={sidebar.label}
        >
          <header className="flex min-h-12 items-center justify-between border-b py-1.5 pr-2 pl-4">
            <h2 className="text-sm font-semibold">{sidebar.label}</h2>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="收起扩展侧栏"
              onClick={chrome.closeCustom}
            >
              <XIcon />
            </Button>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">
            <ExtensionView
              host={host}
              id={sidebar.id}
              generation={sidebar.generation}
            />
          </div>
        </aside>
      )}
    </>
  );
}
