import type { ReactNode } from "react";
import { cn } from "cn";
import { card } from "./card";
import { Button } from "@/components/ui/button";

/**
 * The card in place of a conversation. With no header of its own, a strip
 * as tall as the conversation header keeps its top dragging the window.
 */
function Pane({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  return (
    <main
      className={cn(
        "relative flex flex-1 flex-col items-center justify-center bg-chat p-7",
        className,
        card,
      )}
    >
      <div
        className="absolute inset-x-0 top-0 h-[52px] max-md:hidden"
        data-tauri-drag-region
      />
      {children}
    </main>
  );
}

export function EmptyState({
  hasAgents,
  onAdd,
  onImport,
}: {
  hasAgents: boolean;
  onAdd: (source: HTMLElement) => void;
  onImport: (source: HTMLElement) => void;
}) {
  if (hasAgents)
    return (
      <Pane className="gap-3">
        <img
          className="size-22 object-contain opacity-28 grayscale"
          src="/brand/plums.png"
          alt="Plums"
        />
        <p className="text-xs text-muted-foreground">
          从左侧选择一个 Agent 开始对话
        </p>
      </Pane>
    );
  return (
    <Pane className="gap-5 overflow-auto max-md:px-5">
      <svg
        aria-hidden="true"
        viewBox="0 0 48 48"
        className="size-12 fill-none stroke-brand stroke-[4] [stroke-linecap:round]"
      >
        <circle cx="24" cy="27" r="15" />
        <path d="M24 12c0-3 1-5 3-6.5" strokeWidth="3" />
      </svg>
      <h1 className="text-xl font-semibold">还没有 Agent</h1>
      <div className="flex gap-2 max-sm:w-full max-sm:flex-col">
        <Button onClick={(e) => onAdd(e.currentTarget)}>添加 Agent</Button>
        <Button variant="outline" onClick={(e) => onImport(e.currentTarget)}>
          导入角色卡
        </Button>
      </div>
    </Pane>
  );
}
