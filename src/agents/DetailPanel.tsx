import {
  replySourceOf,
  type Agent,
  type AgentProviderInfo,
  type ReplySource,
} from "../../modules/agents/contract";
import { Avatar } from "./AgentList";
import { Icon } from "../components/Icon";
import s from "./DetailPanel.module.css";
export function DetailPanel({
  agent,
  provider,
  onClose,
  onPin,
  onSession,
  onDeleteSession,
  onOpenExtension,
  sources = [],
  onReplySource,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
  /** Absent for providers that do not let each Agent choose. */
  sources?: readonly ReplySource[];
  onReplySource?: (extensionId: string) => void;
  onClose: () => void;
  onPin: () => void;
  onSession: (action: "create" | "select", id?: string) => void;
  onDeleteSession: (id: string, source: HTMLElement) => void;
  onOpenExtension: (id: string) => void;
}) {
  // Providers predating `extensions` are shown as the one extension they are.
  const source = replySourceOf(agent, sources);
  const extensions = [
    ...(provider.extensions ?? [
      { id: agent.extensionId, label: provider.label },
    ]),
    ...(source ? [source] : []),
  ].filter((entry, i, all) => all.findIndex((e) => e.id === entry.id) === i);
  return (
    <aside className={s.details} aria-label="Agent 详情">
      <header>
        <h2>Agent 详情</h2>
        <button className="icon-button" aria-label="收起详情" onClick={onClose}>
          <Icon name="close" />
        </button>
      </header>
      <div className={s.detailScroll}>
        <div className={s.profile}>
          <Avatar agent={agent} size="large" />
          <h2>{agent.name}</h2>
          <span>{agent.status === "busy" ? "正在回复" : "空闲"}</span>
          <button className="secondary" onClick={onPin}>
            <Icon name="star" size={16} />
            {agent.pinned ? "取消特别关注" : "设为特别关注"}
          </button>
        </div>
        {agent.description && (
          <section>
            <h3>角色说明</h3>
            <p>{agent.description}</p>
          </section>
        )}
        {extensions.length > 0 && (
          <section>
            <h3>使用的扩展</h3>
            <ul className={s.chips}>
              {extensions.map((extension) => (
                <li key={extension.id}>
                  <button
                    className={s.chip}
                    title={extension.id}
                    aria-label={`查看扩展 ${extension.label}`}
                    onClick={() => onOpenExtension(extension.id)}
                  >
                    <Icon name="puzzle" size={14} />
                    {extension.label}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {onReplySource && sources.length > 0 && (
          <section>
            <h3 id="reply-source-heading">回复来源</h3>
            <div
              className={s.chips}
              role="radiogroup"
              aria-labelledby="reply-source-heading"
            >
              {sources.map((entry) => (
                <button
                  key={entry.id}
                  role="radio"
                  aria-checked={entry.id === source?.id}
                  className={s.chip}
                  title={entry.id}
                  onClick={() => {
                    if (entry.id !== source?.id) onReplySource(entry.id);
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <p className={s.detailNote}>
              {agent.replySource && agent.replySource !== source?.id
                ? `所选扩展未启用，暂由「${source?.label}」回复。`
                : source?.description}
            </p>
          </section>
        )}
        <section>
          <h3>实际可用能力</h3>
          {agent.capabilities.map((c) => (
            <p className={s.capability} key={c}>
              <Icon name="check" size={16} />
              {c}
            </p>
          ))}
          <p className={s.detailNote}>角色卡说明不会授予额外访问权限。</p>
        </section>
        {agent.multiSession && (
          <section className={s.sessions}>
            <div className={s.sessionHeading}>
              <h3>会话</h3>
              <button
                className="icon-button"
                aria-label="新建会话"
                disabled={agent.status === "busy"}
                onClick={() => onSession("create")}
              >
                <Icon name="plus" size={18} />
              </button>
            </div>
            {agent.sessions.map((session) => (
              <div key={session.id} className={s.sessionRow}>
                <button
                  aria-pressed={session.id === agent.currentSessionId}
                  disabled={agent.status === "busy"}
                  onClick={() => onSession("select", session.id)}
                >
                  <Icon name="document" size={16} />
                  <span>{session.title}</span>
                </button>
                <button
                  className="icon-button"
                  aria-label={`删除会话 ${session.title}`}
                  disabled={agent.status === "busy"}
                  onClick={(e) => onDeleteSession(session.id, e.currentTarget)}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}
            {agent.status === "busy" && <p>停止处理后可管理会话。</p>}
          </section>
        )}
      </div>
    </aside>
  );
}
