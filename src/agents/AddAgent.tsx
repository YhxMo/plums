import type { ReactNode } from "react";
import type { AgentConfig, AgentProvider } from "@modules/agents/contract";
import { MAX_INSTRUCTIONS } from "@modules/agents/instructions";
import type { Named } from "@modules/sdk";
import { DialogActions, DialogBody } from "@/components/Dialog";
import { InfoTip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { AgentParts } from "./AgentParts";
import { Avatar } from "./Avatar";
import { ModelSelect } from "./ModelSelect";
import { useAgentDraft } from "./draft";
import { agentParts, switchPart, type Part } from "./parts";
import { DESCRIPTION_TIP, INSTRUCTIONS_TIP } from "./tips";

/** A field's name with its explanation behind ⓘ. */
function Label({
  htmlFor,
  tip,
  children,
}: {
  htmlFor: string;
  tip?: string;
  children: string;
}) {
  return (
    <span className="flex items-center gap-1">
      <FieldLabel htmlFor={htmlFor}>{children}</FieldLabel>
      {tip && <InfoTip label={children} text={tip} />}
    </span>
  );
}

/**
 * The first step of adding an Agent: who it is. Name, 设定 and 介绍, with a
 * role card's picture when it brought one.
 */
export function DescribeStep({
  leave,
  onNext,
}: {
  /** 取消, or 上一步 when a step came before. */
  leave: ReactNode;
  onNext: () => void;
}) {
  const draft = useAgentDraft();
  return (
    <form
      key="describe"
      onSubmit={(e) => {
        e.preventDefault();
        if (draft.name.trim()) onNext();
      }}
    >
      <DialogBody className="gap-[18px]">
        {draft.avatar && (
          <Avatar
            agent={{ name: draft.name, avatar: draft.avatar }}
            className="size-12"
          />
        )}
        <Field>
          <Label htmlFor="agent-name">名称</Label>
          <Input
            id="agent-name"
            autoFocus
            value={draft.name}
            onChange={(e) => draft.change({ name: e.target.value })}
            maxLength={60}
            placeholder="例如：写作助手"
            required
          />
        </Field>
        <Field>
          <Label htmlFor="agent-instructions" tip={INSTRUCTIONS_TIP}>
            设定
          </Label>
          <Textarea
            id="agent-instructions"
            value={draft.instructions}
            onChange={(e) => draft.change({ instructions: e.target.value })}
            maxLength={MAX_INSTRUCTIONS}
            className="max-h-60 min-h-20"
          />
        </Field>
        <Field>
          <Label htmlFor="agent-description" tip={DESCRIPTION_TIP}>
            介绍
          </Label>
          <Textarea
            id="agent-description"
            value={draft.description}
            onChange={(e) => draft.change({ description: e.target.value })}
            maxLength={4000}
            placeholder="它能帮你做什么"
            className="min-h-14"
          />
        </Field>
      </DialogBody>
      <DialogActions>
        {leave}
        <Button type="submit" disabled={!draft.name.trim()}>
          下一步
        </Button>
      </DialogActions>
    </form>
  );
}

/**
 * The second step: the model the Agent replies with and the installed
 * extensions it is composed of, each switched on as the default set has it.
 */
export function ComposeStep({
  api,
  ui,
  busy,
  onBack,
  onModels,
  onAdd,
  onError,
}: {
  api: AgentProvider;
  /** The interface showing the Agent, one of its parts. */
  ui?: Named;
  busy: boolean;
  onBack: () => void;
  /** Leaves for the model connections; the draft waits. */
  onModels?: () => void;
  onAdd: (config: AgentConfig) => void;
  onError: (message: string) => void;
}) {
  const draft = useAgentDraft();
  const models = api.modelChoices?.();
  // Unchosen fields show what the provider would pick on its own.
  const [first] = models ?? [];
  const model =
    draft.model === undefined
      ? first
        ? { provider: first.provider, model: first.id }
        : null
      : draft.model;
  const parts = agentParts({
    provider: api.info.extensions ?? [],
    ui,
    api,
    model,
    memories: (api.memories?.() ?? []).map((choice) => ({ choice })),
    off: draft.off,
  });
  function switchDraftPart(part: Part, on: boolean) {
    try {
      const next = switchPart(part, on, api, model);
      const off = draft.off.filter((id) => id !== part.choice.id);
      draft.change({
        off: next.off ? [...off, part.choice.id] : off,
        ...(next.model && { model: next.model }),
      });
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    }
  }
  const name = draft.name.trim();
  return (
    <form
      key="compose"
      onSubmit={(e) => {
        e.preventDefault();
        onAdd({
          name: draft.name,
          description: draft.description,
          instructions: draft.instructions,
          ...(draft.avatar && { avatar: draft.avatar }),
          ...(models && { model }),
          ...(api.setOff && { off: draft.off }),
        });
      }}
    >
      <DialogBody className="gap-[18px]">
        {models && (
          <Field>
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium">模型</span>
              {onModels && (
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="-mr-2 text-muted-foreground"
                  onClick={onModels}
                >
                  {models.length ? "管理模型连接" : "添加模型连接"}
                </Button>
              )}
            </span>
            <ModelSelect
              label="新 Agent 使用的模型"
              models={models}
              value={model}
              onChange={(next) =>
                draft.change({
                  model: next,
                  // Picking a model switches its connection on.
                  off: draft.off.filter((id) => id !== next?.provider),
                })
              }
            />
          </Field>
        )}
        {parts.length > 0 && (
          <Field>
            <span className="text-sm font-medium">已安装的扩展</span>
            <AgentParts
              agentName={name}
              parts={parts}
              onPart={api.setOff && switchDraftPart}
            />
          </Field>
        )}
      </DialogBody>
      <DialogActions>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          // System Back takes this step back too.
          data-dialog-back
          onClick={onBack}
        >
          上一步
        </Button>
        <Button type="submit" disabled={busy}>
          {busy ? "正在添加…" : "添加"}
        </Button>
      </DialogActions>
    </form>
  );
}
