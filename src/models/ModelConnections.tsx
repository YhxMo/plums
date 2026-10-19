import { useCallback, useState, useSyncExternalStore } from "react";
import type { ModelConnectionsApi } from "../../modules/models/extension";
import {
  limits,
  type ConnectionDraft,
  type ConnectionStatus,
  type ConnectionView,
} from "../../modules/models/connections";
import { useAsyncAction } from "../components/useAsyncAction";
import s from "./ModelConnections.module.css";

const statusLabel: Record<ConnectionStatus, string> = {
  ready: "可用",
  pending: "待核对",
  disabled: "已停用",
  "delete-pending": "删除待核对",
  missing: "需要录入密钥",
};

function fromPreset(api: ModelConnectionsApi, id: string): ConnectionDraft {
  const preset = api.presets.find((p) => p.id === id) ?? api.presets[0];
  return {
    name: preset.target ? preset.label : "",
    preset: preset.id,
    protocol: preset.protocol,
    target: preset.target,
    model: preset.model,
    maxTokens: 1024,
    turns: 10,
  };
}

/** The user's model connections: add, edit, re-key, test and delete. */
export function ModelConnections({ api }: { api: ModelConnectionsApi }) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const connections = useSyncExternalStore(subscribe, () => api.list());
  // `null` lists; `""` is a new connection; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ConnectionDraft>(() =>
    fromPreset(api, api.presets[0].id),
  );
  const [results, setResults] = useState<Record<string, string>>({});
  const { busy, error, notice, setNotice, run } = useAsyncAction();

  function edit(connection?: ConnectionView) {
    setEditing(connection?.id ?? "");
    setDraft(
      connection
        ? {
            name: connection.name,
            preset: connection.preset,
            protocol: connection.protocol,
            target: connection.target,
            model: connection.model,
            maxTokens: connection.maxTokens,
            turns: connection.turns,
          }
        : fromPreset(api, api.presets[0].id),
    );
  }
  const set = (patch: Partial<ConnectionDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const save = (rekey = false) =>
    run(async () => {
      const saved = await api.save(draft, editing || undefined, rekey);
      if (!saved) return setNotice("已取消，未保存密钥。");
      setEditing(null);
      setNotice("模型连接已保存。");
    });

  if (editing !== null) {
    const current = connections.find((c) => c.id === editing);
    const custom = !api.presets.find((p) => p.id === draft.preset)?.target;
    return (
      <form
        className="dialog-content"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <p>
          保存时会打开系统面板，请核对服务地址并录入 API
          Key；之后只改名称、模型或预算不需要再录入。
        </p>
        <label className="field">
          服务商
          <select
            value={draft.preset}
            disabled={busy || !!current}
            onChange={(e) => setDraft(fromPreset(api, e.target.value))}
          >
            {api.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          名称
          <input
            value={draft.name}
            maxLength={40}
            required
            disabled={busy}
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>
        <label className="field">
          服务地址
          <input
            value={draft.target}
            type="url"
            required
            disabled={busy || !custom}
            placeholder="https://…/chat/completions"
            onChange={(e) => set({ target: e.target.value.trim() })}
          />
        </label>
        <label className="field">
          模型
          <input
            value={draft.model}
            maxLength={120}
            required
            disabled={busy}
            onChange={(e) => set({ model: e.target.value.trim() })}
          />
        </label>
        <div className={s.pair}>
          <label className="field">
            最大输出 token
            <input
              type="number"
              min={limits.maxTokens[0]}
              max={limits.maxTokens[1]}
              value={draft.maxTokens}
              disabled={busy}
              onChange={(e) => set({ maxTokens: e.target.valueAsNumber })}
            />
          </label>
          <label className="field">
            上下文轮数
            <input
              type="number"
              min={limits.turns[0]}
              max={limits.turns[1]}
              value={draft.turns}
              disabled={busy}
              onChange={(e) => set({ turns: e.target.valueAsNumber })}
            />
          </label>
        </div>
        <p className="muted">
          上下文轮数是每次随消息一起发送的最近几轮对话，0
          表示只发当前这一句；总量超过 64 KiB 时自动丢弃最早的轮次。
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className={s.actions}>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            返回
          </button>
          {current && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              重新录入密钥
            </button>
          )}
          <button type="submit" disabled={busy}>
            {busy ? "正在保存…" : current ? "保存" : "保存并录入密钥"}
          </button>
        </div>
      </form>
    );
  }
  return (
    <div className="dialog-content">
      <p>
        为 Agent 准备可用的模型。每条连接是一个服务地址、一个模型和你自己的 API
        Key；在 Agent 详情里为每个 Agent 选择使用哪一条。
      </p>
      {connections.length === 0 ? (
        <p className="muted">还没有模型连接。</p>
      ) : (
        <ul className={s.list} aria-label="模型连接">
          {connections.map((connection) => (
            <li key={connection.id}>
              <div className={s.summary}>
                <strong>{connection.name}</strong>
                <span className="muted">
                  {api.presets.find((p) => p.id === connection.preset)?.label ??
                    "自定义"}{" "}
                  · {connection.model} · {statusLabel[connection.status]}
                </span>
                {results[connection.id] && (
                  <span role="status">{results[connection.id]}</span>
                )}
              </div>
              <div className={s.actions}>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => edit(connection)}
                >
                  编辑
                </button>
                <button
                  className="secondary"
                  disabled={busy || connection.status !== "ready"}
                  onClick={() =>
                    void run(async () => {
                      setResults((r) => ({
                        ...r,
                        [connection.id]: "正在测试…",
                      }));
                      try {
                        const reply = await api.test(
                          connection.id,
                          AbortSignal.timeout(60_000),
                        );
                        setResults((r) => ({
                          ...r,
                          [connection.id]: `回复：${reply.slice(0, 60)}`,
                        }));
                      } catch (reason) {
                        setResults((r) => ({ ...r, [connection.id]: "" }));
                        throw reason;
                      }
                    })
                  }
                >
                  测试
                </button>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!(await api.remove(connection.id)))
                        return setNotice("已取消删除。");
                      setNotice("已删除。");
                    })
                  }
                >
                  删除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button disabled={busy} onClick={() => edit()}>
        新建连接
      </button>
    </div>
  );
}
