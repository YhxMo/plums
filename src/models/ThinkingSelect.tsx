import {
  THINK_STYLES,
  levelsOf,
  type Effort,
  reasoningLevels,
  type ThinkMode,
} from "@modules/models/reasoning";
import type { ProviderDraft } from "@modules/models/providers";
import { Select, type SelectOption } from "@/components/Select";

const names: Record<Effort, string> = {
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
  max: "最大",
};
const list = (levels: readonly Effort[] | undefined) =>
  levels ? levels.map((level) => names[level]).join("/") : "无";

const ways = {
  openai: { suffix: "OpenAI 兼容", note: "发送 reasoning_effort" },
  deepseek: {
    suffix: "DeepSeek 式",
    note: "发送 thinking 开关与 reasoning_effort",
  },
  adaptive: {
    suffix: "Claude 自适应",
    note: "发送 thinking: adaptive 与 effort",
  },
  budget: {
    suffix: "Claude 思考预算",
    note: "发送 thinking 预算，按档位取 token",
  },
} as const;

/**
 * How one model thinks: what the app's rules decide for its service and
 * name, no control at all, or a way the user picks for a service the rules
 * do not cover. Only ways written for the provider's API format are offered.
 */
export function ThinkingSelect({
  model,
  provider,
  value,
  disabled,
  onChange,
}: {
  model: string;
  provider: Pick<ProviderDraft, "protocol" | "preset">;
  value: ThinkMode | undefined;
  disabled: boolean;
  onChange: (mode: ThinkMode | undefined) => void;
}) {
  const options: SelectOption[] = [
    {
      value: "",
      label: `自动（${list(reasoningLevels(provider.protocol, provider.preset, model))}）`,
      description: "按服务商与模型名判断，未收录的不显示思考强度",
    },
    {
      value: "none",
      label: "不显示",
      description: "此模型不提供思考强度选择",
    },
    ...(Object.keys(ways) as (keyof typeof ways)[])
      .filter((way) => THINK_STYLES[way] === provider.protocol)
      .map((way) => ({
        value: way,
        label: `${list(levelsOf(way))}（${ways[way].suffix}）`,
        description: `${ways[way].note}；请确认服务支持`,
      })),
  ];
  return (
    <Select
      label={`${model} 的思考强度`}
      value={value ?? ""}
      disabled={disabled}
      options={options}
      onChange={(next) => onChange(next ? (next as ThinkMode) : undefined)}
    />
  );
}
