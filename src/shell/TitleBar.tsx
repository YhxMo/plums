import { MenuIcon, PanelRightIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";
import type { TitleBarProps } from "./controllers";
import { AppMenu, ThemeToggle } from "./ShellActions";
import { Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";

export function TitleBar({
  platformKind,
  appearance,
  workspace,
  chrome,
  navigation,
  operations,
}: TitleBarProps) {
  const managerOpen = navigation.manager.open;
  const title = managerOpen
    ? "扩展管理"
    : chrome.title ||
      (workspace.current?.chrome ? "" : workspace.current?.label || "工作空间");
  const isMacOverlay =
    platformKind === "native" && !/android/i.test(navigator.userAgent);
  return (
    <header
      className={cn(
        "sticky top-0 z-2 flex min-h-12 shrink-0 items-center justify-between gap-3 bg-chrome pr-2 pl-4 select-none max-md:min-h-14 max-md:border-b max-md:bg-surface max-md:px-4",
        isMacOverlay && "pl-[78px] max-md:pl-[78px]",
      )}
      data-tauri-drag-region
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2.5"
        data-tauri-drag-region
      >
        <div
          className="flex shrink-0 items-center gap-2"
          data-tauri-drag-region
        >
          <img
            className="size-6 rounded-md object-contain max-md:size-7.5"
            src="/brand/plums.png"
            alt=""
          />
          <strong className="text-[13px] font-semibold tracking-tight max-md:text-[17px]">
            Plums
          </strong>
        </div>
        <AnimatePresence mode="popLayout" initial={false}>
          {title && (
            <motion.span
              key={title}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.16 }}
              className="flex min-w-0 items-center gap-2.5"
              data-tauri-drag-region
            >
              <span
                aria-hidden="true"
                className="h-3.5 w-px shrink-0 bg-border"
              />
              <span className="truncate text-[13px] font-medium text-muted-foreground">
                {title}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {/* Desktop keeps these in the navigation rail. */}
        <div className="contents md:hidden">
          <ThemeToggle appearance={appearance} operations={operations} />
          <AppMenu
            workspace={workspace}
            navigation={navigation}
            icon={<MenuIcon />}
          />
        </div>
        <Tooltip
          label={
            chrome.custom ? `切换 ${chrome.custom.label}` : "展开或收起右侧栏"
          }
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="展开或收起右侧栏"
            aria-pressed={chrome.open}
            className="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            onClick={(event) => chrome.toggle(event.currentTarget)}
          >
            <PanelRightIcon />
          </Button>
        </Tooltip>
      </div>
    </header>
  );
}
