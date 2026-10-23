import { cn } from "cn";
import type { Effort } from "@modules/agents/contract";
import { Select } from "@/components/Select";

const names: Record<Effort, string> = {
  off: "关闭",
  low: "低",
  medium: "中",
  high: "高",
  max: "最大",
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
      prefix="思考 ·"
      value={current}
      disabled={disabled}
      size="sm"
      className={cn(
        "w-auto border-transparent bg-transparent text-[13px] text-foreground/80 shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:bg-transparent",
      )}
      options={[
        { value: "", label: "默认" },
        ...levels.map((level) => ({ value: level, label: names[level] })),
      ]}
      onChange={(next) => onChange(next ? (next as Effort) : null)}
    />
  );
}
