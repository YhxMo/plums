import {
  enabledExtensions,
  type Agent,
  type AgentProviderInfo,
  type ExtensionChoice,
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
  choices,
  onExtension,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
  /** Absent for providers that do not let each Agent choose. */
  choices?: readonly ExtensionChoice[];
  onExtension?: (extensionId: string, on: boolean) => void;
  onClose: () => void;
  onPin: () => void;
  onSession: (action: "create" | "select", id?: string) => void;
  onDeleteSession: (id: string, source: HTMLElement) => void;
  /** Opens extension management, selecting `id` when given. */
  onOpenExtension: (id?: string) => void;
}) {
  // Providers predating `extensions` are shown as the one extension they are.
  const base = provider.extensions ?? [
    { id: agent.extensionId, label: provider.label },
  ];
  const enabled = choices ? enabledExtensions(agent, choices) : [];
  const label = (id: string) => choices?.find((c) => c.id === id)?.label;
  const row = (
    extension: { id: string; label: string; description?: string },
    toggle?: boolean,
  ) => (
    <li key={extension.id} className={s.extensionRow}>
      <button
        className={s.extensionOpen}
        title={extension.id}
        aria-label={`查看扩展 ${extension.label}`}
        onClick={() => onOpenExtension(extension.id)}
      >
        <span>{extension.label}</span>
        <small>{extension.description ?? "Agent 本体，始终开启"}</small>
      </button>
      {toggle !== undefined && (
        <button
          role="switch"
          aria-checked={toggle}
          aria-label={`在 ${agent.name} 中使用 ${extension.label}`}
          className={s.switch}
          onClick={() => onExtension?.(extension.id, !toggle)}
        />
      )}
    </li>
  );
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
        <section>
          <h3>组成扩展</h3>
          <ul className={s.extensionList}>
            {base.map((extension) => row(extension))}
            {choices?.map((choice) => row(choice, enabled.includes(choice.id)))}
          </ul>
          {choices?.length === 0 && (
            <>
              <p className={s.detailNote}>
                还没有可用的扩展。在扩展管理中启用一个模型连接后，可在这里开启。
              </p>
              <button
                className={`secondary ${s.noteAction}`}
                onClick={() => onOpenExtension()}
              >
                在扩展管理中启用
              </button>
            </>
          )}
          {!!choices?.length && (
            <p className={s.detailNote}>
              {enabled.length === 0
                ? "尚未开启任何扩展，此 Agent 暂时无法回复。"
                : enabled.length > 1
                  ? `回复依次经过：${enabled.map(label).join(" → ")}`
                  : "开启的扩展处理此 Agent 的回复，可同时开启多个。"}
            </p>
          )}
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
      </div>
    </aside>
  );
}
