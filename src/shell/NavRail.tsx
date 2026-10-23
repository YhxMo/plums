import type { ReactNode } from "react";
import { cn } from "cn";
import type { NavRailProps } from "./controllers";
import { UserAvatar } from "./UserAvatar";
import { extensionsIcon, settingsIcon, workspaceIcon } from "./icons";
import { MaskIcon } from "@/components/MaskIcon";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";

/** One rail destination: an icon in rail grey, selection orange when current. */
export function RailButton({
  label,
  active,
  onClick,
  children,
  className,
}: {
  label: string;
  active?: boolean;
  onClick: (source: HTMLElement) => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Tooltip label={label} side="right">
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={cn(
          "size-11 rounded-xl text-rail-icon hover:bg-foreground/6 hover:text-rail-icon aria-[current=page]:text-selection dark:hover:bg-foreground/8",
          className,
        )}
        onClick={(event) => onClick(event.currentTarget)}
      >
        {children}
      </Button>
    </Tooltip>
  );
}

/**
 * Desktop navigation, full window height: the user, the workspaces
 * extensions contribute, then extension management with settings right
 * below it at the foot. On a Mac the window controls sit in its top strip,
 * which also drags the window. Phones keep the last two in the title bar.
 */
export function NavRail({
  macOverlay,
  workspace,
  navigation,
  operations,
}: NavRailProps) {
  const managerOpen = navigation.manager.open;
  return (
    <nav
      aria-label="应用导航"
      className="flex w-[68px] shrink-0 flex-col items-center border-r max-md:hidden"
      data-tauri-drag-region
    >
      <div
        className={cn("w-full shrink-0", macOverlay ? "h-11" : "h-2")}
        data-tauri-drag-region
      />
      <div className="mt-1.5">
        <UserAvatar />
      </div>
      <div className="mt-5 flex flex-col gap-2">
        {workspace.views.map((view) => (
          <RailButton
            key={view.id}
            label={view.label}
            active={!managerOpen && view.id === workspace.activeView}
            onClick={() => {
              if (managerOpen) navigation.closeManager();
              if (view.id !== workspace.activeView)
                void operations.operate(() => workspace.selectLayout(view.id));
            }}
          >
            {view.icon ? (
              <MaskIcon svg={view.icon} name="view" />
            ) : (
              <MaskIcon svg={workspaceIcon} name="workspace" />
            )}
          </RailButton>
        ))}
      </div>
      <div className="mt-auto mb-3.5 flex flex-col gap-2">
        <RailButton
          label="扩展"
          active={managerOpen}
          onClick={() =>
            managerOpen ? navigation.closeManager() : navigation.openManager()
          }
        >
          <MaskIcon svg={extensionsIcon} name="extensions" />
        </RailButton>
        <RailButton
          label="设置"
          onClick={(source) => navigation.setDialog("settings", source)}
        >
          <MaskIcon svg={settingsIcon} name="settings" />
        </RailButton>
      </div>
    </nav>
  );
}
