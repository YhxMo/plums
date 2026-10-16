import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  Agent,
  AgentConfig,
  AgentProvider,
} from "../../modules/sdk/agents";
import { parseRoleCard } from "../../modules/agents/store";
import { readRoleCardLink } from "../../modules/agents/role-card";
import { AgentList } from "./AgentList";
import { ChatView } from "./ChatView";
import { DetailPanel } from "./DetailPanel";
import { EmptyState } from "./EmptyState";
import { Dialog } from "./Dialog";
import { Icon } from "./Icon";
import s from "./Workspace.module.css";

const mobileQuery = matchMedia("(max-width: 767px)");
const subscribeMobile = (listener: () => void) => {
  mobileQuery.addEventListener("change", listener);
  return () => mobileQuery.removeEventListener("change", listener);
};
const isMobile = () => mobileQuery.matches;

type Modal =
  | "add"
  | "create"
  | "import"
  | {
      action: "rename" | "remove" | "deleteSession";
      agent: Agent;
      session?: string;
    }
  | null;
export function AgentWorkspace({
  api,
  onExtensions,
}: {
  api: AgentProvider;
  onExtensions: () => void;
}) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const snapshot = useCallback(() => api.list(), [api]);
  const agents = useSyncExternalStore(subscribe, snapshot);
  const mobile = useSyncExternalStore(subscribeMobile, isMobile);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const modalTrigger = useRef<HTMLElement | null>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  useEffect(() => {
    const onSelectAgent = (event: Event) => {
      const id = (event as CustomEvent<string>).detail;
      if (id) {
        setSelected(id);
        setDetail(false);
      }
    };
    const onToggleDetail = (event: Event) => {
      const source = (event as CustomEvent<HTMLElement | null>).detail;
      if (source) detailTrigger.current = source;
      setDetail((prev) => {
        if (!prev && !selectedRef.current && agentsRef.current.length > 0) {
          setSelected(agentsRef.current[0].id);
        }
        return !prev;
      });
    };
    const onDetailClosed = () => setDetail(false);
    window.addEventListener("plums:select-agent", onSelectAgent);
    window.addEventListener("plums:toggle-agent-detail", onToggleDetail);
    window.addEventListener("plums:agent-detail-closed", onDetailClosed);
    return () => {
      window.removeEventListener("plums:select-agent", onSelectAgent);
      window.removeEventListener("plums:toggle-agent-detail", onToggleDetail);
      window.removeEventListener("plums:agent-detail-closed", onDetailClosed);
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const readController = useRef<AbortController | null>(null);
  useEffect(() => () => readController.current?.abort(), []);
  const closeModal = () => {
    if (busy) return;
    readController.current?.abort();
    readController.current = null;
    setReading(false);
    setModal(null);
  };
  async function readLink() {
    const controller = new AbortController();
    readController.current = controller;
    setReading(true);
    setError("");
    try {
      const card = await readRoleCardLink(url, controller.signal);
      if (readController.current === controller) setRaw(card);
    } catch (e) {
      if (readController.current === controller && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (readController.current === controller) {
        readController.current = null;
        setReading(false);
      }
    }
  }
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [multi, setMulti] = useState(false);
  const [raw, setRaw] = useState("");
  const [url, setUrl] = useState("");
  const agent = agents.find((a) => a.id === selected);
  const key = agent ? `${agent.id}:${agent.currentSessionId}` : "";
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("plums:agent-detail-state", { detail }),
    );
  }, [detail]);
  useEffect(() => {
    const session = agent?.sessions.find(
      (item) => item.id === agent.currentSessionId,
    );
    const title =
      agent && session
        ? session.title && session.title !== agent.name
          ? `${agent.name} · ${session.title}`
          : agent.name
        : "";
    window.dispatchEvent(
      new CustomEvent("plums:workspace-title", { detail: title }),
    );
    return () => {
      window.dispatchEvent(
        new CustomEvent("plums:workspace-title", { detail: "" }),
      );
    };
  }, [agent]);
  const open = (next: Modal, source?: HTMLElement | null) => {
    if (!modal) modalTrigger.current = source ?? null;
    setModal(next);
    setError("");
    setName(typeof next === "object" && next ? next.agent.name : "");
  };
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError")
        setNotice("已停止，未保存本次结果。");
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  async function add(config: AgentConfig) {
    const a = await api.create(config);
    setSelected(a.id);
    setDetail(false);
    setModal(null);
    setDescription("");
    setMulti(false);
    setRaw("");
  }
  function agentAction(
    a: Agent,
    action: "pin" | "rename" | "remove",
    source?: HTMLElement | null,
  ) {
    if (action === "pin")
      void act(() => api.update(a.id, { pinned: !a.pinned }));
    else open({ action, agent: a }, source);
  }
  const feedback = (className: string) =>
    (error || notice) && !modal ? (
      <div className={className} role={error ? "alert" : "status"}>
        {error || notice}
        <button
          className="icon-button"
          aria-label="关闭提示"
          onClick={() => {
            setError("");
            setNotice("");
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
    ) : null;
  const detailContent = agent && (
    <DetailPanel
      agent={agent}
      provider={api.info}
      onClose={() => setDetail(false)}
      onPin={() => agentAction(agent, "pin")}
      onSession={(action, id) =>
        void act(() => api.session(agent.id, action, id))
      }
      onDeleteSession={(id, source) =>
        open({ action: "deleteSession", agent, session: id }, source)
      }
    />
  );
  return (
    <div
      className={s.workspace}
      data-conversation={!!agent}
      data-detail={detail}
    >
      {!(mobile && detail && agent) && feedback(s.sharedFeedback)}
      <AgentList
        agents={agents}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          setDetail(false);
        }}
        onAdd={(source) => open("add", source)}
        onAction={agentAction}
      />
      <div className={s.mainColumn}>
        {!agent ? (
          agents.length === 0 ? (
            <EmptyState
              onImport={(source) => open("import", source)}
              onAdd={(source) => open("create", source)}
              onExtensions={onExtensions}
            />
          ) : (
            <div className={s.chooseAgent}>
              <Icon name="card" size={48} />
              <h1>选择一个 Agent</h1>
              <p>从左侧开始，或添加新的角色与能力。</p>
              <button onClick={(e) => open("add", e.currentTarget)}>
                添加 Agent
              </button>
            </div>
          )
        ) : (
          <ChatView
            agent={agent}
            provider={api.info}
            draft={drafts[key] ?? ""}
            onDraft={(value) => setDrafts((d) => ({ ...d, [key]: value }))}
            onBack={() => {
              setSelected(null);
              setDetail(false);
            }}
            onDetail={(source) => {
              detailTrigger.current = source;
              setDetail((d) => !d);
            }}
            onCancel={() => api.cancel(agent.id)}
            onSend={() => {
              const input = drafts[key] ?? "";
              void act(async () => {
                await api.send(agent.id, input);
                setDrafts((d) => (d[key] === input ? { ...d, [key]: "" } : d));
              });
            }}
          />
        )}
      </div>
      {detail &&
        agent &&
        (mobile ? (
          <Dialog
            title="Agent 详情"
            bare
            returnFocusTo={detailTrigger.current}
            onClose={() => setDetail(false)}
          >
            <div className={s.mobileDetail}>
              {feedback(s.detailFeedback)}
              {detailContent}
            </div>
          </Dialog>
        ) : (
          <div className={s.detailHost}>{detailContent}</div>
        ))}
      {modal && (
        <Dialog
          returnFocusTo={modalTrigger.current}
          title={
            typeof modal === "string"
              ? { add: "添加", create: "添加 Agent", import: "导入角色卡" }[
                  modal
                ]
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
                              if (file.size > 32000)
                                throw Error("角色卡不能超过 32 KB。");
                              setRaw(await file.text());
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
                      支持实验 JSON
                      格式：name、description、multiSession、version: 1。
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
                    <div className={s.localInfo}>
                      <Icon name="puzzle" />
                      <div>
                        <strong>{api.info.label}</strong>
                        <p>{api.info.description}</p>
                      </div>
                    </div>
                  </>
                )}
                {error && (
                  <p role="alert" className="error">
                    {error}
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
                      if (selected === modal.agent.id) setSelected(null);
                    } else
                      await api.session(
                        modal.agent.id,
                        "delete",
                        modal.session,
                      );
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
                  {error && (
                    <p role="alert" className="error">
                      {error}
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
      )}
    </div>
  );
}
