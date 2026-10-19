import { useId, useState } from "react";
import type { ModelConnectionsApi } from "../../modules/models/extension";
import { chatTarget, normalizeBase } from "../../modules/models/addresses";
import { CUSTOM } from "../../modules/models/presets";
import {
  limits,
  MAX_MODELS,
  type ProviderDraft,
  type ProviderView,
} from "../../modules/models/providers";
import { Icon } from "../components/Icon";
import { Select } from "../components/Select";
import { useAsyncAction } from "../components/useAsyncAction";
import { ModelPicker } from "./ModelPicker";
import s from "./ModelConnections.module.css";

export function fromPreset(
  api: ModelConnectionsApi,
  id: string,
): ProviderDraft {
  const preset = api.presets.find((p) => p.id === id) ?? api.presets[0];
  return {
    name: preset.id === CUSTOM ? "" : preset.label,
    notes: "",
    website: preset.website ?? "",
    preset: preset.id,
    protocol: preset.protocol,
    base: preset.base,
    models: [],
    maxTokens: 1024,
    turns: 10,
  };
}
const draftOf = (provider: ProviderView): ProviderDraft => ({
  name: provider.name,
  notes: provider.notes,
  website: provider.website,
  preset: provider.preset,
  protocol: provider.protocol,
  base: provider.base,
  models: provider.models,
  maxTokens: provider.maxTokens,
  turns: provider.turns,
});

