import { cn } from "cn";
import type { Effort } from "../../modules/agents/contract";
import { Select } from "../components/Select";

const names: Record<Effort, { label: string; description: string }> = {
  off: { label: "关闭", description: "不思考，直接回复，更快更省" },
  low: { label: "低", description: "简单想一下" },
  medium: { label: "中", description: "兼顾速度与质量" },
  high: { label: "高", description: "认真思考，回复更慢" },
  max: { label: "最大", description: "尽可能深入，最慢也最费用" },
};

/** Picks how much the Agent's model thinks, from the strengths that model takes. */
export function EffortSelect({
  levels,
  value,
  onChange,
  disabled,
}: {
  levels: readonly Effort[];
  value: Effort | undefined;
  onChange: (effort: Effort | null) => void;
  disabled?: boolean;
}) {
  // A kept choice the current model does not list counts as unset.
  const current = value && levels.includes(value) ? value : "";
  return (
    <Select
      label="思考强度"
      value={current}
      disabled={disabled}
      size="sm"
      className={cn(
        "w-auto border-transparent bg-transparent text-[13px] text-foreground/80 shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:bg-transparent",
      )}
      options={[
        { value: "", label: "思考 · 默认", description: "由模型服务决定" },
        ...levels.map((level) => ({
          value: level,
          label: `思考 · ${names[level].label}`,
          description: names[level].description,
        })),
      ]}
      onChange={(next) => onChange(next ? (next as Effort) : null)}
    />
  );
}
