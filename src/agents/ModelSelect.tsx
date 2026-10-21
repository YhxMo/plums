import { cn } from "cn";
import type { AgentModel, ModelChoice } from "../../modules/agents/contract";
import { Select } from "../components/Select";

const key = (model: AgentModel) => `${model.provider}\n${model.model}`;
const choiceKey = (m: ModelChoice) =>
  key({ provider: m.provider, model: m.id });

/** Picks one of the available models, or none; explains a missing choice. */
export function ModelSelect({
  label,
  models,
  value,
  onChange,
  disabled,
  compact,
}: {
  label: string;
  models: readonly ModelChoice[];
  value: AgentModel | null | undefined;
  onChange: (model: AgentModel | null) => void;
  disabled?: boolean;
  /** A borderless picker for a toolbar, without the explanation below. */
  compact?: boolean;
}) {
  const current = value ? key(value) : "";
  const choice = models.find((m) => choiceKey(m) === current);
  const missing = !!value && !choice;
  const select = (
    <Select
      label={label}
      value={current}
      disabled={disabled}
      size={compact ? "sm" : undefined}
      className={
        compact
          ? cn(
              "w-auto max-w-56 border-transparent bg-transparent text-[13px] text-foreground/80 shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted max-md:max-w-44 dark:bg-transparent",
              choice && "pl-8",
            )
          : undefined
      }
      options={[
        { value: "", label: compact ? "未选择模型" : "未选择" },
        ...(missing ? [{ value: current, label: "已不可用的模型" }] : []),
        ...models.map((m) => ({
          value: choiceKey(m),
          label: m.label,
          description: m.description,
          group: m.group,
        })),
      ]}
      onChange={(next) => {
        const picked = models.find((m) => choiceKey(m) === next);
        onChange(
          picked ? { provider: picked.provider, model: picked.id } : null,
        );
      }}
    />
  );
  if (compact)
    return (
      <span className="relative inline-flex min-w-0">
        {/* The service's first letter stands in for an icon; models carry none. */}
        {choice && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2 grid size-[18px] -translate-y-1/2 place-items-center rounded-[5px] bg-brand-soft text-[11px] font-bold text-brand-text"
          >
            {[...choice.providerLabel][0]}
          </span>
        )}
        {select}
      </span>
    );
  return (
    <div className="grid gap-1.5">
      {select}
      {!choice && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {missing
            ? "所选模型已删除或其连接已停用，请重新选择。"
            : models.length
              ? "选择一个模型后此 Agent 才能回复；最近的对话与角色说明会发送给它。"
              : "还没有可选的模型：添加服务商和它的模型后即可选择。"}
        </p>
      )}
    </div>
  );
}