/** Model names of one provider: type to add, or pick from the fetched list. */
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
  const full = models.length >= MAX_MODELS;
  const add = () => {
    if (!value || models.includes(value) || full) return;
    onChange([...models, value]);
    setName("");
  };
  return (
    <>
      {models.length > 0 && (
        <ul className={s.chips} aria-label="已添加的模型">
          {models.map((model) => (
            <li key={model}>
              <span>{model}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除 ${model}`}
                disabled={disabled}
                onClick={() => onChange(models.filter((m) => m !== model))}
              >
                <Icon name="close" size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={s.inline}>
        <input
          aria-label="模型名"
          value={name}
          maxLength={120}
          disabled={disabled || full}
          placeholder={full ? `最多 ${MAX_MODELS} 个模型` : "手动填写模型名"}
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
          disabled={disabled || full || !value || models.includes(value)}
          onClick={add}
        >
          添加模型
        </button>
      </div>
    </>
  );
}

/**
 * Add or edit one provider, with the fields cc-switch asks for: preset, name,
 * notes, website, API format, base URL, key, models, and advanced budgets.
 * The key itself is entered only in the native panel.
 */
export function ProviderForm({
  api,
  providers,
  provider,
  onDone,
}: {
  api: ModelConnectionsApi;
  providers: readonly ProviderView[];
  provider?: ProviderView;
  onDone: (notice: string) => void;
}) {
  const ids = useId();
  // Set when fetching models saves a new provider first.
  const [id, setId] = useState(provider?.id);
  const current = providers.find((item) => item.id === id);
  const [draft, setDraft] = useState<ProviderDraft>(() =>
    provider ? draftOf(provider) : fromPreset(api, api.presets[0].id),
  );
  const [fetched, setFetched] = useState<string[] | null>(null);
  const { busy, error, notice, setNotice, run } = useAsyncAction();
  const set = (patch: Partial<ProviderDraft>) =>
    setDraft((value) => ({ ...value, ...patch }));
  const preset = api.presets.find((p) => p.id === draft.preset);
  const custom = draft.preset === CUSTOM;
  const base = normalizeBase(draft.protocol, draft.base);
  const target = /^https:\/\/[^/?#:@\s]+/.test(base)
    ? chatTarget(draft.protocol, base)
    : "";
  // A new key is asked for when any of these change.
  const needsKey =
    !current ||
    current.status === "missing" ||
    current.base !== base ||
    current.protocol !== draft.protocol;

  const save = (rekey = false) =>
    run(async () => {
      const saved = await api.save(draft, current?.id, rekey);
      if (!saved) return setNotice("已取消，未保存密钥。");
      onDone("已保存。");
    });
  const fetchModels = () =>
    run(async () => {
      let saved = current?.id;
      if (needsKey || current?.status !== "ready") {
        saved = (await api.save(draft, saved)) || undefined;
        if (!saved) return setNotice("已取消，未保存密钥。");
        setId(saved);
        set({ base });
      }
      setFetched(await api.fetchModels(saved!, AbortSignal.timeout(60_000)));
    });

  const keyState = !current
    ? "保存时在系统面板中录入；密钥只存于系统凭据库。"
    : needsKey
      ? current.status === "missing"
        ? "没有找到已保存的密钥，保存时重新录入。"
        : "地址或格式已改，保存时需要重新录入。"
      : current.status === "ready"
        ? "已录入，保存在系统凭据库。"
        : "待核对，可重新录入。";
  return (
    <form
      className={`dialog-content ${s.form}`}
      aria-label={current ? `编辑 ${current.name}` : "添加服务商"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <section className={s.section} aria-labelledby={`${ids}-basic`}>
        <h3 id={`${ids}-basic`}>基本信息</h3>
        {current ? (
          <p className={s.readonly}>
            服务商：<strong>{preset?.label ?? "自定义"}</strong>
          </p>
        ) : (
          <div className="field">
            <span aria-hidden>预设服务商</span>
            <Select
              label="服务商"
              value={draft.preset}
              disabled={busy}
              options={api.presets.map((item) => ({
                value: item.id,
                label: item.label,
              }))}
              onChange={(id) =>
                setDraft({ ...fromPreset(api, id), models: draft.models })
              }
            />
            <span className={s.hint}>
              {custom
                ? "自定义服务需要填写请求地址并选择 API 格式。"
                : "请求地址已预设，只需录入 API Key 并添加模型。"}
            </span>
          </div>
        )}
        <div className={s.pair}>
          <label className="field">
            名称
            <input
              value={draft.name}
              maxLength={40}
              required
              disabled={busy}
              placeholder="例如：DeepSeek 官方"
              onChange={(e) => set({ name: e.target.value })}
            />
          </label>
          <label className="field">
            备注
            <input
              value={draft.notes}
              maxLength={80}
              disabled={busy}
              placeholder="可选，例如：公司账号"
              onChange={(e) => set({ notes: e.target.value })}
            />
          </label>
        </div>
        <label className="field">
          官网链接
          <input
            value={draft.website}
            type="url"
            maxLength={200}
            disabled={busy}
            placeholder="可选，https://"
            onChange={(e) => set({ website: e.target.value.trim() })}
          />
        </label>
      </section>

      <section className={s.section} aria-labelledby={`${ids}-connection`}>
        <h3 id={`${ids}-connection`}>连接</h3>
        {custom && (
          <div className="field">
            <span aria-hidden>API 格式</span>
            <Select
              label="API 格式"
              value={draft.protocol}
              disabled={busy}
              options={api.formats.map((item) => ({
                value: item.protocol,
                label: item.label,
              }))}
              onChange={(protocol) =>
                set({ protocol: protocol as ProviderDraft["protocol"] })
              }
            />
          </div>
        )}
        <div className="field">
          <label htmlFor={`${ids}-base`}>请求地址</label>
          <input
            id={`${ids}-base`}
            aria-describedby={`${ids}-target`}
            value={draft.base}
            type="url"
            required
            disabled={busy}
            placeholder={
              draft.protocol === "anthropic-messages"
                ? "https://api.example.com"
                : "https://api.example.com/v1"
            }
            onChange={(e) => set({ base: e.target.value })}
            onBlur={() => set({ base })}
          />
          <span id={`${ids}-target`} className={s.hint}>
            {target
              ? `对话请求发往 ${target}`
              : "填写服务商文档中的 Base URL；粘贴完整地址也可以。"}
          </span>
        </div>
        <div className={s.key} role="group" aria-labelledby={`${ids}-key`}>
          <div className={s.keyText}>
            <span id={`${ids}-key`} className={s.label}>
              API Key
            </span>
            <span className={s.hint}>{keyState}</span>
            {preset?.keyUrl && (
              <span className={s.hint}>
                在 <span className={s.url}>{preset.keyUrl}</span> 创建
              </span>
            )}
          </div>
          {current && !needsKey && (
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => void save(true)}
            >
              重新录入密钥
            </button>
          )}
        </div>
      </section>

      <section className={s.section} aria-labelledby={`${ids}-models`}>
        <div className={s.sectionHeader}>
          <h3 id={`${ids}-models`}>
            模型
            <span className={s.count}>
              {draft.models.length}/{MAX_MODELS}
            </span>
          </h3>
          <button
            type="button"
            className="secondary"
            disabled={busy || !target}
            onClick={() => void fetchModels()}
          >
            <Icon name="search" size={16} />
            获取模型列表
          </button>
        </div>
        {needsKey && (
          <p className={s.hint}>获取前会先保存，并在系统面板中录入 API Key。</p>
        )}
        {fetched && (
          <ModelPicker
            available={fetched}
            added={draft.models}
            onAdd={(names) => {
              set({ models: [...draft.models, ...names] });
              setFetched(null);
            }}
            onClose={() => setFetched(null)}
          />
        )}
        <ModelList
          models={draft.models}
          disabled={busy}
          onChange={(models) => set({ models })}
        />
      </section>

      <details className={s.advanced}>
        <summary>高级选项</summary>
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
        <p className={s.hint}>
          上下文轮数是每次随消息一起发送的最近几轮对话，0
          表示只发当前这一句；总量超过 64 KiB 时自动丢弃最早的轮次。
        </p>
      </details>

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <div className={s.footer}>
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => onDone("")}
        >
          返回
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "请稍候…" : needsKey ? "保存并录入密钥" : "保存"}
        </button>
      </div>
    </form>
  );
}
