import type { Agent, AgentProviderInfo } from "../../modules/sdk/agents";
import { Avatar } from "./AgentList";
import { Icon } from "./Icon";
import s from "./Workspace.module.css";
export function DetailPanel({
  agent,
  provider,
  onClose,
  onPin,
  onSession,
  onDeleteSession,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
  onClose: () => void;
  onPin: () => void;
  onSession: (action: "create" | "select", id?: string) => void;
  onDeleteSession: (id: string, source: HTMLElement) => void;
}) {
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
          <span>{provider.label}</span>
          <button className="secondary" onClick={onPin}>
            <Icon name="star" size={16} />
            {agent.pinned ? "取消特别关注" : "设为特别关注"}
          </button>
        </div>
        <section>
          <h3>角色说明</h3>
          <p>{agent.description}</p>
        </section>
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
        <section className={s.source}>
          <h3>来源与版本</h3>
          <p>{provider.label}</p>
          <code>
            {agent.extensionId} · {provider.version}
          </code>
          <p>运行状态：{agent.status === "busy" ? "运行中" : "空闲"}</p>
        </section>
      </div>
    </aside>
  );
}
