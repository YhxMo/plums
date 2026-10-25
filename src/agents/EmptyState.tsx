import type { ReactNode } from "react";
import { ArrowRightIcon, IdCardIcon, PuzzleIcon } from "lucide-react";
import { cn } from "cn";
import { card } from "./card";
import { Button } from "@/components/ui/button";

function Start({
  icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action: string;
  onClick: (source: HTMLElement) => void;
}) {
  return (
    <button
      data-slot="start-card"
      className="group/start flex min-w-0 flex-col items-start rounded-xl border bg-card p-4.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
      onClick={(e) => onClick(e.currentTarget)}
    >
      <span className="mb-3.5 grid size-10 place-items-center rounded-xl bg-brand-soft text-brand-text [&_svg]:size-5">
        {icon}
      </span>
      <strong className="mb-1.5 text-sm font-semibold">{title}</strong>
      <span className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </span>
      <span className="mt-4 flex items-center gap-1 text-xs font-medium text-brand-text">
        {action}
        <ArrowRightIcon className="size-3.5 transition-transform group-hover/start:translate-x-0.5" />
      </span>
    </button>
  );
}

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
  onImport,
  onExtensions,
  onAdd,
}: {
  hasAgents: boolean;
  onImport: (source: HTMLElement) => void;
  onExtensions: () => void;
  onAdd: (source: HTMLElement) => void;
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
    <Pane className="overflow-auto max-md:px-5">
      <div className="text-center">
        <img
          src="/brand/plums.png"
          alt=""
          className="mx-auto mb-4 block size-12 rounded-[11px]"
        />
        <h1 className="my-2 text-xl leading-snug font-semibold">
          欢迎使用 Plums
        </h1>
        <p className="text-sm text-muted-foreground">
          添加你的第一个 Agent，
          <br className="md:hidden" />
          把角色、模型与扩展拼在一起。
        </p>
      </div>
      <div className="mt-6 grid w-full max-w-[560px] grid-cols-2 gap-3 max-sm:grid-cols-1">
        <Start
          icon={<IdCardIcon />}
          title="导入角色卡"
          description="从文件或链接，了解并添加 Agent"
          action="选择角色卡"
          onClick={onImport}
        />
        <Start
          icon={<PuzzleIcon />}
          title="安装扩展"
          description="导入本地扩展，添加新的能力"
          action="查看扩展"
          onClick={() => onExtensions()}
        />
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        也可以
        <Button
          variant="link"
          className="h-auto px-1 text-sm text-brand-text max-md:min-h-11"
          onClick={(e) => onAdd(e.currentTarget)}
        >
          从头添加 Agent
        </Button>
      </p>
    </Pane>
  );
}
