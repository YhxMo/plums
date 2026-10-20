import { useRef, useState } from "react";
import { EllipsisIcon, PlusIcon, SearchIcon, StarIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Agent } from "../../modules/agents/contract";
import { formatTime } from "./time";
import { Avatar } from "./Avatar";
import { AgentMenuItems, type AgentAction } from "./AgentMenu";
import { Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
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
          className="group/row relative my-0.5 flex items-center rounded-lg transition-colors hover:bg-sidebar-accent data-[selected=true]:bg-sidebar-primary data-[selected=true]:shadow-panel"
          data-selected={selected}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg py-2 pr-1.5 pl-2.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 md:pointer-fine:pr-2.5 max-md:py-2.5"
            data-agent-id={a.id}
            onClick={onSelect}
            aria-label={`与 ${a.name} 交互`}
          >
            <Avatar agent={a} />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <strong className="truncate text-[13px] font-medium max-md:text-[15px]">
                  {a.name}
                </strong>
                <span className="min-w-7 shrink-0 text-right text-[11px] text-muted-foreground transition-opacity md:pointer-fine:group-hover/row:opacity-0 md:pointer-fine:group-focus-within/row:opacity-0 md:pointer-fine:group-has-aria-expanded/row:opacity-0">
                  {lastAt !== undefined && formatTime(lastAt, undefined, true)}
                </span>
              </span>
              <span className="truncate text-xs text-muted-foreground max-md:text-[13px]">
                {session?.messages.at(-1)?.text || a.description}
              </span>
            </span>
            {a.status === "busy" && (
              <span
                className="relative ml-auto flex size-2 shrink-0"
                aria-label="运行中"
              >
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-running opacity-60 motion-reduce:hidden" />
                <span className="relative inline-flex size-2 rounded-full bg-running" />
              </span>
            )}
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={more}
                variant="ghost"
                size="icon-sm"
                className="mr-1 shrink-0 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:aria-expanded:opacity-100 md:pointer-fine:absolute md:pointer-fine:top-1.5 md:pointer-fine:right-1.5 md:pointer-fine:m-0"
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
  const pinned = shown.filter((a) => a.pinned);
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col"
      aria-label="Agent 列表"
    >
      <div className="flex items-center gap-1.5 pt-1 pr-2 pb-2 pl-3.5 max-md:px-5 max-md:pt-4 max-md:pb-3">
        <h2 className="text-[13px] font-semibold max-md:text-lg">我的 Agent</h2>
        <Badge variant="secondary" className="bg-sidebar-accent">
          {agents.length}
        </Badge>
        <Tooltip label="添加 Agent">
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            aria-label="添加"
            onClick={(e) => onAdd(e.currentTarget)}
          >
            <PlusIcon />
          </Button>
        </Tooltip>
      </div>
      {agents.length > 0 && (
        <div className="px-2.5 pb-2 max-md:px-4">
          <InputGroup className="h-8 bg-card/70 shadow-panel max-md:h-11 dark:bg-card/40">
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 max-md:px-3 max-md:pb-5">
        <AnimatePresence initial={false}>
          {pinned.length > 0 && (
            <motion.section
              {...enter}
              exit={{ opacity: 0, height: 0 }}
              key="pinned"
              className="mb-2 overflow-hidden"
            >
              <h3 className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-muted-foreground">
                特别关注
              </h3>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1">
                {pinned.map((a) => (
                  <motion.button
                    layout
                    key={a.id}
                    data-agent-id={a.id}
                    className="flex min-w-0 flex-col items-center gap-1.5 rounded-xl px-1 py-2 text-xs outline-none hover:bg-sidebar-accent focus-visible:ring-3 focus-visible:ring-ring/50 aria-pressed:bg-sidebar-primary aria-pressed:shadow-panel"
                    aria-label={`打开 ${a.name}`}
                    aria-pressed={selected === a.id}
                    onClick={() => onSelect(a.id)}
                  >
                    <span className="relative">
                      <Avatar
                        agent={a}
                        size="large"
                        className="size-11 rounded-[14px] [&_svg]:size-6"
                      />
                      <span className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full bg-brand text-primary-foreground ring-2 ring-sidebar">
                        <StarIcon className="size-2.5 fill-current" />
                      </span>
                    </span>
                    <span className="w-full truncate text-center">
                      {a.name}
                    </span>
                  </motion.button>
                ))}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
        {agents.length > 0 && (
          <h3 className="px-2 pt-1 pb-1 text-[11px] font-medium text-muted-foreground">
            全部 Agent
          </h3>
        )}
        {shown.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            selected={selected === a.id}
            onSelect={() => onSelect(a.id)}
            onAction={(action, source) => onAction(a, action, source)}
          />
        ))}
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
