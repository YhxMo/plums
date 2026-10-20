import {
  enabledExtensions,
  type Agent,
  type AgentModel,
  type AgentProviderInfo,
  type ExtensionChoice,
  type ModelChoice,
} from "../../modules/agents/contract";
import { Avatar } from "./AgentList";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import s from "./DetailPanel.module.css";
import { Tooltip } from "../components/Tooltip";
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
  models,
  onModel,
  onModels,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
  /** Absent for providers that do not let each Agent choose. */
  choices?: readonly ExtensionChoice[];
  onExtension?: (extensionId: string, on: boolean) => void;
  /** Absent for providers without per-Agent models. */
  models?: readonly ModelChoice[];
  onModel?: (model: AgentModel | null) => void;
  onModels?: () => void;
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
  const key = (model: AgentModel) => `${model.provider}\n${model.model}`;
  const current = agent.model ? key(agent.model) : "";
  const missing =
    !!agent.model &&
    !models?.some(
      (m) => key({ provider: m.provider, model: m.id }) === current,
    );
  const label = (id: string) => choices?.find((c) => c.id === id)?.label;
  const row = (
    extension: { id: string; label: string; description?: string },
    toggle?: boolean,
  ) => (
    <li key={extension.id} className={s.extensionRow}>
      <Tooltip label={extension.id}>
        <button
          className={s.extensionOpen}
          aria-label={`查看扩展 ${extension.label}`}
          onClick={() => onOpenExtension(extension.id)}
        >
          <span>{extension.label}</span>
          <small>{extension.description ?? "Agent 本体，始终开启"}</small>
        </button>
      </Tooltip>
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
        {models && onModel && (
          <section>
            <h3>模型</h3>
            <Select
              label={`${agent.name} 使用的模型`}
              value={current}
              disabled={agent.status === "busy"}
              options={[
                { value: "", label: "未选择" },
                ...(missing
                  ? [{ value: current, label: "已不可用的模型" }]
                  : []),
                ...models.map((m) => ({
                  value: key({ provider: m.provider, model: m.id }),
                  label: m.label,
                  description: m.description,
                  group: m.group,
                })),
              ]}
              onChange={(value) => {
                const choice = models.find(
                  (m) => key({ provider: m.provider, model: m.id }) === value,
                );
                onModel(
                  choice
                    ? { provider: choice.provider, model: choice.id }
                    : null,
                );
              }}
            />
            <p className={s.detailNote}>
              {missing
                ? "所选模型已删除或其连接已停用，请重新选择。"
                : (models.find(
                    (m) =>
                      key({ provider: m.provider, model: m.id }) === current,
                  )?.description ??
                  (models.length
                    ? "选择一个模型后此 Agent 才能回复；最近的对话与角色说明会发送给它。"
                    : "还没有可选的模型：添加服务商和它的模型后即可选择。"))}
            </p>
            {onModels && (
              <button
                className={`secondary ${s.noteAction}`}
                onClick={onModels}
              >
                {models.length ? "管理模型连接" : "添加模型连接"}
              </button>
            )}
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
                没有可开启的文本扩展；回复只由上面选择的模型生成。
              </p>
            </>
          )}
          {!!choices?.length && (
            <p className={s.detailNote}>
              {enabled.length === 0
                ? agent.model
                  ? "可开启文本扩展对模型回复做后处理。"
                  : "尚未选择模型或开启扩展，此 Agent 暂时无法回复。"
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
