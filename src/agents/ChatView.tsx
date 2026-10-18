import { useEffect, useRef } from "react";
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
        <div className={s.conversationIntro}>
          <span>{provider.label}</span>
          <p>{agent.description}</p>
        </div>
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
            <span>{m.role === "user" ? "你" : agent.name}</span>
            <p>{m.text}</p>
          </div>
        ))}
        {agent.pending?.sessionId === session.id && (
          <div className={`${s.message} ${s.userMessage}`}>
            <span>你</span>
            <p>{agent.pending.text}</p>
          </div>
        )}
        {agent.status === "busy" && (
          <div className={s.message}>
            <span>{agent.name}</span>
            <p role="status">正在处理并保存…</p>
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
          id="message-input"
          aria-label="消息"
          placeholder={`发送给 ${agent.name}…`}
          rows={2}
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
              onClick={onCancel}
              disabled={agent.canCancel === false}
            >
              {agent.canCancel === false ? "正在保存…" : "停止处理"}
            </button>
          ) : (
            <button type="submit" disabled={!draft.trim()}>
              <Icon name="send" size={17} /> 发送
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
