import { useRef } from "react";
import {
  CheckIcon,
  CopyIcon,
  PencilIcon,
  RefreshCwIcon,
  Trash2Icon,
} from "lucide-react";
import { motion } from "motion/react";
import { cn } from "cn";
import type { Agent, Message } from "@modules/agents/contract";
import { MessageAttachments } from "./AttachmentView";
import { Markdown } from "./Markdown";
import { Tooltip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

export type MessageAction = "copy" | "edit" | "regenerate" | "delete";

const actions: Record<MessageAction, { label: string; icon: typeof CopyIcon }> =
  {
    copy: { label: "复制", icon: CopyIcon },
    edit: { label: "编辑", icon: PencilIcon },
    regenerate: { label: "重新生成", icon: RefreshCwIcon },
    delete: { label: "删除", icon: Trash2Icon },
  };

/**
 * One chat line: replies in a bubble-coloured bubble on the left, the own turn
 * in a brand-coloured bubble on the right; on desktop each saved line has
 * actions below it (on hover or focus) and a right-click menu.
 */
export function MessageRow({
  agent,
  role,
  text,
  attachments,
  message,
  busy,
  copied,
  can,
  pointerMenu,
  className,
  onAction,
  onOpenLink,
  onError,
}: {
  agent: Agent;
  role: Message["role"];
  text: string;
  /** Files and pictures shown under the text. */
  attachments?: Message["attachments"];
  /** Saved messages get actions; the pending line does not. */
  message?: Message;
  busy?: boolean;
  copied?: boolean;
  /** What the provider supports besides copying; edit applies to own lines, regenerate to replies. */
  can?: { edit?: boolean; regenerate?: boolean; delete?: boolean };
  /** Offers the right-click menu (desktop only). */
  pointerMenu?: boolean;
  /** Spacing from the line above, set by the list. */
  className?: string;
  onAction?: (action: MessageAction, message: Message) => void;
  /** Opens an https link from a reply outside the app. */
  onOpenLink: (url: string) => void;
  onError: (message: string) => void;
}) {
  const user = role === "user";
  const row = useRef<HTMLDivElement>(null);
  const chosen = useRef(false);
  const available = (["copy", "edit", "regenerate", "delete"] as const).filter(
    (a) =>
      (a === "copy" && !!text) ||
      (a === "edit" && user && can?.edit) ||
      (a === "regenerate" && !user && can?.regenerate) ||
      (a === "delete" && can?.delete),
  );
  // The own turn shows what was typed; a reply is Markdown.
  const Bubble = user ? "p" : "div";
  const bubble = (
    <Bubble
      className={cn(
        "m-0 min-w-0 wrap-anywhere",
        "max-w-[75%] rounded-[18px] px-[13px] py-2 text-sm leading-[22px] max-md:max-w-[85%] max-md:text-[15px]",
        user
          ? "rounded-br-[5px] bg-brand whitespace-pre-wrap text-primary-foreground"
          : "rounded-bl-[5px] bg-bubble text-foreground",
        "data-[state=open]:ring-2 data-[state=open]:ring-brand/50 data-[state=open]:ring-offset-2 data-[state=open]:ring-offset-chat",
      )}
    >
      {user ? (
        text
      ) : (
        <Markdown text={text} onOpenLink={onOpenLink} onError={onError} />
      )}
    </Bubble>
  );
  const files = attachments && attachments.length > 0 && (
    <MessageAttachments attachments={attachments} user={user} />
  );
  // Files sent without text stand in for the bubble, menu included.
  const content =
    text || !files ? (
      bubble
    ) : (
      <div
        className={cn(
          "flex min-w-0 flex-col",
          user ? "items-end" : "items-start",
        )}
      >
        {files}
      </div>
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
      {content === bubble && files}
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
            {content}
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
        content
      )}
      {message && onAction && (
        <div
          className={cn(
            // Hidden actions float in the gap below instead of spacing lines apart.
            "absolute top-full flex opacity-0 transition-opacity group-focus-within/row:opacity-100 group-hover/row:opacity-100 group-has-data-[state=open]/row:opacity-100 max-md:hidden",
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
