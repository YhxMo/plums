import { useCallback, useState, useSyncExternalStore } from "react";
import type { Agent, AgentProvider } from "../../modules/sdk/agents";
import { parseRoleCard } from "../../modules/agents/store";
import { Icon } from "./Icon";
import s from "./Workspace.module.css";

export function RoleCardSettings({ api }: { api: AgentProvider }) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const snapshot = useCallback(() => api.list(), [api]);
  const agents = useSyncExternalStore(subscribe, snapshot);
  const [selected, setSelected] = useState(agents[0]?.id);
  const [name, setName] = useState(agents[0]?.name ?? "");
  const [description, setDescription] = useState(agents[0]?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const agent = agents.find((a) => a.id === selected);
  function select(a: Agent) {
    setSelected(a.id);
    setName(a.name);
    setDescription(a.description);
    setError("");
    setNotice("");
  }
  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await run();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="dialog-content">
      <p>管理角色名称与说明，运行能力由对应扩展提供。</p>
      <label className="field">
        导入角色卡
        <input
          type="file"
          accept=".json,application/json"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void act(async () => {
                if (file.size > 32000) throw Error("角色卡不能超过 32 KB。");
                select(await api.create(parseRoleCard(await file.text())));
                setNotice("角色卡已导入。");
              });
          }}
        />
      </label>
      {agents.length === 0 ? (
        <div className={s.roleEmpty}>
          <Icon name="card" size={32} />
          <h3>还没有角色卡</h3>
          <p>选择 JSON 角色卡文件，添加你的第一个 Agent。</p>
        </div>
      ) : (
        <>
          <div role="group" aria-label="选择角色卡" className={s.roleChoices}>
            {agents.map((a) => (
              <button
                key={a.id}
                className="secondary"
                disabled={busy}
                aria-pressed={selected === a.id}
                onClick={() => select(a)}
              >
                <Icon name="card" size={16} />
                {a.name}
              </button>
            ))}
          </div>
          {agent && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  await api.update(agent.id, { name, description });
                  setNotice("角色卡已保存。");
                });
              }}
            >
              <label className="field">
                角色名称
                <input
                  value={name}
                  maxLength={60}
                  required
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="field">
                角色说明
                <textarea
                  value={description}
                  maxLength={4000}
                  rows={4}
                  disabled={busy}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <p className="muted">
                {api.info.label} · {api.info.version} ·{" "}
                {agent.multiSession ? "支持多个会话" : "单个会话"}
              </p>
              <p className="muted">可用能力：{agent.capabilities.join("、")}</p>
              <button type="submit" disabled={busy || !name.trim()}>
                {busy ? "正在保存…" : "保存角色卡"}
              </button>
            </form>
          )}
        </>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
