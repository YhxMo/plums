import type { ReactNode } from "react";
import { MoonIcon, PanelRightIcon, SunIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";
import type { NavRailProps, TitleBarProps } from "./controllers";
import type { Workspace } from "./useWorkspace";
import type { ShellNavigation } from "./useShellNavigation";
import { SettingsMenu } from "@/components/SettingsMenu";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";

type Side = "bottom" | "right";

/** Light/dark switch, shown in the rail on desktop and the title bar on phones. */
export function ThemeToggle({
  appearance,
  operations,
  side,
  className,
}: Pick<NavRailProps, "appearance" | "operations"> & {
  side?: Side;
  className?: string;
}) {
  const light = appearance.appearance === "light";
  const label = light ? "切换到深色模式" : "切换到浅色模式";
  return (
    <Tooltip label={label} side={side}>
      <Button
        variant="ghost"
        size="icon"
        className={className}
        aria-label={label}
        disabled={operations.busy}
        onClick={() => void operations.operate(appearance.toggleTheme)}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={light ? "moon" : "sun"}
            initial={{ opacity: 0, rotate: -60, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 60, scale: 0.6 }}
            transition={{ duration: 0.18 }}
            className="grid place-items-center"
          >
            {light ? <MoonIcon /> : <SunIcon />}
          </motion.span>
        </AnimatePresence>
      </Button>
    </Tooltip>
  );
}

/** Opens or closes the right sidebar: the extension's own, else the built-in one. */
export function SidebarToggle({
  chrome,
  side,
  className,
}: Pick<TitleBarProps, "chrome"> & { side?: Side; className?: string }) {
  return (
    <Tooltip
      label={chrome.custom ? `切换 ${chrome.custom.label}` : "展开或收起右侧栏"}
      side={side}
    >
      <Button
        variant="ghost"
        size="icon"
        aria-label="展开或收起右侧栏"
        aria-pressed={chrome.open}
        className={cn(
          "text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground",
          className,
        )}
        onClick={(event) => chrome.toggle(event.currentTarget)}
      >
        <PanelRightIcon />
      </Button>
    </Tooltip>
  );
}

/** The app menu: extension management, dialog views, settings and about. */
export function AppMenu({
  workspace,
  navigation,
  side,
  icon,
  className,
}: {
  workspace: Pick<Workspace, "allViews">;
  navigation: Pick<ShellNavigation, "setDialog" | "openManager">;
  side?: Side;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <SettingsMenu
      side={side}
      icon={icon}
      className={className}
      views={workspace.allViews.filter(
        (view) => view.presentation === "dialog",
      )}
      onView={navigation.setDialog}
      onChoose={(action) => {
        if (action === "extensions" || action === "diagnostics") {
          navigation.openManager(action === "diagnostics");
        } else navigation.setDialog(action);
      }}
    />
  );
}
