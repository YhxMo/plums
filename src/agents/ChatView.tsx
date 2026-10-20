import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  Agent,
  AgentProviderInfo,
  Message,
} from "../../modules/agents/contract";
import { MAX_TEXT } from "../../modules/agents/store";
import { Avatar } from "./AgentList";
import { Icon } from "../components/Icon";
import { MessageRow, type MessageAction } from "./MessageRow";
import { MessageMenu } from "./MessageMenu";
import { copyText } from "./clipboard";
import { formatTime, TIME_GAP } from "./time";
import s from "./ChatView.module.css";
import { Tooltip } from "../components/Tooltip";
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
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number }>();
  const [copied, setCopied] = useState<string>();
  // Grow with the draft up to the CSS max-height, then scroll.
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [draft]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [session.id, session.messages.length, agent.status, agent.pending]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(undefined), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  const closeMenu = useCallback(
    (restore: boolean) => {
      if (restore && menu)
        document
          .querySelector<HTMLElement>(
            `[data-message-id="${CSS.escape(menu.id)}"] button`,
          )
          ?.focus();
      setMenu(undefined);
    },
    [menu],
  );
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
        <p className={s.timeDivider} key={`time-${m.id}`}>
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
        menuOpen={menu?.id === m.id}
        canDelete={!!onDeleteMessage}
        onAction={act}
        onMenu={(message, x, y) => setMenu({ id: message.id, x, y })}
      />,
    );
  }
  const menuMessage = menu && session.messages.find((m) => m.id === menu.id);
  const saving = agent.canCancel === false;
  return (
    <section className={s.chat} aria-label={`${agent.name} 的会话`}>
      <header className={s.chatHeader}>
        <button
          className={`icon-button ${s.mobileOnly}`}
          onClick={onBack}
          aria-label="返回 Agent 列表"
        >
          <Icon name="back" />
        </button>
        <Avatar agent={agent} />
        <div>
          <h1>{agent.name}</h1>
          <p>
            {busy ? "正在处理…" : agent.status === "online" ? "在线" : "空闲"}
            {agent.multiSession ? ` · ${session.title}` : ""}
          </p>
        </div>
        <button
          className={`icon-button ${s.detailButton} ${s.mobileOnly}`}
          aria-label="查看 Agent 详情"
          onClick={(e) => onDetail(e.currentTarget)}
        >
          <Icon name="info" />
        </button>
      </header>
      <div className={s.messages} role="log" aria-label="会话消息">
        {agent.description && (
          <p className={s.conversationIntro}>{agent.description}</p>
        )}
        {!session.messages.length && (
          <div className={s.chatWelcome}>
            <Avatar agent={agent} size="large" />
            <h2>和 {agent.name} 开始吧</h2>
            <p>{provider.description}</p>
          </div>
        )}
        {lines}
        {agent.pending?.sessionId === session.id && (
          <MessageRow agent={agent} role="user" text={agent.pending.text} />
        )}
        {busy && (
          <MessageRow
            agent={agent}
            role="agent"
            status
            text={`${agent.name} 正在回复…`}
          />
        )}
        <div ref={bottom} />
      </div>
      {menu && menuMessage && (
        <MessageMenu
          message={menuMessage}
          x={menu.x}
          y={menu.y}
          busy={busy}
          canDelete={!!onDeleteMessage}
          onAction={act}
          onClose={closeMenu}
        />
      )}
      <form
        className={s.composer}
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <label className="sr-only" htmlFor="message-input">
          消息
        </label>
        <textarea
          ref={input}
          id="message-input"
          aria-label="消息"
          placeholder={`发送给 ${agent.name}…`}
          rows={1}
          maxLength={MAX_TEXT}
          value={draft}
          onChange={(e) => onDraft(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              window.matchMedia("(min-width: 768px)").matches
            ) {
              e.preventDefault();
              if (draft.trim() && !busy) onSend();
            }
          }}
        />
        <div className={s.composerBottom}>
          {busy ? (
            <Tooltip label={saving ? "正在保存…" : "停止处理"}>
              <button
                type="button"
                className={`secondary ${s.composerButton}`}
                aria-label={saving ? "正在保存…" : "停止处理"}
                onClick={onCancel}
                disabled={saving}
              >
                <Icon name="stop" size={16} />
              </button>
            </Tooltip>
          ) : (
            <Tooltip label="发送">
              <button
                type="submit"
                className={s.composerButton}
                aria-label="发送"
                disabled={!draft.trim()}
              >
                <Icon name="arrowUp" size={18} />
              </button>
            </Tooltip>
          )}
        </div>
      </form>
    </section>
  );
}
