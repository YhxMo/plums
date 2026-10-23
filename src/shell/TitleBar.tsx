import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";
import type { TitleBarProps } from "./controllers";
import { SidebarToggle } from "./SidebarToggle";
import { ShellEntries } from "./ShellEntries";

/**
 * The phone's top bar. Desktop has none: the rail starts at the window's
 * top edge and each pane carries its own header. A workspace that sets a
 * title of its own still gets a slim line for it there.
 */
export function TitleBar({ workspace, chrome, navigation }: TitleBarProps) {
  const managerOpen = navigation.manager.open;
  const title = managerOpen
    ? "扩展管理"
    : chrome.title ||
      (workspace.current?.chrome ? "" : workspace.current?.label || "工作空间");
  const desktopTitle = !managerOpen && chrome.title;
  return (
    <header
      className={cn(
        "sticky top-0 z-2 flex min-h-12 shrink-0 items-center justify-between gap-3 bg-chrome pr-2 pl-4 md:pr-14 select-none max-md:min-h-14 max-md:px-4",
        desktopTitle ? "md:bg-chat" : "md:hidden",
      )}
      data-tauri-drag-region="deep"
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-2.5"
        data-tauri-drag-region
      >
        <div
          className="flex shrink-0 items-center gap-2 md:hidden"
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
                className="h-3.5 w-px shrink-0 bg-border md:hidden"
              />
              <span className="truncate text-[13px] font-medium text-muted-foreground">
                {title}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 md:hidden">
        <ShellEntries navigation={navigation} place="bar" />
        {!managerOpen && <SidebarToggle chrome={chrome} />}
      </div>
    </header>
  );
}
