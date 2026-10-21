import { useRef, useState } from "react";
import { EllipsisIcon, PinIcon, PlusIcon, SearchIcon } from "lucide-react";
import { LayoutGroup, motion } from "motion/react";
import type { Agent } from "../../modules/agents/contract";
import { formatTime } from "./time";
import { Avatar } from "./Avatar";
import { AgentMenuItems, type AgentAction } from "./AgentMenu";
import { Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "../components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "../components/ui/context-menu";

// Rows leave at once: a removed row may hold the focus a dialog returns to.
const enter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: "easeOut" },
} as const;

function AgentRow({
  agent: a,
  selected,
  onSelect,
  onAction,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
  onAction: (action: AgentAction, source: HTMLElement | null) => void;
}) {
  const more = useRef<HTMLButtonElement>(null);
  const session = a.sessions.find((x) => x.id === a.currentSessionId);
  const lastAt = session?.messages.length
    ? (session.messages.at(-1)?.at ?? session.lastMessageAt)
    : undefined;
  const act = (action: AgentAction) => onAction(action, more.current);
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <motion.div
          layout="position"
          {...enter}
          // The status dot's ring follows the row's tint.
          className="group/row relative flex items-center rounded-lg transition-colors [--row-bg:var(--background)] hover:bg-sidebar-accent hover:[--row-bg:var(--sidebar-hover)] data-[selected=true]:[--row-bg:var(--sidebar-active)] data-[selected=true]:hover:bg-transparent data-[selected=true]:hover:[--row-bg:var(--sidebar-active)]"
          data-selected={selected}
        >
          {selected && (
            <motion.span
              layoutId="agent-row-selected"
              transition={{ type: "spring", stiffness: 520, damping: 40 }}
              className="absolute inset-0 rounded-lg bg-sidebar-primary"
            />
          )}
          <button
            data-slot="agent-row"
            className="relative flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pr-1.5 pl-2 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:pointer-fine:pr-2.5 max-md:py-3"
            data-agent-id={a.id}
            onClick={onSelect}
            aria-label={`与 ${a.name} 交互`}
          >
            <Avatar agent={a} status={a.status} className="size-9" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <span className="flex min-w-0 items-center gap-1">
                  <strong className="truncate text-[13px] font-medium max-md:text-[15px]">
                    {a.name}
                  </strong>
                  {a.pinned && (
                    <PinIcon
                      aria-label="特别关注"
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  )}
                </span>
                <span className="min-w-7 shrink-0 text-right text-[11px] text-muted-foreground transition-opacity md:pointer-fine:group-hover/row:opacity-0 md:pointer-fine:group-focus-within/row:opacity-0 md:pointer-fine:group-has-aria-expanded/row:opacity-0">
                  {lastAt !== undefined && formatTime(lastAt, undefined, true)}
                </span>
              </span>
              <span className="truncate text-xs text-muted-foreground/90 max-md:text-[13px]">
                {a.status === "busy" ? (
                  <span className="text-running">正在回复…</span>
                ) : (
                  session?.messages.at(-1)?.text || a.description
                )}
              </span>
            </span>
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={more}
                variant="ghost"
                size="icon-sm"
                // Its own tint shows over the row's hover and selected tints.
                className="relative mr-1 shrink-0 hover:bg-foreground/10 aria-expanded:bg-foreground/10 dark:hover:bg-foreground/10 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:aria-expanded:opacity-100 md:pointer-fine:absolute md:pointer-fine:top-1/2 md:pointer-fine:right-1.5 md:pointer-fine:m-0 md:pointer-fine:-translate-y-1/2"
                aria-label={`${a.name} 的操作`}
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="w-44"
              aria-label={`${a.name} 的操作菜单`}
            >
              <AgentMenuItems agent={a} kind="dropdown" onAction={act} />
            </DropdownMenuContent>
          </DropdownMenu>
        </motion.div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44" aria-label={`${a.name} 的操作菜单`}>
        <AgentMenuItems agent={a} kind="context" onAction={act} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function AgentList({
  agents,
  selected,
  onSelect,
  onAdd,
  onAction,
}: {
  agents: Agent[];
  selected: string | null;
  onSelect: (id: string) => void;
  onAdd: (source: HTMLElement) => void;
  onAction: (
    agent: Agent,
    action: AgentAction,
    source: HTMLElement | null,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = agents.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  );
  // Pinned Agents come first, as in a messenger.
  const ordered = [
    ...shown.filter((a) => a.pinned),
    ...shown.filter((a) => !a.pinned),
  ];
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col"
      aria-label="Agent 列表"
    >
      <div className="flex min-h-12 items-center gap-1.5 pr-2 pl-4 max-md:min-h-0 max-md:px-5 max-md:pt-4 max-md:pb-3">
        <h2 className="text-[15px] font-semibold tracking-tight max-md:text-lg">
          我的 Agent
        </h2>
        <Tooltip label="添加 Agent">
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto text-muted-foreground hover:text-foreground"
            aria-label="添加"
            onClick={(e) => onAdd(e.currentTarget)}
          >
            <PlusIcon />
          </Button>
        </Tooltip>
      </div>
      {agents.length > 0 && (
        <div className="px-3 pb-2 max-md:px-4">
          <InputGroup className="h-8 rounded-lg border-transparent bg-muted shadow-none transition-colors has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:bg-background has-[[data-slot=input-group-control]:focus-visible]:ring-0 max-md:h-11 dark:bg-muted">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索 Agent"
              placeholder="搜索 Agent"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3 max-md:px-3 max-md:pb-5">
        <LayoutGroup id="agent-rows">
          {ordered.map((a) => (
            <AgentRow
              key={a.id}
              agent={a}
              selected={selected === a.id}
              onSelect={() => onSelect(a.id)}
              onAction={(action, source) => onAction(a, action, source)}
            />
          ))}
        </LayoutGroup>
        {agents.length === 0 && (
          <p className="m-3 text-xs text-muted-foreground">
            添加后，Agent 会出现在这里。
          </p>
        )}
        {agents.length > 0 && !shown.length && (
          <p className="m-3 text-xs text-muted-foreground">
            没有找到 Agent。
            <Button
              variant="link"
              size="xs"
              className="px-1"
              onClick={() => setQuery("")}
            >
              清除搜索
            </Button>
          </p>
        )}
      </div>
    </aside>
  );
}
