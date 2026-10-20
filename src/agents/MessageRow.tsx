import { useRef } from "react";
import { CheckIcon, CopyIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "cn";
import type { Agent, Message } from "../../modules/agents/contract";
import { Avatar } from "./Avatar";
import { Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../components/ui/context-menu";

export type MessageAction = "copy" | "resend" | "delete";

const actions: Record<MessageAction, { label: string; icon: typeof CopyIcon }> =
  {
    copy: { label: "复制", icon: CopyIcon },
    resend: { label: "重新发送", icon: RotateCcwIcon },
    delete: { label: "删除", icon: Trash2Icon },
  };

/**
 * One chat line. Desktop reads like a messenger (avatars, bubbles, hover
 * actions, a right-click menu); phones read replies as prose and keep only
 * the own turn in a bubble.
 */
export function MessageRow({
  agent,
  role,
  text,
  status,
  message,
  busy,
  copied,
  canDelete,
  pointerMenu,
  onAction,
}: {
  agent: Agent;
  role: Message["role"];
  text: string;
  /** Live region for the typing line. */
  status?: boolean;
  /** Saved messages get actions; pending and typing lines do not. */
  message?: Message;
  busy?: boolean;
  copied?: boolean;
  canDelete?: boolean;
  /** Offers the right-click menu (desktop only). */
  pointerMenu?: boolean;
  onAction?: (action: MessageAction, message: Message) => void;
}) {
  const user = role === "user";
  const row = useRef<HTMLDivElement>(null);
  const chosen = useRef(false);
  const available = (["copy", "resend", "delete"] as const).filter(
    (a) => (a !== "resend" || user) && (a !== "delete" || canDelete),
  );
  const bubble = (
    <p
      role={status ? "status" : undefined}
      className={cn(
        "m-0 min-w-0 text-[14px] leading-relaxed wrap-anywhere whitespace-pre-wrap",
        "md:max-w-[min(68%,600px)] md:rounded-xl md:px-3.5 md:py-2 md:shadow-panel",
        user
          ? "bg-subtle max-md:max-w-[85%] max-md:rounded-[18px_18px_6px_18px] max-md:px-3.5 max-md:py-2.5 max-md:text-[15px] md:rounded-tr-sm md:bg-brand-soft md:shadow-none"
          : "max-md:font-reading max-md:text-base max-md:leading-[1.7] md:rounded-tl-sm md:bg-card",
        status &&
          "flex items-center gap-2 bg-transparent! text-[13px] text-muted-foreground shadow-none! max-md:font-sans md:pl-1",
        "data-[state=open]:ring-2 data-[state=open]:ring-brand/60",
      )}
    >
      {status && (
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1.5 rounded-full bg-brand"
              animate={{ opacity: [0.25, 1, 0.25] }}
              transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
            />
          ))}
        </span>
      )}
      {text}
    </p>
  );
  return (
    <motion.div
      ref={row}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={cn(
        "group/row flex min-w-0 items-start gap-2.5",
        user && "flex-row-reverse max-md:flex-row max-md:justify-end",
        !user && "max-md:block",
      )}
    >
      <span className="flex shrink-0 max-md:hidden" aria-hidden="true">
        {user ? (
          <span className="grid size-8 place-items-center rounded-full bg-subtle text-xs font-semibold">
            你
          </span>
        ) : (
          <Avatar agent={agent} size="small" className="size-8" />
        )}
      </span>
      {!user && (
        <span
          className="mb-1 hidden text-xs font-medium text-muted-foreground max-md:block"
          aria-hidden="true"
        >
          {agent.name}
        </span>
      )}
      <span className="sr-only">{user ? "你" : agent.name}：</span>
      {message && onAction ? (
        <ContextMenu
          modal={false}
          onOpenChange={(open) => open && (chosen.current = false)}
        >
          <ContextMenuTrigger
            asChild
            disabled={!pointerMenu}
            className="select-text"
          >
            {bubble}
          </ContextMenuTrigger>
          <ContextMenuContent
            className="min-w-40"
            aria-label="消息操作"
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              // Escape returns to the message's own buttons; a chosen action
              // keeps the focus it moved.
              if (!chosen.current)
                row.current
                  ?.querySelector<HTMLElement>("[data-message-id] button")
                  ?.focus();
            }}
          >
            {available.map((action) => {
              const { label, icon: Icon } = actions[action];
              return (
                <span key={action} className="contents">
                  {action === "delete" && <ContextMenuSeparator />}
                  <ContextMenuItem
                    variant={action === "delete" ? "destructive" : "default"}
                    disabled={action !== "copy" && busy}
                    onSelect={() => {
                      chosen.current = true;
                      onAction(action, message);
                    }}
                  >
                    <Icon />
                    {label}
                  </ContextMenuItem>
                </span>
              );
            })}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        bubble
      )}
      {message && onAction && (
        <div
          className="flex gap-0.5 self-end opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-has-data-[state=open]/row:opacity-100 max-md:hidden"
          data-message-id={message.id}
        >
          {available.map((action) => {
            const { label, icon: Icon } = actions[action];
            const shown = action === "copy" && copied ? "已复制" : label;
            return (
              <Tooltip key={action} label={shown}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={shown}
                  disabled={action !== "copy" && busy}
                  onClick={() => onAction(action, message)}
                >
                  {action === "copy" && copied ? (
                    <CheckIcon className="text-running" />
                  ) : (
                    <Icon />
                  )}
                </Button>
              </Tooltip>
            );
          })}
        </div>
      )}
    </motion.div>
  );
}
