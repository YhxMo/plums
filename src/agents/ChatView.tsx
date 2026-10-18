import { useEffect, useLayoutEffect, useRef } from "react";
import type { Agent, AgentProviderInfo } from "../../modules/agents/contract";
import { Avatar } from "./AgentList";
import { Icon } from "../components/Icon";
import s from "./ChatView.module.css";
export function ChatView({
  agent,
  provider,
  draft,
  onDraft,
  onBack,
  onDetail,
  onSend,
  onCancel,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
  draft: string;
  onDraft: (value: string) => void;
  onBack: () => void;
  onDetail: (source: HTMLElement) => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const session = agent.sessions.find((s) => s.id === agent.currentSessionId)!;
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
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
  return (
    <section className={s.chat} aria-label={`${agent.name} 的会话`}>
      <header className={s.chatHeader}>
        <button
          className="icon-button"
          onClick={onBack}
          aria-label="返回 Agent 列表"
        >
          <Icon name="back" />
        </button>
        <Avatar agent={agent} />
        <div>
          <h1>{agent.name}</h1>
          <p>
            {agent.status === "busy"
              ? "正在处理…"
              : agent.status === "online"
                ? "在线"
                : "空闲"}
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
        {session.messages.map((m) => (
          <div
            key={m.id}
            className={`${s.message} ${m.role === "user" ? s.userMessage : ""}`}
          >
            <span className="sr-only">
              {m.role === "user" ? "你" : agent.name}：
            </span>
            <p>{m.text}</p>
          </div>
        ))}
        {agent.pending?.sessionId === session.id && (
          <div className={`${s.message} ${s.userMessage}`}>
            <span className="sr-only">你：</span>
            <p>{agent.pending.text}</p>
          </div>
        )}
        {agent.status === "busy" && (
          <div className={s.message}>
            <p role="status" className={s.typing}>
              <span aria-hidden="true" />
              {agent.name} 正在回复…
            </p>
          </div>
        )}
        <div ref={bottom} />
      </div>
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
          maxLength={8000}
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
              if (draft.trim() && agent.status !== "busy") onSend();
            }
          }}
        />
        <div className={s.composerBottom}>
          {agent.status === "busy" ? (
            <button
              type="button"
              className="secondary"
              aria-label={agent.canCancel === false ? "正在保存…" : "停止处理"}
              title={agent.canCancel === false ? "正在保存…" : "停止处理"}
              onClick={onCancel}
              disabled={agent.canCancel === false}
            >
              <Icon name="stop" size={16} />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="发送"
              title="发送"
              disabled={!draft.trim()}
            >
              <Icon name="arrowUp" size={18} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
