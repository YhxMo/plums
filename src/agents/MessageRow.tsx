import { useRef } from "react";
import { CheckIcon, CopyIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "cn";
import type { Agent, Message } from "../../modules/agents/contract";
import { MessageAttachments } from "./AttachmentView";
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
 * One chat line: replies in a card-coloured bubble on the left, the own turn
 * in a brand-coloured bubble on the right; on desktop each saved line has actions
 * below it (on hover or focus, always for the latest reply) and a
 * right-click menu.
 */
export function MessageRow({
  agent,
  role,
  text,
  attachments,
  status,
  message,
  busy,
  copied,
  canDelete,
  pointerMenu,
  latest,
  className,
  onAction,
}: {
  agent: Agent;
  role: Message["role"];
  text: string;
  /** Files and pictures shown under the text. */
  attachments?: Message["attachments"];
  /** Live region for the typing line. */
  status?: boolean;
  /** Saved messages get actions; pending and typing lines do not. */
  message?: Message;
  busy?: boolean;
  copied?: boolean;
  canDelete?: boolean;
  /** Offers the right-click menu (desktop only). */
  pointerMenu?: boolean;
  /** The last reply keeps its actions in view. */
  latest?: boolean;
  /** Spacing from the line above, set by the list. */
  className?: string;
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
        "m-0 min-w-0 wrap-anywhere whitespace-pre-wrap",
        "max-w-[min(85%,640px)] rounded-[16px] px-3.5 py-2 text-sm leading-relaxed max-md:max-w-[85%] max-md:text-[15px]",
        user
          ? "rounded-br-[4px] bg-brand text-primary-foreground"
          : "rounded-bl-[4px] bg-card text-card-foreground",
        status && "flex items-center gap-2 text-[13px] text-muted-foreground",
        "data-[state=open]:ring-2 data-[state=open]:ring-brand/50 data-[state=open]:ring-offset-2 data-[state=open]:ring-offset-background",
      )}
    >
      {status && (
        <span aria-hidden="true" className="flex gap-1">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="size-1.5 rounded-full bg-brand"
              animate={{ opacity: [0.25, 1, 0.25], y: [0, -2, 0] }}
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
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        // The floating actions of a hovered line stay above the line below.
        "group/row relative flex min-w-0 flex-col gap-1 focus-within:z-1 hover:z-1",
        user ? "items-end" : "items-start",
        className,
      )}
    >
      <span className="sr-only">{user ? "你" : agent.name}：</span>
      {attachments && attachments.length > 0 && (
        <MessageAttachments attachments={attachments} user={user} />
      )}
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
          className={cn(
            "flex transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-has-data-[state=open]/row:opacity-100 max-md:hidden",
            // Hidden actions float in the gap below instead of spacing lines apart.
            !(latest && !user) && "absolute top-full opacity-0",
            user ? "right-0" : "left-0",
          )}
          data-message-id={message.id}
        >
          {available.map((action) => {
            const { label, icon: Icon } = actions[action];
            const shown = action === "copy" && copied ? "已复制" : label;
            return (
              <Tooltip key={action} label={shown}>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground/80 hover:text-foreground [&_svg:not([class*='size-'])]:size-3.5"
                  aria-label={shown}
                  disabled={action !== "copy" && busy}
                  onClick={() => onAction(action, message)}
                >
                  {action === "copy" && copied ? (
                    <motion.span
                      initial={{ scale: 0.4, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="grid place-items-center"
                    >
                      <CheckIcon className="text-running" />
                    </motion.span>
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
