import { cn } from "cn";
import { ChevronDownIcon } from "lucide-react";
import type { AgentModel, ModelChoice } from "@modules/agents/contract";
import { Select } from "@/components/Select";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Where models are added: a connector's own page, or the extensions when none has one. */
export type ModelPage = { label: string; open: () => void };

/** The pages to add models on, one item each, or a single 「连接模型」. */
export function ModelPageItems({ pages }: { pages: readonly ModelPage[] }) {
  return pages.length === 1 ? (
    <DropdownMenuItem onSelect={pages[0].open}>连接模型</DropdownMenuItem>
  ) : (
    pages.map((page, i) => (
      <DropdownMenuItem key={i} onSelect={page.open}>
        {page.label}
      </DropdownMenuItem>
    ))
  );
}

const key = (model: AgentModel) => `${model.provider}\n${model.model}`;
const choiceKey = (m: ModelChoice) =>
  key({ provider: m.provider, model: m.id });

/** Picks one of the available models, or none; explains a missing choice. */
export function ModelSelect({
  label,
  models,
  value,
  onChange,
  connect,
  disabled,
  compact,
}: {
  label: string;
  models: readonly ModelChoice[];
  value: AgentModel | null | undefined;
  onChange: (model: AgentModel | null) => void;
  /** An empty composer picker can open these without replacing the input. */
  connect?: readonly ModelPage[];
  disabled?: boolean;
  /** A borderless picker for a toolbar, without the explanation below. */
  compact?: boolean;
}) {
  const current = value ? key(value) : "";
  const choice = models.find((m) => choiceKey(m) === current);
  const missing = !!value && !choice;
  if (compact && !models.length && connect)
    return (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={label}
            disabled={disabled}
            className="gap-1.5 text-sm font-normal text-foreground/80"
          >
            {missing ? "已不可用的模型" : "未选择模型"}
            <ChevronDownIcon className="size-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start">
          <ModelPageItems pages={connect} />
        </DropdownMenuContent>
      </DropdownMenu>
    );
  const select = (
    <Select
      label={label}
      value={current}
      disabled={disabled}
      size={compact ? "sm" : undefined}
      className={
        compact
          ? cn(
              "w-auto max-w-56 border-transparent bg-transparent text-sm text-foreground/80 shadow-none hover:bg-muted hover:text-foreground aria-expanded:bg-muted max-md:max-w-44 dark:bg-transparent",
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
  if (compact) return select;
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
