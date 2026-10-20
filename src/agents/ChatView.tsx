import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpIcon,
  ChevronLeftIcon,
  InfoIcon,
  SquareIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type {
  Agent,
  AgentProviderInfo,
  Message,
} from "../../modules/agents/contract";
import { MAX_TEXT } from "../../modules/agents/store";
import { Avatar } from "./Avatar";
import { MessageRow, type MessageAction } from "./MessageRow";
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

const swap = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { duration: 0.15 },
} as const;

export function ChatView({
  agent,
  provider,
  draft,
  onDraft,
  onBack,
  onDetail,
  onSend,
  onCancel,
  onResend,
  onDeleteMessage,
  onError,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
  draft: string;
  onDraft: (value: string) => void;
  onBack: () => void;
  onDetail: (source: HTMLElement) => void;
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
  for (const m of session.messages) {
    if (m.at !== undefined && (last === undefined || m.at - last > TIME_GAP))
      lines.push(
        <p
          className="m-0 self-center rounded-full px-2.5 py-0.5 text-[11px] text-muted-foreground"
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
      <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-5 max-md:min-h-[68px] max-md:gap-2 max-md:pr-4 max-md:pl-1">
        <Button
          variant="ghost"
          size="icon"
          className="md:hidden"
          onClick={onBack}
          aria-label="返回 Agent 列表"
        >
          <ChevronLeftIcon />
        </Button>
        <Avatar agent={agent} />
        <div className="min-w-0">
          <motion.h1
            key={agent.name}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            className="truncate text-sm font-semibold max-md:font-reading max-md:text-[17px] max-md:font-medium"
          >
            {agent.name}
          </motion.h1>
          <p className="mt-px flex items-center gap-1.5 text-xs text-muted-foreground max-md:text-[11px]">
            <span
              aria-hidden="true"
              className={
                busy
                  ? "size-1.5 animate-pulse rounded-full bg-running"
                  : agent.status === "online"
                    ? "size-1.5 rounded-full bg-running"
                    : "size-1.5 rounded-full bg-muted-foreground/40"
              }
            />
            {status}
            {agent.multiSession ? ` · ${session.title}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto md:hidden"
          aria-label="查看 Agent 详情"
          onClick={(e) => onDetail(e.currentTarget)}
        >
          <InfoIcon />
        </Button>
      </header>
      <div
        className="relative flex min-h-0 flex-1 flex-col gap-3.5 overflow-auto px-[max(32px,calc((100%-880px)/2))] pt-5 pb-6 max-md:gap-[18px] max-md:px-4"
        role="log"
        aria-label="会话消息"
      >
        {agent.description && (
          <p className="m-0 max-w-[520px] self-center rounded-lg bg-surface px-3 py-1.5 text-center text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground wrap-anywhere shadow-panel max-md:bg-transparent max-md:shadow-none">
            {agent.description}
          </p>
        )}
        {!session.messages.length && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: "easeOut" }}
            className="flex min-h-48 flex-col items-center justify-center text-center"
          >
            <Avatar agent={agent} size="large" className="shadow-raised" />
            <h2 className="mt-3.5 mb-1.5 text-[17px] font-semibold tracking-tight max-md:font-reading max-md:text-[22px] max-md:font-medium">
              和 {agent.name} 开始吧
            </h2>
            <p className="max-w-sm text-[13px] leading-relaxed text-muted-foreground">
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
      <form
        className="mx-5 mt-1 mb-4 max-md:mx-3 max-md:mb-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <InputGroup className="h-auto rounded-3xl border-border bg-card shadow-raised has-disabled:bg-card has-disabled:opacity-100 dark:has-disabled:bg-overlay transition-shadow max-md:items-end max-md:rounded-[22px] dark:bg-overlay has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:shadow-float has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupTextarea
            ref={input}
            aria-label="消息"
            placeholder={`发送给 ${agent.name}…`}
            rows={1}
            maxLength={MAX_TEXT}
            value={draft}
            className="max-h-44 min-h-11 px-4.5 pt-3 pb-1 text-sm leading-relaxed [field-sizing:content] max-md:min-h-6 max-md:py-2.5 max-md:pl-3 max-md:text-base"
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
            className="justify-end self-end max-md:py-1.5"
          >
            <AnimatePresence mode="popLayout" initial={false}>
              {busy ? (
                <motion.span key="stop" {...swap}>
                  <Tooltip label={saving ? "正在保存…" : "停止处理"}>
                    <InputGroupButton
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      className="size-9 rounded-full max-md:size-10"
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
                      className="size-9 rounded-full max-md:size-10"
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
    </section>
  );
}
