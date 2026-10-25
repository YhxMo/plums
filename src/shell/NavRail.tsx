import { cn } from "cn";
import type { NavRailProps } from "./controllers";
import { UserAvatar } from "./UserAvatar";
import { RailButton } from "./RailButton";
import { ShellEntries } from "./ShellEntries";
import { workspaceIcon } from "./icons";
import { MaskIcon } from "@/components/MaskIcon";

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
      className={cn(
        "flex w-[68px] shrink-0 flex-col items-center border-r max-md:hidden",
        macOverlay && "bg-(--rail-glass)",
      )}
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
            className="size-11 rounded-xl"
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
        <ShellEntries navigation={navigation} place="rail" />
      </div>
    </nav>
  );
}
