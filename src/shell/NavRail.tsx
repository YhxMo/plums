import type { ReactNode } from "react";
import { MenuIcon, PuzzleIcon } from "lucide-react";
import { motion } from "motion/react";
import type { NavRailProps } from "./controllers";
import { AppMenu, ThemeToggle } from "./ShellActions";
import { Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";
import { Separator } from "../components/ui/separator";

const railButton =
  "relative size-10 rounded-xl text-muted-foreground hover:bg-sidebar-accent aria-[current=page]:text-foreground [&_svg:not([class*='size-'])]:size-5";

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
            className="absolute inset-0 rounded-xl bg-card shadow-raised"
          />
        )}
        <span className="relative grid place-items-center">{children}</span>
      </Button>
    </Tooltip>
  );
}

/**
 * Desktop navigation: the workspaces contributed by extensions, extension
 * management, then appearance and the app menu at the foot. Phones keep
 * these in the title bar.
 */
export function NavRail({
  appearance,
  workspace,
  navigation,
  operations,
}: NavRailProps) {
  const managerOpen = navigation.manager.open;
  return (
    <nav
      aria-label="应用导航"
      className="flex w-15 shrink-0 flex-col items-center gap-1.5 pt-1 pb-3 max-md:hidden"
    >
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
          <span className="text-[15px] font-semibold">
            {[...view.label][0]}
          </span>
        </Destination>
      ))}
      <Separator className="my-1 w-6! bg-sidebar-border" />
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
