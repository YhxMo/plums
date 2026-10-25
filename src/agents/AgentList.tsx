import { useId, useRef, useState } from "react";
import { EllipsisIcon, PlusIcon, SearchIcon } from "lucide-react";
import { cn } from "cn";
import type { Agent } from "@modules/agents/contract";
import { unreadReplies } from "@modules/agents/unread";
import { formatTime } from "./time";
import { summary } from "./summary";
import { Avatar } from "./Avatar";
import { AgentMenuItems, type AgentAction } from "./AgentMenu";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

/** Characters of the last message a row keeps; the rest is cut off anyway. */
const PREVIEW = 120;
/** When an Agent was last active: its latest message or new session. */
const activity = (a: Agent) =>
  Math.max(...a.sessions.map((s) => s.lastMessageAt));

/**
 * One full-width row in one of three tones: selected (brand fill, white
 * text), pinned, or plain on the list's colour.
 */
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
  const id = useId();
  const typing = !!a.pending;
  const unread = a.sessions.reduce((sum, s) => sum + unreadReplies(s), 0);
  // The dot and the badge speak through the row's description, after the
  // last message and its time.
  const state = [typing && "正在输入", unread && `${unread} 条未读`]
    .filter(Boolean)
    .join("，");
  const session = a.sessions.find((x) => x.id === a.currentSessionId);
  const lastAt = session?.messages.length
    ? (session.messages.at(-1)?.at ?? session.lastMessageAt)
    : undefined;
  const last = session?.messages.at(-1);
  const preview = ((last && summary(last)) || a.description).slice(0, PREVIEW);
  const described = [
    `${id}-preview`,
    lastAt !== undefined && `${id}-time`,
    state && `${id}-state`,
  ]
    .filter(Boolean)
    .join(" ");
  const act = (action: AgentAction) => onAction(action, more.current);
  // Secondary text on the selected row is White A11: 90% of its text colour.
  const quiet = selected
    ? "text-selection-foreground/90"
    : "text-muted-foreground";
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-agent-row
          // The status dot's ring follows the row's tone; on the brand-filled
          // selected row the typing dot takes the row's text colour.
          className={cn(
            "group/row relative flex h-[68px] shrink-0 items-center [--row-bg:var(--list-bg)]",
            a.pinned &&
              !selected &&
              "bg-row-pinned [--row-bg:var(--row-pinned)]",
            selected
              ? "bg-selection text-selection-foreground [--row-bg:var(--selection)] [--row-typing:var(--selection-text)]"
              : "after:pointer-events-none after:absolute after:inset-0 after:bg-foreground/4 after:opacity-0 after:transition-opacity hover:after:opacity-100",
          )}
          data-selected={selected}
          data-pinned={a.pinned}
        >
          <button
            data-slot="agent-row"
            className="relative flex h-full min-w-0 flex-1 items-center gap-[11px] px-3.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
            data-agent-id={a.id}
            onClick={onSelect}
            aria-labelledby={`${id}-name`}
            aria-describedby={described}
            aria-current={selected ? "true" : undefined}
          >
            <Avatar
              agent={a}
              dot={
                typing ? "typing" : a.status === "online" ? "online" : undefined
              }
              className="size-11"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-baseline justify-between gap-2">
                <strong
                  id={`${id}-name`}
                  className="truncate text-sm leading-5 font-semibold"
                >
                  {a.name}
                </strong>
                <span
                  id={`${id}-time`}
                  className={cn(
                    "min-w-7 shrink-0 text-right text-xs transition-opacity md:pointer-fine:group-hover/row:opacity-0 md:pointer-fine:group-focus-within/row:opacity-0 md:pointer-fine:group-has-aria-expanded/row:opacity-0",
                    quiet,
                  )}
                >
                  {lastAt !== undefined && formatTime(lastAt, undefined, true)}
                </span>
              </span>
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span
                  id={`${id}-preview`}
                  className={cn("truncate text-xs", quiet)}
                >
                  {preview}
                </span>
                {unread > 0 && (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "grid h-[18px] min-w-[18px] shrink-0 place-items-center rounded-full px-1.5 text-xs leading-none font-semibold tabular-nums transition-opacity md:pointer-fine:group-hover/row:opacity-0 md:pointer-fine:group-focus-within/row:opacity-0 md:pointer-fine:group-has-aria-expanded/row:opacity-0",
                      selected
                        ? "bg-selection-foreground text-selection"
                        : "bg-brand text-primary-foreground",
                    )}
                  >
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </span>
              <span id={`${id}-state`} hidden>
                {state}
              </span>
            </span>
          </button>
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button
                ref={more}
                variant="ghost"
                size="icon-sm"
                // Its own tint shows over every row tone.
                className="relative mr-1 shrink-0 text-current hover:bg-foreground/10 aria-expanded:bg-foreground/10 group-data-[selected=true]/row:hover:bg-selection-foreground/15 group-data-[selected=true]/row:hover:text-selection-foreground group-data-[selected=true]/row:aria-expanded:bg-selection-foreground/15 dark:hover:bg-foreground/10 pointer-fine:opacity-0 pointer-fine:group-hover/row:opacity-100 pointer-fine:group-focus-within/row:opacity-100 pointer-fine:aria-expanded:opacity-100 md:pointer-fine:absolute md:pointer-fine:top-1/2 md:pointer-fine:right-2 md:pointer-fine:m-0 md:pointer-fine:-translate-y-1/2"
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
        </div>
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
  onImport,
  onAction,
}: {
  agents: Agent[];
  selected: string | null;
  onSelect: (id: string) => void;
  /** Starts adding an Agent from the add menu, which `source` opened. */
  onAdd: (source: HTMLElement) => void;
  onImport: (source: HTMLElement) => void;
  onAction: (
    agent: Agent,
    action: AgentAction,
    source: HTMLElement | null,
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const add = useRef<HTMLButtonElement>(null);
  const shown = agents.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase()),
  );
  // Pinned rows first in the provider's order, then the most recently active.
  const ordered = [
    ...shown.filter((a) => a.pinned),
    ...shown.filter((a) => !a.pinned).sort((a, b) => activity(b) - activity(a)),
  ];
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-col [--list-bg:var(--chrome)] max-md:bg-chrome"
      aria-label="Agent 列表"
    >
      <div
        className="flex min-h-12 items-center gap-1.5 pr-2.5 pl-3 md:h-[52px] max-md:flex-wrap max-md:px-5 max-md:pt-4 max-md:pb-3"
        data-tauri-drag-region="deep"
      >
        <h2
          className={cn(
            "text-base font-semibold max-md:flex-1 max-md:text-xl",
            agents.length > 0 && "md:sr-only",
          )}
        >
          我的 Agent
        </h2>
        {agents.length > 0 && (
          <InputGroup className="h-[30px] flex-1 rounded-md border-transparent bg-row-pinned shadow-none max-md:order-3 max-md:h-11 max-md:basis-full dark:bg-row-pinned">
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="搜索 Agent"
              placeholder="搜索"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
        )}
        <DropdownMenu modal={false}>
          <Tooltip label="添加" side="right">
            <DropdownMenuTrigger asChild>
              <Button
                ref={add}
                variant="ghost"
                size="icon"
                className="size-[30px] rounded-md bg-row-pinned text-foreground hover:bg-subtle aria-expanded:bg-subtle max-md:order-2 max-md:size-9 max-md:bg-transparent"
                aria-label="添加"
              >
                <PlusIcon />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem onSelect={() => onAdd(add.current!)}>
              添加 Agent
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onImport(add.current!)}>
              导入角色卡…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-3 max-md:pb-5">
        {ordered.map((a) => (
          <AgentRow
            key={a.id}
            agent={a}
            selected={selected === a.id}
            onSelect={() => onSelect(a.id)}
            onAction={(action, source) => onAction(a, action, source)}
          />
        ))}
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
