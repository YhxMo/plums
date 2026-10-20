import { useId, useState } from "react";
import type {
  ListedModel,
  ModelConnectionsApi,
} from "../../modules/models/extension";
import { chatTarget, normalizeBase } from "../../modules/models/addresses";
import { contextChoices, CUSTOM } from "../../modules/models/presets";
import { tokenLabel } from "../../modules/models/protocols";
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
    windows: {},
    maxTokens: null,
    context: preset.context,
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
  windows: provider.windows,
  maxTokens: provider.maxTokens,
  context: provider.context,
});

const windowChoices = (...extra: number[]) =>
  [...new Set<number>([...contextChoices, ...extra])]
    .sort((a, b) => a - b)
    .map((tokens) => ({ value: String(tokens), label: tokenLabel(tokens) }));

/**
 * Model names of one provider, each with its own window or the default:
 * type to add, or pick from the fetched list.
 */
function ModelList({
  models,
  windows,
  context,
  disabled,
  onChange,
}: {
  models: string[];
  windows: Record<string, number>;
  context: number;
  disabled: boolean;
  onChange: (patch: Pick<ProviderDraft, "models" | "windows">) => void;
}) {
  const without = (model: string) =>
    Object.fromEntries(
      Object.entries(windows).filter(([name]) => name !== model),
    );
  const [name, setName] = useState("");
  const value = name.trim();
  const full = models.length >= MAX_MODELS;
  const add = () => {
    if (!value || models.includes(value) || full) return;
    onChange({ models: [...models, value], windows });
    setName("");
  };
  return (
    <>
      {models.length > 0 && (
        <ul className={s.modelList} aria-label="已添加的模型">
          {models.map((model) => (
            <li key={model}>
              <span className={s.modelName}>{model}</span>
              <span className={s.modelWindow}>
                <Select
                  label={`${model} 的上下文窗口`}
                  value={
                    Object.hasOwn(windows, model) ? String(windows[model]) : ""
                  }
                  disabled={disabled}
                  options={[
                    { value: "", label: `默认（${tokenLabel(context)}）` },
                    ...windowChoices(
                      ...(Object.hasOwn(windows, model)
                        ? [windows[model]]
                        : []),
                    ),
                  ]}
                  onChange={(value) =>
                    onChange({
                      models,
                      windows: value
                        ? { ...windows, [model]: Number(value) }
                        : without(model),
                    })
                  }
                />
              </span>
              <button
                type="button"
                className="icon-button"
                aria-label={`移除 ${model}`}
                disabled={disabled}
                onClick={() =>
                  onChange({
                    models: models.filter((m) => m !== model),
                    windows: without(model),
                  })
                }
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
 * The key is write-only: saved natively, never shown again.
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
  const [fetched, setFetched] = useState<ListedModel[] | null>(null);
  const [key, setKey] = useState("");
  const { busy, error, notice, run } = useAsyncAction();
  const set = (patch: Partial<ProviderDraft>) =>
    setDraft((value) => ({ ...value, ...patch }));
  const preset = api.presets.find((p) => p.id === draft.preset);
  const custom = draft.preset === CUSTOM;
  const base = normalizeBase(draft.protocol, draft.base);
  const target = /^https:\/\/[^/?#:@\s]+/.test(base)
    ? chatTarget(draft.protocol, base)
    : "";
  // A key must be typed when any of these change.
  const needsKey =
    !current ||
    current.status === "missing" ||
    current.status === "changed" ||
    current.base !== base ||
    current.protocol !== draft.protocol;

  const typed = key.trim() || undefined;
  const save = () =>
    run(async () => {
      await api.save(draft, current?.id, typed);
      setKey("");
      onDone("已保存。");
    });
  const fetchModels = () =>
    run(async () => {
      let saved = current?.id;
      if (needsKey || typed || current?.status !== "ready") {
        saved = await api.save(draft, saved, typed);
        setKey("");
        setId(saved);
        set({ base });
      }
      setFetched(await api.fetchModels(saved!, AbortSignal.timeout(60_000)));
    });

  const keyState = !current
    ? "只保存在本机，用于向上面的地址发送请求，之后不再显示。"
    : needsKey
      ? current.status === "missing"
        ? "没有找到已保存的 API Key，请重新填写。"
        : "地址或格式已改，请重新填写 API Key。"
      : current.status === "ready"
        ? "已保存。留空保持不变，填写新的 Key 则替换。"
        : "待核对，可重新填写。";
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
        <div className="field">
          <label htmlFor={`${ids}-key`}>API Key</label>
          <input
            id={`${ids}-key`}
            aria-describedby={`${ids}-key-state`}
            type="password"
            value={key}
            maxLength={4096}
            required={needsKey}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder={needsKey ? "粘贴 API Key" : "已保存，留空保持不变"}
            onChange={(e) => setKey(e.target.value)}
          />
          <span id={`${ids}-key-state`} className={s.hint}>
            {keyState}
            {preset?.keyUrl && (
              <>
                {" "}
                在 <span className={s.url}>{preset.keyUrl}</span> 创建。
              </>
            )}
          </span>
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
          <p className={s.hint}>获取前会先用上面的 API Key 保存此服务商。</p>
        )}
        {fetched && (
          <ModelPicker
            available={fetched}
            added={draft.models}
            onAdd={(picked) => {
              set({
                models: [...draft.models, ...picked.map(({ name }) => name)],
                windows: {
                  ...draft.windows,
                  ...Object.fromEntries(
                    picked.flatMap(({ name, context }) =>
                      context ? [[name, context]] : [],
                    ),
                  ),
                },
              });
              setFetched(null);
            }}
            onClose={() => setFetched(null)}
          />
        )}
        <ModelList
          models={draft.models}
          windows={draft.windows}
          context={draft.context}
          disabled={busy}
          onChange={set}
        />
        <div className="field">
          <span aria-hidden>默认上下文窗口</span>
          <Select
            label="默认上下文窗口"
            value={String(draft.context)}
            disabled={busy}
            options={windowChoices(draft.context)}
            onChange={(value) => set({ context: Number(value) })}
          />
          <span className={s.hint}>
            模型能接收的总 token 数。获取列表时按 models.dev
            为每个模型填好；没有填的模型用这里的默认值，可按服务商文档调整。每次发送整段对话，服务商会缓存重复的部分；接近上限时一次丢弃较早的一批轮次。
          </span>
        </div>
      </section>

      <details className={s.advanced}>
        <summary>高级选项</summary>
        <label className="field">
          最大输出 token
          <input
            type="number"
            min={limits.maxTokens[0]}
            max={limits.maxTokens[1]}
            value={draft.maxTokens ?? ""}
            placeholder="由服务决定"
            disabled={busy}
            onChange={(e) =>
              set({
                maxTokens:
                  e.target.value === "" ? null : e.target.valueAsNumber,
              })
            }
          />
        </label>
        <p className={s.hint}>
          一般留空。Anthropic 格式必须填写时按上下文窗口留出（最多 32K）。
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
          {busy ? "请稍候…" : "保存"}
        </button>
      </div>
    </form>
  );
}
