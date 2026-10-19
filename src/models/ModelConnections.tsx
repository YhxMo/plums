import { useCallback, useState, useSyncExternalStore } from "react";
import type { ModelConnectionsApi } from "../../modules/models/extension";
import {
  limits,
  MAX_MODELS,
  type ProviderDraft,
  type ProviderStatus,
  type ProviderView,
} from "../../modules/models/providers";
import { Select } from "../components/Select";
import { useAsyncAction } from "../components/useAsyncAction";
import s from "./ModelConnections.module.css";

const statusLabel: Record<ProviderStatus, string> = {
  ready: "可用",
  pending: "待核对",
  disabled: "已停用",
  "delete-pending": "删除待核对",
  missing: "需要录入密钥",
};

function fromPreset(api: ModelConnectionsApi, id: string): ProviderDraft {
  const preset = api.presets.find((p) => p.id === id) ?? api.presets[0];
  return {
    name: preset.target ? preset.label : "",
    preset: preset.id,
    protocol: preset.protocol,
    target: preset.target,
    models: [],
    maxTokens: 1024,
    turns: 10,
  };
}

/** Model names of one provider: add by typing, remove one by one. */
function ModelList({
  models,
  disabled,
  onChange,
}: {
  models: string[];
  disabled: boolean;
  onChange: (models: string[]) => void;
}) {
  const [name, setName] = useState("");
  const value = name.trim();
  const add = () => {
    if (!value || models.includes(value)) return;
    onChange([...models, value]);
    setName("");
  };
  return (
    <fieldset className={s.models}>
      <legend>模型</legend>
      {models.length > 0 && (
        <ul aria-label="已添加的模型">
          {models.map((model) => (
            <li key={model}>
              <span>{model}</span>
              <button
                type="button"
                className="secondary"
                aria-label={`移除 ${model}`}
                disabled={disabled}
                onClick={() => onChange(models.filter((m) => m !== model))}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={`field ${s.addModel}`}>
        <input
          aria-label="模型名"
          value={name}
          maxLength={120}
          disabled={disabled || models.length >= MAX_MODELS}
          placeholder="按服务商文档填写模型名"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add();
          }}
        />
        <button
          type="button"
          className="secondary"
          disabled={disabled || !value || models.includes(value)}
          onClick={add}
        >
          添加模型
        </button>
      </div>
    </fieldset>
  );
}

/** The user's model providers and their models: add, edit, re-key, test, delete. */
export function ModelConnections({ api }: { api: ModelConnectionsApi }) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const providers = useSyncExternalStore(subscribe, () => api.list());
  // `null` lists; `""` is a new provider; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    fromPreset(api, api.presets[0].id),
  );
  const [results, setResults] = useState<Record<string, string>>({});
  const { busy, error, notice, setNotice, run } = useAsyncAction();

  function edit(provider?: ProviderView) {
    setEditing(provider?.id ?? "");
    setDraft(
      provider
        ? {
            name: provider.name,
            preset: provider.preset,
            protocol: provider.protocol,
            target: provider.target,
            models: provider.models,
            maxTokens: provider.maxTokens,
            turns: provider.turns,
          }
        : fromPreset(api, api.presets[0].id),
    );
  }
  const set = (patch: Partial<ProviderDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));
  const save = (rekey = false) =>
    run(async () => {
      const saved = await api.save(draft, editing || undefined, rekey);
      if (!saved) return setNotice("已取消，未保存密钥。");
      setEditing(null);
      setNotice("已保存。");
    });
  const test = (provider: ProviderView, model: string) =>
    run(async () => {
      const key = `${provider.id}/${model}`;
      setResults((r) => ({ ...r, [key]: "正在测试…" }));
      try {
        const reply = await api.test(
          provider.id,
          model,
          AbortSignal.timeout(60_000),
        );
        setResults((r) => ({ ...r, [key]: `回复：${reply.slice(0, 60)}` }));
      } catch (reason) {
        setResults((r) => ({ ...r, [key]: "" }));
        throw reason;
      }
    });

  if (editing !== null) {
    const current = providers.find((p) => p.id === editing);
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
          Key；之后增删模型、改名称或预算不需要再录入。
        </p>
        <div className="field">
          <span aria-hidden>服务商</span>
          <Select
            label="服务商"
            value={draft.preset}
            disabled={busy || !!current}
            options={api.presets.map((preset) => ({
              value: preset.id,
              label: preset.label,
            }))}
            onChange={(id) =>
              setDraft({ ...fromPreset(api, id), models: draft.models })
            }
          />
        </div>
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
        <ModelList
          models={draft.models}
          disabled={busy}
          onChange={(models) => set({ models })}
        />
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
        先添加服务商（地址与你自己的 API Key），再添加它提供的模型名；在 Agent
        详情里为每个 Agent 选择模型。
      </p>
      {providers.length === 0 ? (
        <p className="muted">还没有服务商。</p>
      ) : (
        <ul className={s.list} aria-label="服务商">
          {providers.map((provider) => (
            <li key={provider.id} aria-label={provider.name}>
              <div className={s.header}>
                <div className={s.summary}>
                  <strong>{provider.name}</strong>
                  <span className="muted">
                    {api.presets.find((p) => p.id === provider.preset)?.label ??
                      "自定义"}{" "}
                    · {statusLabel[provider.status]}
                  </span>
                </div>
                <div className={s.actions}>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => edit(provider)}
                  >
                    编辑
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!(await api.remove(provider.id)))
                          return setNotice("已取消删除。");
                        setNotice("已删除。");
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
              {provider.models.length === 0 ? (
                <p className="muted">还没有模型，点「编辑」添加。</p>
              ) : (
                <ul
                  className={s.modelRows}
                  aria-label={`${provider.name} 的模型`}
                >
                  {provider.models.map((model) => {
                    const result = results[`${provider.id}/${model}`];
                    return (
                      <li key={model}>
                        <span className={s.summary}>
                          <span>{model}</span>
                          {result && <span role="status">{result}</span>}
                        </span>
                        <button
                          className="secondary"
                          aria-label={`测试 ${model}`}
                          disabled={busy || provider.status !== "ready"}
                          onClick={() => void test(provider, model)}
                        >
                          测试
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
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
        添加服务商
      </button>
    </div>
  );
}
