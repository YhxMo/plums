import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  PanelRightIcon,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useStickToBottom } from "use-stick-to-bottom";
import type {
  Agent,
  AgentModel,
  Attachment,
  Effort,
  Message,
  ModelChoice,
} from "@modules/agents/contract";
import { cn } from "cn";
import { Avatar } from "./Avatar";
import { SessionMenu } from "./SessionMenu";
import { TypingDots } from "./TypingDots";
import { card } from "./card";
import { AgentMenuItems, type AgentAction } from "./AgentMenu";
import { MessageRow, type MessageAction } from "./MessageRow";
import { Composer, type Attach, type Blocked } from "./Composer";
import { copyText } from "./clipboard";
import { formatTime, TIME_GAP } from "./time";
import { Tooltip } from "@/components/Tooltip";
import { useMediaQuery } from "@/components/useMediaQuery";
import { atLeast } from "@/components/breakpoints";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ChatView({
  agent,
  blocked,
  draft,
  onDraft,
  onBack,
  onDetail,
  onAction,
  onSession,
  onDeleteSession,
  onRenameSession,
  models,
  onModels,
  onModel,
  onEffort,
  attach,
  onSend,
  onCancel,
  onResend,
  onDeleteMessage,
  onError,
}: {
  agent: Agent;
  /** Inline recovery action; the message box stays available for drafts. */
  blocked?: Blocked;
  draft: string;
  onDraft: (value: string) => void;
  onBack: () => void;
  /** Opens the Agent's details, also when an extension holds the sidebar button. */
  onDetail: (source: HTMLElement | null) => void;
  /** The Agent's own actions, from the header's more menu. */
  onAction: (action: AgentAction, source: HTMLElement | null) => void;
  onSession: (action: "create" | "select", id?: string) => void;
  onDeleteSession: (id: string, source: HTMLElement | null) => void;
  /** Absent when the provider cannot rename sessions. */
  onRenameSession?: (id: string, source: HTMLElement | null) => void;
  /** Absent for providers without per-Agent models. */
  models?: readonly ModelChoice[];
  onModels?: () => void;
  onModel?: (model: AgentModel | null) => void;
  onEffort?: (effort: Effort | null) => void;
  /** Absent when the provider takes no attachments. */
  attach?: Attach;
  onSend: () => void;
  onCancel: () => void;
  onResend: (text: string, attachments?: Attachment[]) => void;
  /** Absent when the provider cannot delete single messages. */
  onDeleteMessage?: (id: string) => void;
  onError: (message: string) => void;
}) {
  const session = agent.sessions.find((s) => s.id === agent.currentSessionId)!;
  // A reply in another session leaves this one free.
  const busy =
    agent.status === "busy" &&
    (!agent.pending || agent.pending.sessionId === session.id);
  const desktop = useMediaQuery(atLeast("md"));
  const input = useRef<HTMLTextAreaElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const sessions = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<string>();
  const [dropping, setDropping] = useState(false);
  // The log follows new messages only while it is at the bottom.
  const motionless = useReducedMotion();
  const { scrollRef, contentRef, isAtBottom, scrollToBottom } =
    useStickToBottom({
      initial: "instant",
      resize: motionless ? "instant" : "smooth",
    });
  const pending =
    agent.pending?.sessionId === session.id ? agent.pending : undefined;
  // Another session opens at its end, and what the person sends is shown.
  useEffect(() => {
    void scrollToBottom("instant");
  }, [session.id, scrollToBottom]);
  useEffect(() => {
    if (pending) void scrollToBottom(motionless ? "instant" : "smooth");
  }, [pending, motionless, scrollToBottom]);
  // Messages seen at the bottom; a reply after them is new until reached.
  const [seen, setSeen] = useState({
    session: session.id,
    count: session.messages.length,
  });
  if (
    isAtBottom &&
    (seen.session !== session.id || seen.count !== session.messages.length)
  )
    setSeen({ session: session.id, count: session.messages.length });
  const unseen =
    seen.session === session.id &&
    session.messages.slice(seen.count).some((m) => m.role === "agent");
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  function act(action: MessageAction, message: Message) {
    if (action === "copy")
      copyText(message.text).then(
        () => setCopied(message.id),
        (error: Error) => onError(error.message),
      );
    else if (action === "resend") onResend(message.text, message.attachments);
    else {
      // The pressed button disappears with its message; keep focus nearby.
      input.current?.focus();
      onDeleteMessage?.(message.id);
    }
  }
  const lines: ReactNode[] = [];
  let last: number | undefined;
  /** Lines from one sender sit close; a change of sender or time opens a gap. */
  let previous: Message["role"] | undefined;
  const spacing = (role: Message["role"]) =>
    previous === undefined ? "" : previous === role ? "mt-1" : "mt-3";
  for (const m of session.messages) {
    if (m.at !== undefined && (last === undefined || m.at - last > TIME_GAP)) {
      lines.push(
        <p
          className="m-0 mt-3 mb-1 self-center text-[11.5px] text-muted-foreground/80 first:mt-0"
          key={`time-${m.id}`}
        >
          <time dateTime={new Date(m.at).toISOString()}>
            {formatTime(m.at)}
          </time>
        </p>,
      );
      previous = undefined;
    }
    if (m.at !== undefined) last = m.at;
    lines.push(
      <MessageRow
        key={m.id}
        agent={agent}
        role={m.role}
        text={m.text}
        attachments={m.attachments}
        message={m}
        busy={busy}
        copied={copied === m.id}
        canDelete={!!onDeleteMessage}
        pointerMenu={desktop}
        className={spacing(m.role)}
        onAction={act}
      />,
    );
    previous = m.role;
  }
  const pendingSpacing = spacing("user");
  return (
    <section
      className={cn("flex min-h-0 flex-1 flex-col bg-chat", card)}
      aria-label={`${agent.name} 的会话`}
    >
      {/* Same colour as the messages and no line under it; the shell's
          sidebar button takes the right end on desktop. */}
      <header
        className="flex h-[52px] shrink-0 items-center gap-2 pr-12 pl-5 max-md:h-14 max-md:pr-3 max-md:pl-1"
        data-tauri-drag-region="deep"
      >
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label="返回 Agent 列表"
        >
          <ChevronLeftIcon />
        </Button>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <Avatar agent={agent} className="size-9 md:hidden" />
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex min-w-0 items-center gap-2">
                <h1 className="min-w-0 shrink truncate text-[15px] leading-tight font-semibold tracking-tight">
                  {agent.name}
                </h1>
                <SessionMenu
                  agent={agent}
                  session={session}
                  trigger={sessions}
                  onSession={onSession}
                  onRename={onRenameSession}
                  onDelete={onDeleteSession}
                />
              </div>
              {/* Always present and empty when idle, so "typing" is announced
                  once as it starts; the reply itself is read from the log. */}
              <p
                role="status"
                className="flex items-center gap-1 text-[11.5px] leading-4 text-brand-text"
              >
                {pending && (
                  <>
                    <span className="sr-only">{agent.name} </span>
                    正在输入
                    <TypingDots className="mt-1" />
                  </>
                )}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
        <DropdownMenu modal={false}>
          {/* Below, so it never covers the title bar above. */}
          <Tooltip label="更多操作" side="bottom">
            <DropdownMenuTrigger asChild>
              <Button
                ref={more}
                variant="ghost"
                size="icon"
                className="text-muted-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
                aria-label="更多操作"
              >
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
          </Tooltip>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onSelect={() => onDetail(more.current)}>
              <PanelRightIcon />
              查看 Agent 详情
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <AgentMenuItems
              agent={agent}
              kind="dropdown"
              onAction={(action) => onAction(action, more.current)}
            />
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="relative flex min-h-0 flex-1 flex-col overflow-auto"
          role="log"
          aria-label="会话消息"
          onDragOver={(e) => {
            if (!attach || !e.dataTransfer.types.includes("Files")) return;
            e.preventDefault();
            setDropping(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node))
              setDropping(false);
          }}
          onDrop={(e) => {
            setDropping(false);
            if (!attach || !e.dataTransfer.files.length) return;
            e.preventDefault();
            attach.onAdd([...e.dataTransfer.files]);
          }}
        >
          {dropping && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-2 z-10 grid place-items-center rounded-2xl border-2 border-dashed border-brand/60 bg-chat/80 text-sm text-muted-foreground"
            >
              松开以添加附件
            </div>
          )}
          <div
            ref={contentRef}
            className="flex min-h-full flex-col px-[max(24px,calc((100%-600px)/2))] pt-3 pb-4 max-md:px-3.5"
          >
            {!session.messages.length && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: "easeOut" }}
                className="my-auto flex flex-col items-center gap-3 text-center"
              >
                <Avatar agent={agent} size="large" />
                <h2 className="text-lg font-semibold tracking-tight max-md:text-[22px]">
                  {agent.name}
                </h2>
                {agent.description && (
                  <p className="line-clamp-4 max-w-md text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground wrap-anywhere">
                    {agent.description}
                  </p>
                )}
              </motion.div>
            )}
            <AnimatePresence initial={false}>{lines}</AnimatePresence>
            {/* The pending turn gives way to the saved one at once; the reply
            arrives whole, with no placeholder before it. */}
            {pending && (
              <MessageRow
                key="pending"
                agent={agent}
                role="user"
                className={pendingSpacing}
                text={pending.text}
                attachments={pending.attachments}
              />
            )}
          </div>
        </div>
        <AnimatePresence>
          {!isAtBottom && (
            <motion.div
              key="back"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-3 left-1/2 -translate-x-1/2"
            >
              <Button
                variant="outline"
                size={unseen ? "sm" : "icon-sm"}
                className={cn(
                  // Solid in both themes: it floats over bubbles.
                  "rounded-full bg-popover shadow-float hover:bg-muted dark:bg-popover dark:hover:bg-muted",
                  unseen && "text-brand-text",
                )}
                aria-label={unseen ? "新消息，回到最新" : "回到最新"}
                onClick={() =>
                  void scrollToBottom(motionless ? "instant" : "smooth")
                }
              >
                <ArrowDownIcon />
                {unseen && "新消息"}
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <Composer
        agent={agent}
        blocked={blocked}
        draft={draft}
        onDraft={onDraft}
        onSend={onSend}
        onCancel={onCancel}
        models={models}
        onModels={onModels}
        onModel={onModel}
        onEffort={onEffort}
        attach={attach}
        inputRef={input}
      />
    </section>
  );
}
