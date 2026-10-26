import { useState, type ReactNode } from "react";
import type { AgentConfig, AgentProvider } from "@modules/agents/contract";
import { MAX_INSTRUCTIONS } from "@modules/agents/instructions";
import type { Named } from "@modules/sdk";
import { DialogActions, DialogBody } from "@/components/Dialog";
import { InfoTip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldLabel } from "@/components/ui/field";
import { AgentParts } from "./AgentParts";
import { Avatar } from "./Avatar";
import { ModelPageItems, ModelSelect, type ModelPage } from "./ModelSelect";
import { useAgentDraft } from "./draft";
import { agentParts, switchPart, type Part } from "./parts";
import { DESCRIPTION_TIP, INSTRUCTIONS_TIP } from "./tips";
import type { RoleCardDraft } from "./useRoleCardDraft";

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

/** Opens the one page to add models on, or lets the user pick among several. */
function ConnectButton({
  pages,
  children,
}: {
  pages: readonly ModelPage[];
  children: ReactNode;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="xs"
      className="-mr-2 text-muted-foreground"
      onClick={pages.length === 1 ? pages[0].open : undefined}
    >
      {children}
    </Button>
  );
  if (pages.length === 1) return button;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ModelPageItems pages={pages} />
      </DropdownMenuContent>
    </DropdownMenu>
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
  modelPages,
  onAdd,
  onError,
}: {
  api: AgentProvider;
  /** The interface showing the Agent, one of its parts. */
  ui?: Named;
  busy: boolean;
  onBack: () => void;
  /** Pages to add models on, opened over this step, which stays as it is. */
  modelPages?: readonly ModelPage[];
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
              {modelPages && (
                <ConnectButton pages={modelPages}>
                  {models.length ? "管理模型连接" : "添加模型连接"}
                </ConnectButton>
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
        {draft.notes.length > 0 && (
          <ul className="grid gap-1 text-xs text-muted-foreground">
            {draft.notes.map((note) => (
              <li key={note.id} role="note">
                {note.text}
              </li>
            ))}
          </ul>
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

/**
 * Getting a role card, which then fills in the add steps: a picture card
 * (PNG) or its JSON, chosen, dropped, read from a link in the app or pasted.
 */
export function ImportStep({
  card,
  busy,
  leave,
  onRead,
  onNext,
}: {
  card: RoleCardDraft;
  busy: boolean;
  leave: ReactNode;
  /** Runs a file read, reporting what goes wrong. */
  onRead: (read: () => Promise<void>) => void;
  onNext: () => void;
}) {
  const { raw, url, setRaw, setUrl, reading, readLink, readFile } = card;
  const [dragging, setDragging] = useState(false);
  const idle = !busy && !reading;
  const read = (file?: File) => {
    if (file && idle) onRead(() => readFile(file));
  };
  return (
    <form
      key="import"
      onSubmit={(e) => {
        e.preventDefault();
        if (raw.trim()) onNext();
      }}
    >
      <DialogBody className="gap-[18px]">
        <label
          data-dragging={dragging || undefined}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setDragging(false);
            read(event.dataTransfer.files[0]);
          }}
          className="flex h-18 w-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-input bg-surface text-sm font-medium hover:bg-muted has-[input:disabled]:cursor-default has-[input:disabled]:opacity-50 has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50 data-dragging:border-ring data-dragging:bg-muted"
        >
          选择或拖入角色卡
          <input
            className="sr-only"
            aria-label="角色卡文件"
            disabled={!idle}
            type="file"
            accept=".png,.json,.plums,image/png,application/json,application/zip"
            onChange={(e) => {
              read(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <Field>
          <FieldLabel htmlFor="role-card-url">链接</FieldLabel>
          <div className="flex gap-2">
            <Input
              id="role-card-url"
              disabled={!idle}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="/cards/example.json"
            />
            <Button
              type="button"
              variant="outline"
              disabled={!idle || !url.trim()}
              onClick={() => void readLink()}
            >
              {reading ? "读取中…" : "读取"}
            </Button>
          </div>
        </Field>
        <Field>
          <FieldLabel htmlFor="role-card-raw">内容</FieldLabel>
          <Textarea
            id="role-card-raw"
            className="max-h-60 min-h-24 font-mono text-xs"
            disabled={!idle}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="粘贴角色卡内容"
          />
        </Field>
      </DialogBody>
      <DialogActions>
        {leave}
        <Button type="submit" disabled={!idle || !raw.trim()}>
          下一步
        </Button>
      </DialogActions>
    </form>
  );
}
