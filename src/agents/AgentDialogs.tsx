import { useState } from "react";
import type {
  Agent,
  AgentConfig,
  AgentProvider,
} from "../../modules/agents/contract";
import { parseRoleCard } from "../../modules/agents/store";
import { Dialog } from "../components/Dialog";
import { Icon } from "../components/Icon";
import type { AgentModals } from "./useAgentModals";
import s from "./Onboarding.module.css";

export function AgentDialogs({
  api,
  modals,
  onCreated,
  onRemoved,
  onExtensions,
  fallbackFocus,
}: {
  api: AgentProvider;
  modals: Pick<
    AgentModals,
    | "modal"
    | "name"
    | "busy"
    | "roleCard"
    | "modalTrigger"
    | "setName"
    | "setModal"
    | "open"
    | "closeModal"
    | "act"
  >;
  onCreated(agent: Agent): void;
  onRemoved(id: string): void;
  onExtensions(): void;
  fallbackFocus(): HTMLElement | null;
}) {
  const {
    modal,
    name,
    setName,
    busy,
    modalTrigger,
    open,
    closeModal,
    setModal,
    act,
    roleCard,
  } = modals;
  const { raw, url, setRaw, setUrl, reading, readLink, readFile } = roleCard;
  const [description, setDescription] = useState("");
  const [multi, setMulti] = useState(false);
  async function add(config: AgentConfig) {
    const agent = await api.create(config);
    onCreated(agent);
    setModal(null);
    setDescription("");
    setMulti(false);
    setRaw("");
  }
  if (!modal) return null;
  return (
    <Dialog
      returnFocusTo={modalTrigger.current}
      fallbackFocus={fallbackFocus}
      title={
        typeof modal === "string"
          ? { add: "添加", create: "添加 Agent", import: "导入角色卡" }[modal]
          : {
              rename: "重命名 Agent",
              remove: "移除 Agent",
              deleteSession: "删除会话",
            }[modal.action]
      }
      onClose={closeModal}
    >
      {modal === "add" ? (
        <div className="dialog-content">
          <p className="muted">选择添加方式</p>
          <div className={s.addOptions}>
            <button className="secondary" onClick={() => open("create")}>
              <Icon name="add" />
              <span>
                <strong>添加 Agent</strong>
                <small>设置角色说明，组合已安装的能力</small>
              </span>
              <Icon name="arrow" />
            </button>
            <button className="secondary" onClick={() => open("import")}>
              <Icon name="card" />
              <span>
                <strong>导入角色卡</strong>
                <small>从文件或链接读取角色说明</small>
              </span>
              <Icon name="arrow" />
            </button>
            <button
              className="secondary"
              onClick={() => {
                setModal(null);
                onExtensions();
              }}
            >
              <Icon name="puzzle" />
              <span>
                <strong>安装扩展</strong>
                <small>添加模型连接器、MCP 或其他能力</small>
              </span>
              <Icon name="arrow" />
            </button>
          </div>
        </div>
      ) : modal === "create" || modal === "import" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              add(
                modal === "import"
                  ? parseRoleCard(raw)
                  : { name, description, multiSession: multi },
              ),
            );
          }}
        >
          <div className="dialog-content">
            {modal === "import" ? (
              <>
                <p>
                  读取角色说明后，使用当前 Agent
                  提供者的能力。模型和工具连接由对应扩展提供。
                </p>
                <label className="field">
                  角色卡文件
                  <input
                    disabled={busy || reading}
                    type="file"
                    accept=".json,application/json"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file)
                        void act(async () => {
                          await readFile(file);
                        });
                    }}
                  />
                </label>
                <div className={s.urlRow}>
                  <label className="field">
                    角色卡链接
                    <input
                      disabled={busy || reading}
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="/cards/example.json"
                    />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy || reading || !url.trim()}
                    onClick={() => void readLink()}
                  >
                    {reading ? "读取中…" : "读取"}
                  </button>
                </div>
                <label className="field">
                  角色卡内容
                  <textarea
                    disabled={busy || reading}
                    value={raw}
                    onChange={(e) => setRaw(e.target.value)}
                    placeholder={
                      '{"version":1,"name":"我的助手","description":"帮助整理文字","multiSession":true}'
                    }
                    maxLength={32000}
                  />
                </label>
                <p className="muted">
                  支持实验 JSON 格式：name、description、multiSession、version:
                  1。
                </p>
              </>
            ) : (
              <>
                <label className="field">
                  名称
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    placeholder="例如：写作助手"
                    required
                  />
                </label>
                <label className="field">
                  角色说明
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={4000}
                    placeholder="它帮助你做什么？有哪些边界？"
                    rows={3}
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={multi}
                    onChange={(e) => setMulti(e.target.checked)}
                  />
                  允许多个会话
                </label>
                <p className={s.localInfo}>
                  <Icon name="puzzle" size={15} />
                  <span>
                    <strong>回复来源</strong> {api.info.description}
                  </span>
                </p>
              </>
            )}
          </div>
          <footer className="dialog-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={closeModal}
            >
              取消
            </button>
            <button
              type="submit"
              disabled={
                busy ||
                reading ||
                (modal === "import" ? !raw.trim() : !name.trim())
              }
            >
              {busy ? "正在添加…" : "添加"}
            </button>
          </footer>
        </form>
      ) : (
        typeof modal === "object" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (modal.action === "rename")
                  await api.update(modal.agent.id, { name });
                else if (modal.action === "remove") {
                  await api.remove(modal.agent.id);
                  onRemoved(modal.agent.id);
                } else
                  await api.session(modal.agent.id, "delete", modal.session);
                setModal(null);
              });
            }}
          >
            <div className="dialog-content">
              {modal.action === "rename" ? (
                <label className="field">
                  名称
                  <input
                    autoFocus
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </label>
              ) : (
                <p>
                  {modal.action === "remove"
                    ? `移除「${modal.agent.name}」并删除它在此应用中的本地会话？`
                    : "删除此会话及其本地消息？此操作不能撤销。"}
                </p>
              )}
            </div>
            <footer className="dialog-actions">
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={closeModal}
              >
                取消
              </button>
              <button disabled={busy}>
                {modal.action === "rename" ? "保存" : "确认删除"}
              </button>
            </footer>
          </form>
        )
      )}
    </Dialog>
  );
}
