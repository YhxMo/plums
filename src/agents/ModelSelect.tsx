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
}: {
  label: string;
  models: readonly ModelChoice[];
  value: AgentModel | null | undefined;
  onChange: (model: AgentModel | null) => void;
  disabled?: boolean;
}) {
  const current = value ? key(value) : "";
  const choice = models.find((m) => choiceKey(m) === current);
  const missing = !!value && !choice;
  return (
    <div className="grid gap-1.5">
      <Select
        label={label}
        value={current}
        disabled={disabled}
        options={[
          { value: "", label: "未选择" },
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
