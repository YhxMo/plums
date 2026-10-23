import { useId, useState } from "react";
import { ChevronDownIcon, ListPlusIcon, XIcon } from "lucide-react";
import type {
  ListedModel,
  ModelConnectionsApi,
} from "@modules/models/extension";
import { chatTarget, normalizeBase } from "@modules/models/addresses";
import { contextChoices, CUSTOM } from "@modules/models/presets";
import { tokenLabel } from "@modules/models/protocols";
import {
  limits,
  MAX_MODELS,
  type ProviderDraft,
  type ProviderView,
} from "@modules/models/providers";
import { DialogActions, DialogBody } from "@/components/Dialog";
import { Select } from "@/components/Select";
import { ActionToast } from "@/components/Toast";
import { SecretInput } from "@/components/SecretInput";
import { InfoTip } from "@/components/Tooltip";
import { useAsyncAction } from "@/components/useAsyncAction";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Field,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ModelPicker } from "./ModelPicker";
import { ThinkingSelect } from "./ThinkingSelect";
import { useRequestSignal } from "./useRequestSignal";

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
    thinking: {},
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
  thinking: provider.thinking,
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
  thinking,
  provider,
  context,
  disabled,
  onChange,
}: {
  models: string[];
  windows: Record<string, number>;
  thinking: ProviderDraft["thinking"];
  provider: Pick<ProviderDraft, "protocol" | "preset">;
  context: number;
  disabled: boolean;
  onChange: (
    patch: Pick<ProviderDraft, "models" | "windows" | "thinking">,
  ) => void;
}) {
  const without = <T,>(of: Record<string, T>, model: string) =>
    Object.fromEntries(Object.entries(of).filter(([name]) => name !== model));
  const [name, setName] = useState("");
  const value = name.trim();
  const full = models.length >= MAX_MODELS;
  const add = () => {
    if (!value || models.includes(value) || full) return;
    onChange({ models: [...models, value], windows, thinking });
    setName("");
  };
  return (
    <>
      {models.length > 0 && (
        <ul
          className="divide-y overflow-hidden rounded-lg bg-card shadow-panel"
          aria-label="已添加的模型"
        >
          {models.map((model) => (
            <li
              key={model}
              className="flex flex-wrap items-center gap-2 py-1 pr-1 pl-3 text-[13px]"
            >
              <span className="min-w-0 flex-1 basis-40 break-all">{model}</span>
              <span className="w-44 shrink-0">
                <ThinkingSelect
                  model={model}
                  provider={provider}
                  value={thinking[model]}
                  disabled={disabled}
                  onChange={(mode) =>
                    onChange({
                      models,
                      windows,
                      thinking: mode
                        ? { ...thinking, [model]: mode }
                        : without(thinking, model),
                    })
                  }
                />
              </span>
              <span className="w-33 shrink-0">
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
                      thinking,
                      windows: value
                        ? { ...windows, [model]: Number(value) }
                        : without(windows, model),
                    })
                  }
                />
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={`移除 ${model}`}
                disabled={disabled}
                onClick={() =>
                  onChange({
                    models: models.filter((m) => m !== model),
                    windows: without(windows, model),
                    thinking: without(thinking, model),
                  })
                }
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <Input
          aria-label="模型名"
          className="max-md:h-11"
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
        <Button
          type="button"
          variant="outline"
          disabled={disabled || full || !value || models.includes(value)}
          onClick={add}
        >
          添加模型
        </Button>
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
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction();
  const requestSignal = useRequestSignal();
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
      const saved = await api.save(draft, current?.id, typed);
      setKey("");
      onDone(
        api.list().find((item) => item.id === saved)?.status === "pending"
          ? "配置已保存，连接状态待核对。"
          : "已保存。",
      );
    });
  const fetchModels = () =>
    run(async () => {
      const signal = requestSignal();
      let saved = current?.id;
      if (needsKey || typed || current?.status !== "ready") {
        saved = await api.save(draft, saved, typed);
        setKey("");
        setId(saved);
        set({ base });
      }
      setFetched(await api.fetchModels(saved!, signal));
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
      aria-label={current ? `编辑 ${current.name}` : "添加服务商"}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <DialogBody className="gap-5">
        <FieldSet className="gap-3">
          <FieldLegend>基本信息</FieldLegend>
          {current ? (
            <p className="text-[13px] text-muted-foreground">
              服务商：
              <strong className="font-medium text-foreground">
                {preset?.label ?? "自定义"}
              </strong>
            </p>
          ) : (
            <Field>
              <FieldTitle>
                <span aria-hidden>预设服务商</span>
                <InfoTip
                  label="服务商"
                  text={
                    custom
                      ? "自定义服务需要填写请求地址并选择 API 格式。"
                      : "请求地址已预设，只需录入 API Key 并添加模型。"
                  }
                />
              </FieldTitle>
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
            </Field>
          )}
          <div className="grid grid-cols-2 gap-3 max-form:grid-cols-1">
            <Field>
              <FieldLabel htmlFor={`${ids}-name`}>名称</FieldLabel>
              <Input
                id={`${ids}-name`}
                value={draft.name}
                maxLength={40}
                required
                disabled={busy}
                placeholder="例如：DeepSeek 官方"
                onChange={(e) => set({ name: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${ids}-notes`}>备注</FieldLabel>
              <Input
                id={`${ids}-notes`}
                value={draft.notes}
                maxLength={80}
                disabled={busy}
                placeholder="可选，例如：公司账号"
                onChange={(e) => set({ notes: e.target.value })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor={`${ids}-website`}>官网链接</FieldLabel>
            <Input
              id={`${ids}-website`}
              value={draft.website}
              type="url"
              maxLength={200}
              disabled={busy}
              placeholder="可选，https://"
              onChange={(e) => set({ website: e.target.value.trim() })}
            />
          </Field>
        </FieldSet>

        <FieldSeparator />
        <FieldSet className="gap-3">
          <FieldLegend>连接</FieldLegend>
          {custom && (
            <Field>
              <FieldTitle aria-hidden>API 格式</FieldTitle>
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
            </Field>
          )}
          <Field>
            <FieldLabel htmlFor={`${ids}-base`}>请求地址</FieldLabel>
            <Input
              id={`${ids}-base`}
              aria-describedby={`${ids}-target`}
              className="font-mono text-[13px]"
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
            <FieldDescription
              id={`${ids}-target`}
              className="text-xs break-all"
            >
              {target
                ? `对话请求发往 ${target}`
                : "填写服务商文档中的 Base URL；粘贴完整地址也可以。"}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${ids}-key`}>API Key</FieldLabel>
            <SecretInput
              id={`${ids}-key`}
              aria-describedby={`${ids}-key-state`}
              value={key}
              maxLength={4096}
              required={needsKey}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              placeholder={needsKey ? "粘贴 API Key" : "已保存，留空保持不变"}
              onChange={(e) => setKey(e.target.value)}
            />
            <FieldDescription
              id={`${ids}-key-state`}
              className="text-xs break-words"
            >
              {keyState}
              {preset?.keyUrl && (
                <>
                  {" "}
                  在{" "}
                  <span className="font-mono break-all">
                    {preset.keyUrl}
                  </span>{" "}
                  创建。
                </>
              )}
            </FieldDescription>
          </Field>
        </FieldSet>

        <FieldSeparator />
        <FieldSet className="gap-3">
          <div className="flex items-center justify-between gap-3">
            <FieldLegend className="mb-0 flex items-center gap-2">
              模型
              <Badge variant="secondary" className="font-normal tabular-nums">
                {draft.models.length}/{MAX_MODELS}
              </Badge>
            </FieldLegend>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy || !target}
              onClick={() => void fetchModels()}
            >
              <ListPlusIcon data-icon="inline-start" />
              获取模型列表
            </Button>
          </div>
          {needsKey && (
            <FieldDescription className="text-xs">
              获取前会先用上面的 API Key 保存此服务商。
            </FieldDescription>
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
            thinking={draft.thinking}
            provider={draft}
            context={draft.context}
            disabled={busy}
            onChange={set}
          />
          <Field>
            <FieldTitle>
              <span aria-hidden>默认上下文窗口</span>
              <InfoTip
                label="默认上下文窗口"
                text="模型能接收的总 token 数。获取列表时按 models.dev 为每个模型填好；没有填的模型用这里的默认值，可按服务商文档调整。每次发送整段对话，服务商会缓存重复的部分；接近上限时一次丢弃较早的一批轮次。"
              />
            </FieldTitle>
            <Select
              label="默认上下文窗口"
              value={String(draft.context)}
              disabled={busy}
              options={windowChoices(draft.context)}
              onChange={(value) => set({ context: Number(value) })}
            />
          </Field>
        </FieldSet>

        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group -ml-2 text-muted-foreground"
            >
              高级选项
              <ChevronDownIcon
                data-icon="inline-end"
                className="transition-transform group-data-[state=open]:rotate-180"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Field>
              <FieldTitle>
                <label htmlFor={`${ids}-max-tokens`}>最大输出 token</label>
                <InfoTip
                  label="最大输出 token"
                  text="一般留空。Anthropic 格式必须填写时按上下文窗口留出（最多 32K）。"
                />
              </FieldTitle>
              <Input
                id={`${ids}-max-tokens`}
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
            </Field>
          </CollapsibleContent>
        </Collapsible>
      </DialogBody>

      <ActionToast
        error={error}
        notice={notice}
        onDone={() => {
          setError("");
          setNotice("");
        }}
      />
      <DialogActions>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => onDone("")}
        >
          返回
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "请稍候…" : "保存"}
        </Button>
      </DialogActions>
    </form>
  );
}
