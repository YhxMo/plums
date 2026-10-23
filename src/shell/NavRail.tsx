import type { ReactNode } from "react";
import { MenuIcon, PuzzleIcon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "cn";
import type { NavRailProps } from "./controllers";
import { AppMenu, ThemeToggle } from "./ShellActions";
import { Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";

const railButton =
  "relative size-9 rounded-xl text-muted-foreground hover:bg-foreground/6 aria-[current=page]:text-brand-text [&_svg:not([class*='size-'])]:size-[18px]";

/** One rail destination; the active one carries the sliding marker. */
function Destination({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip label={label} side="right">
      <Button
        variant="ghost"
        size="icon"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        className={railButton}
        onClick={onClick}
      >
        {active && (
          <motion.span
            layoutId="rail-active"
            transition={{ type: "spring", stiffness: 520, damping: 38 }}
            className="absolute inset-0 rounded-xl bg-background shadow-panel"
          />
        )}
        <span className="relative grid place-items-center">{children}</span>
      </Button>
    </Tooltip>
  );
}

/**
 * Desktop navigation, full window height: the workspaces contributed by
 * extensions, extension management, then appearance and
 * the app menu at the foot. On a Mac the window controls sit in its top
 * strip, which also drags the window. Phones keep these in the title bar.
 */
export function NavRail({
  macOverlay,
  appearance,
  workspace,
  navigation,
  operations,
}: NavRailProps) {
  const managerOpen = navigation.manager.open;
  return (
    <nav
      aria-label="应用导航"
      className="flex w-16 shrink-0 flex-col items-center gap-1 pb-2 max-md:hidden"
      data-tauri-drag-region
    >
      <div
        className={cn("w-full shrink-0", macOverlay ? "h-11" : "h-2")}
        data-tauri-drag-region
      />
      <img
        className="mb-2 size-7 shrink-0 rounded-lg object-contain"
        src="/brand/plums.png"
        alt=""
      />
      {workspace.views.map((view) => (
        <Destination
          key={view.id}
          label={view.label}
          active={!managerOpen && view.id === workspace.activeView}
          onClick={() => {
            if (managerOpen) navigation.closeManager();
            if (view.id !== workspace.activeView)
              void operations.operate(() => workspace.selectLayout(view.id));
          }}
        >
          {/* Views carry no icon in their contract; their initial stands in. */}
          <span className="text-sm font-semibold">{[...view.label][0]}</span>
        </Destination>
      ))}
      <Separator className="my-1 w-5! bg-sidebar-border" />
      <Destination
        label="扩展管理"
        active={managerOpen}
        onClick={() =>
          managerOpen ? navigation.closeManager() : navigation.openManager()
        }
      >
        <PuzzleIcon />
      </Destination>
      <div className="mt-auto flex flex-col items-center gap-1">
        <ThemeToggle
          appearance={appearance}
          operations={operations}
          side="right"
          className={railButton}
        />
        <AppMenu
          workspace={workspace}
          navigation={navigation}
          side="right"
          icon={<MenuIcon />}
          className={railButton}
        />
      </div>
    </nav>
  );
}
