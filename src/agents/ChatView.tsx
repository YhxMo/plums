import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  EllipsisIcon,
  PanelRightIcon,
  SquareIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "cn";
import type {
  Agent,
  AgentModel,
  AgentProviderInfo,
  Message,
  ModelChoice,
} from "../../modules/agents/contract";
import { MAX_TEXT } from "../../modules/agents/store";
import { Avatar } from "./Avatar";
import { AgentMenuItems, type AgentAction } from "./AgentMenu";
import { MessageRow, type MessageAction } from "./MessageRow";
import { ModelSelect } from "./ModelSelect";
import { copyText } from "./clipboard";
import { formatTime, TIME_GAP } from "./time";
import { Tooltip } from "../components/Tooltip";
import { useMediaQuery } from "../components/useMediaQuery";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../components/ui/input-group";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";

const swap = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { duration: 0.15 },
} as const;

export function ChatView({
  agent,
  provider,
  closed,
  draft,
  onDraft,
  onBack,
  onDetail,
  onAction,
  models,
  onModel,
  onSend,
  onCancel,
  onResend,
  onDeleteMessage,
  onError,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
  /** This interface, switched off for the Agent: no new messages here. */
  closed?: { label: string; onOpen: () => void };
  draft: string;
  onDraft: (value: string) => void;
  onBack: () => void;
  /** Opens the Agent's details, also when an extension holds the sidebar button. */
  onDetail: (source: HTMLElement | null) => void;
  /** The Agent's own actions, from the header's more menu. */
  onAction: (action: AgentAction, source: HTMLElement | null) => void;
  /** Absent for providers without per-Agent models. */
  models?: readonly ModelChoice[];
  onModel?: (model: AgentModel | null) => void;
  onSend: () => void;
  onCancel: () => void;
  onResend: (text: string) => void;
  /** Absent when the provider cannot delete single messages. */
  onDeleteMessage?: (id: string) => void;
  onError: (message: string) => void;
}) {
  const session = agent.sessions.find((s) => s.id === agent.currentSessionId)!;
  const busy = agent.status === "busy";
  const desktop = useMediaQuery("(min-width: 768px)");
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState<string>();
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [session.id, session.messages.length, agent.status, agent.pending]);
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
    else if (action === "resend") onResend(message.text);
    else {
      // The pressed button disappears with its message; keep focus nearby.
      input.current?.focus();
      onDeleteMessage?.(message.id);
    }
  }
  const lines: ReactNode[] = [];
  let last: number | undefined;
  const latestReply = session.messages
    .filter((m) => m.role !== "user")
    .at(-1)?.id;
  for (const m of session.messages) {
    if (m.at !== undefined && (last === undefined || m.at - last > TIME_GAP))
      lines.push(
        <p
          className="m-0 flex items-center gap-3 self-stretch text-[11px] text-muted-foreground before:h-px before:flex-1 before:bg-border/70 after:h-px after:flex-1 after:bg-border/70"
          key={`time-${m.id}`}
        >
          <time dateTime={new Date(m.at).toISOString()}>
            {formatTime(m.at)}
          </time>
        </p>,
      );
    if (m.at !== undefined) last = m.at;
    lines.push(
      <MessageRow
        key={m.id}
        agent={agent}
        role={m.role}
        text={m.text}
        message={m}
        busy={busy}
        copied={copied === m.id}
        canDelete={!!onDeleteMessage}
        pointerMenu={desktop}
        latest={m.id === latestReply && !busy}
        onAction={act}
      />,
    );
  }
  const saving = agent.canCancel === false;
  const status = busy
    ? "正在处理…"
    : agent.status === "online"
      ? "在线"
      : "空闲";
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={`${agent.name} 的会话`}
    >
      <header className="flex min-h-12 shrink-0 items-center gap-2.5 border-b border-border/60 pr-2.5 pl-4 max-md:min-h-[60px] max-md:gap-2 max-md:pr-3 max-md:pl-1">
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
            className="flex min-w-0 flex-1 items-center gap-2.5"
          >
            <Avatar agent={agent} className="md:hidden" />
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="min-w-0 truncate text-[15px] font-semibold tracking-tight max-md:font-reading max-md:text-[17px] max-md:font-medium">
                {agent.name}
              </h1>
              <span
                className={cn(
                  "flex shrink-0 items-center gap-1 text-xs",
                  busy || agent.status === "online"
                    ? "text-running"
                    : "text-muted-foreground",
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 self-center rounded-full",
                    busy || agent.status === "online"
                      ? "bg-running"
                      : "bg-muted-foreground/40",
                    busy && "animate-pulse",
                  )}
                />
                {status}
              </span>
              {agent.multiSession && (
                <span className="min-w-0 shrink-[4] truncate text-xs text-muted-foreground">
                  · {session.title}
                </span>
              )}
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
                size="icon-sm"
                className="ml-auto text-muted-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
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
      <div
        className="relative flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-[max(24px,calc((100%-720px)/2))] pt-5 pb-6 max-md:gap-[18px] max-md:px-4"
        role="log"
        aria-label="会话消息"
      >
        {agent.description && (
          <p className="m-0 max-w-[520px] self-center rounded-full bg-surface px-3 py-1 text-center text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground wrap-anywhere ring-1 ring-border/60 max-md:bg-transparent max-md:ring-0">
            {agent.description}
          </p>
        )}
        {!session.messages.length && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex min-h-40 flex-col items-center justify-center text-center"
          >
            <motion.span
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
            >
              <Avatar
                agent={agent}
                className="size-12 shadow-raised [&_svg]:size-6"
              />
            </motion.span>
            <h2 className="mt-3 mb-1 text-[15px] font-semibold tracking-tight max-md:font-reading max-md:text-[22px] max-md:font-medium">
              和 {agent.name} 开始吧
            </h2>
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              {provider.description}
            </p>
          </motion.div>
        )}
        <AnimatePresence initial={false}>{lines}</AnimatePresence>
        {/* The pending turn and the typing line give way to the saved ones at once. */}
        {agent.pending?.sessionId === session.id && (
          <MessageRow
            key="pending"
            agent={agent}
            role="user"
            text={agent.pending.text}
          />
        )}
        {busy && (
          <MessageRow
            key="typing"
            agent={agent}
            role="agent"
            status
            text={`${agent.name} 正在回复…`}
          />
        )}
        <div ref={bottom} />
      </div>
      {closed ? (
        <div className="mx-auto mt-1 mb-3 flex w-[calc(100%-32px)] max-w-[760px] items-center gap-3 rounded-2xl bg-card px-4 py-3 text-[13px] shadow-raised max-md:mb-3 max-md:w-[calc(100%-24px)] dark:bg-overlay">
          <p className="min-w-0 flex-1 text-muted-foreground">
            此 Agent 已关闭「{closed.label}」，开启后才能在这里对话。
          </p>
          <Button size="sm" onClick={closed.onOpen}>
            开启
          </Button>
        </div>
      ) : (
        <form
          className="mx-auto mt-1 mb-3 w-[calc(100%-32px)] max-w-[760px] max-md:mb-3 max-md:w-[calc(100%-24px)]"
          onSubmit={(e) => {
            e.preventDefault();
            onSend();
          }}
        >
          <InputGroup className="h-auto rounded-2xl border-border bg-card shadow-raised transition-shadow duration-200 has-disabled:bg-card has-disabled:opacity-100 max-md:items-end dark:bg-overlay dark:has-disabled:bg-overlay has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:shadow-float has-[[data-slot=input-group-control]:focus-visible]:ring-0">
            <InputGroupTextarea
              ref={input}
              aria-label="消息"
              placeholder={`发送给 ${agent.name}…`}
              rows={1}
              maxLength={MAX_TEXT}
              value={draft}
              className="max-h-52 min-h-11 px-3.5 pt-3 pb-1 text-sm leading-relaxed [field-sizing:content] max-md:min-h-6 max-md:py-2.5 max-md:pl-3 max-md:text-base"
              onChange={(e) => onDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  desktop
                ) {
                  e.preventDefault();
                  if (draft.trim() && !busy) onSend();
                }
              }}
            />
            <InputGroupAddon
              align={desktop ? "block-end" : "inline-end"}
              className="cursor-default justify-end gap-1 self-end px-2 pb-2 max-md:px-2 max-md:py-1.5"
            >
              {desktop && models && onModel && (
                <span className="mr-auto min-w-0">
                  <ModelSelect
                    compact
                    label="切换模型"
                    models={models}
                    value={agent.model}
                    disabled={busy}
                    onChange={onModel}
                  />
                </span>
              )}
              <AnimatePresence mode="popLayout" initial={false}>
                {busy ? (
                  <motion.span key="stop" {...swap}>
                    <Tooltip label={saving ? "正在保存…" : "停止处理"}>
                      <InputGroupButton
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="size-8 rounded-full max-md:size-10"
                        aria-label={saving ? "正在保存…" : "停止处理"}
                        onClick={onCancel}
                        disabled={saving}
                      >
                        <SquareIcon className="fill-current" />
                      </InputGroupButton>
                    </Tooltip>
                  </motion.span>
                ) : (
                  <motion.span key="send" {...swap}>
                    <Tooltip label="发送">
                      <InputGroupButton
                        type="submit"
                        variant="default"
                        size="icon-sm"
                        className="size-8 rounded-full max-md:size-10"
                        aria-label="发送"
                        disabled={!draft.trim()}
                      >
                        <ArrowUpIcon />
                      </InputGroupButton>
                    </Tooltip>
                  </motion.span>
                )}
              </AnimatePresence>
            </InputGroupAddon>
          </InputGroup>
        </form>
      )}
    </section>
  );
}
