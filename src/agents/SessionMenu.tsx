import { useState, type RefObject } from "react";
import {
  ChevronDownIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import type { Agent, Session } from "@modules/agents/contract";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** From this many sessions (more than eight) the menu gets a filter box. */
const FILTER_FROM = 9;

/**
 * The session chip in the conversation header: the current session's title,
 * opening a menu to switch, add, rename and delete sessions.
 */
export function SessionMenu({
  agent,
  session,
  trigger,
  onSession,
  onRename,
  onDelete,
}: {
  agent: Agent;
  session: Session;
  /** Dialogs opened from the menu return focus here. */
  trigger: RefObject<HTMLButtonElement | null>;
  onSession: (action: "create" | "select", id?: string) => void;
  /** Absent when the provider cannot rename sessions. */
  onRename?: (id: string, source: HTMLElement | null) => void;
  onDelete: (id: string, source: HTMLElement | null) => void;
}) {
  // A save in progress holds every session; a reply holds only its own.
  const saving = agent.status === "busy" && !agent.pending;
  const replying = agent.pending?.sessionId === session.id;
  const [query, setQuery] = useState("");
  const filtering = agent.sessions.length >= FILTER_FROM;
  const shown = agent.sessions.filter((s) =>
    s.title.toLowerCase().includes(query.trim().toLowerCase()),
  );
  return (
    // The button stays while busy so focus can return to it.
    <DropdownMenu modal={false} onOpenChange={() => setQuery("")}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost"
          size="xs"
          className="h-6 max-w-[50%] min-w-0 shrink-0 gap-0.5 rounded-sm bg-muted px-2 text-xs font-normal text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:text-foreground max-md:bg-transparent"
          aria-label={`会话：${session.title}`}
        >
          <span className="truncate">{session.title}</span>
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60" aria-label="会话">
        {filtering && (
          <label className="mb-1 flex h-8 items-center gap-1.5 rounded-md bg-muted px-2 text-muted-foreground">
            <SearchIcon className="size-3.5 shrink-0" />
            <input
              data-menu-filter
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
              placeholder="筛选会话"
              aria-label="筛选会话"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                // Letters filter here instead of jumping to a matching item;
                // Arrow Down enters the list and Escape closes the menu.
                if (e.key === "Escape" || e.key === "Tab") return;
                e.stopPropagation();
                if (e.key !== "ArrowDown") return;
                e.preventDefault();
                e.currentTarget
                  .closest("[role=menu]")
                  ?.querySelector<HTMLElement>(
                    "[role=menuitemradio]:not([data-disabled])",
                  )
                  ?.focus();
              }}
            />
          </label>
        )}
        <DropdownMenuRadioGroup
          value={session.id}
          onValueChange={(id) => onSession("select", id)}
        >
          {shown.map((s) => (
            <DropdownMenuRadioItem key={s.id} value={s.id} disabled={saving}>
              <span className="truncate">{s.title}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {!shown.length && (
          <p className="px-2 py-1.5 text-sm text-muted-foreground">
            没有找到会话
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={saving}
          onSelect={() => onSession("create")}
        >
          <PlusIcon />
          新建会话
        </DropdownMenuItem>
        {onRename && (
          <DropdownMenuItem
            disabled={saving}
            onSelect={() => onRename(session.id, trigger.current)}
          >
            <PencilIcon />
            重命名会话
          </DropdownMenuItem>
        )}
        <DropdownMenuItem
          variant="destructive"
          disabled={saving || replying}
          onSelect={() => onDelete(session.id, trigger.current)}
        >
          <Trash2Icon />
          删除此会话
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
