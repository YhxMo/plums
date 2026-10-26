import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  ArrowUpIcon,
  PaperclipIcon,
  PencilIcon,
  PlusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import type {
  Agent,
  AgentModel,
  Attachment,
  Effort,
  ModelChoice,
} from "@modules/agents/contract";
import { MAX_TEXT } from "@modules/agents/validation";
import { DraftAttachments } from "./AttachmentView";
import { EffortSelect } from "./EffortSelect";
import { ModelSelect, type ModelPage } from "./ModelSelect";
import { Tooltip } from "@/components/Tooltip";
import { useMediaQuery } from "@/components/useMediaQuery";
import { appleKeyboard } from "@/components/keyboard";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";

const mac = appleKeyboard();

/** What the message box can attach; absent when the provider takes none. */
export type Attach = {
  files: readonly Attachment[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
};

/** An own message being edited: its text as sent, and how to leave. */
export type Editing = {
  original: string;
  /** It keeps files, so its text may be left empty. */
  hasFiles: boolean;
  onCancel: () => void;
};

/** Why this Agent cannot reply here yet, and the one step that fixes it. */
export type Blocked = { text: string; action: ReactNode };

/** One composer in every state; missing models or disabled parts block sending. */
export function Composer({
  agent,
  blocked,
  draft,
  onDraft,
  onSend,
  onCancel,
  models,
  modelPages,
  onModel,
  onEffort,
  attach,
  editing,
  inputRef,
}: {
  agent: Agent;
  /** Inline recovery action; drafts remain editable while sending is blocked. */
  blocked?: Blocked;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  /** Absent for providers without per-Agent models. */
  models?: readonly ModelChoice[];
  modelPages?: readonly ModelPage[];
  onModel?: (model: AgentModel | null) => void;
  /** Absent for providers that do not keep a thinking strength. */
  onEffort?: (effort: Effort | null) => void;
  attach?: Attach;
  /** Sending replaces this message; Escape or the close button leaves. */
  editing?: Editing;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  // A reply in another session leaves this one free; the workspace then
  // blocks sending with the reason.
  const busy =
    agent.status === "busy" &&
    (!agent.pending || agent.pending.sessionId === agent.currentSessionId);
  const saving = agent.canCancel === false;
  // Only a model that lists strengths gets the control; others show nothing.
  const chosen = models?.find(
    (m) => m.provider === agent.model?.provider && m.id === agent.model?.model,
  );
  const levels = chosen?.reasoning;
  // An empty catalog and an unselected model share the same composer state.
  const unpicked = models !== undefined && !!onModel && !chosen;
  // Files may go out without text.
  const content = editing ? editing.hasFiles : !!attach?.files.length;
  const canSend = (!!draft.trim() || content) && !busy && !unpicked && !blocked;
  const files = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  // Input behavior follows the device, not the width of a desktop window.
  const enterSends = useMediaQuery("(any-pointer: fine)");
  const canAttach = !!attach && !busy;
  // Files added by drop, picker or paste bring the box focus, so Enter sends
  // them; not on touch, where focus opens the keyboard, nor away from
  // another field being typed in.
  const conversation = `${agent.id}:${agent.currentSessionId}`;
  const count = attach?.files.length ?? 0;
  const counted = useRef({ conversation, count });
  useEffect(() => {
    const before = counted.current;
    counted.current = { conversation, count };
    if (conversation !== before.conversation || count <= before.count) return;
    const active = document.activeElement;
    const typing =
      active !== inputRef.current &&
      active?.matches(
        "textarea, input:not([type=file]), [contenteditable]:not([contenteditable=false])",
      );
    if (enterSends && !typing) inputRef.current?.focus();
  }, [conversation, count, enterSends, inputRef]);
  useEffect(() => {
    if (!canAttach) return;
    const open = (e: KeyboardEvent) => {
      if (
        e.key.toLowerCase() !== "u" ||
        e.shiftKey ||
        e.altKey ||
        (mac ? !e.metaKey || e.ctrlKey : !e.ctrlKey)
      )
        return;
      // The box stays mounted behind the extension manager and under dialogs;
      // only a box the person can see and reach takes the shortcut.
      if (
        !form.current?.getClientRects().length ||
        document.querySelector('[role="dialog"][aria-modal="true"]')
      )
        return;
      e.preventDefault();
      files.current?.click();
    };
    window.addEventListener("keydown", open);
    return () => window.removeEventListener("keydown", open);
  }, [canAttach]);
  return (
    <form
      ref={form}
      className="mx-auto mt-1 mb-4 w-[calc(100%-48px)] max-w-[600px] max-md:mb-[max(12px,env(safe-area-inset-bottom))] max-md:w-[calc(100%-24px)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      {/* One row on desktop: attach, text, model, send. Phones give the text
          its own row above the controls. */}
      {/* 22px round with 30px buttons 7px in: concentric corners. */}
      <InputGroup className="h-auto flex-wrap items-end gap-x-1 rounded-3xl border-input bg-chat p-[6.5px] pl-2.5 shadow-none has-disabled:bg-chat has-disabled:opacity-100 dark:bg-chat dark:has-disabled:bg-chat max-md:p-1.5">
        {blocked && (
          <div
            role="status"
            className="flex basis-full items-center justify-between gap-3 px-1.5 pt-1 pb-2 text-xs text-muted-foreground"
          >
            <p>{blocked.text}</p>
            {blocked.action}
          </div>
        )}
        {editing && (
          <div className="flex basis-full items-center gap-2 px-1.5 pt-0.5 pb-1.5 text-xs">
            <PencilIcon className="size-3.5 shrink-0 text-brand-text" />
            <div className="min-w-0 flex-1">
              <p className="font-medium text-brand-text">编辑消息</p>
              <p className="truncate text-muted-foreground">
                {editing.original}
              </p>
            </div>
            <Tooltip label="取消编辑">
              <InputGroupButton
                type="button"
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground max-md:size-11"
                aria-label="取消编辑"
                onClick={editing.onCancel}
              >
                <XIcon />
              </InputGroupButton>
            </Tooltip>
          </div>
        )}
        {attach && attach.files.length > 0 && (
          <div className="basis-full pb-1">
            <DraftAttachments
              attachments={attach.files}
              disabled={busy}
              onRemove={attach.onRemove}
            />
          </div>
        )}
        {attach && (
          <div className="flex shrink-0 max-md:order-1">
            <input
              ref={files}
              type="file"
              multiple
              hidden
              aria-label="选择文件"
              onChange={(e) => {
                attach.onAdd([...(e.target.files ?? [])]);
                e.target.value = "";
              }}
            />
            <DropdownMenu modal={false}>
              <Tooltip label="添加附件">
                <DropdownMenuTrigger asChild>
                  <InputGroupButton
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="size-[30px] rounded-full text-muted-foreground aria-expanded:bg-muted max-md:size-11"
                    aria-label="添加附件"
                    disabled={busy}
                  >
                    <PlusIcon />
                  </InputGroupButton>
                </DropdownMenuTrigger>
              </Tooltip>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuItem onSelect={() => files.current?.click()}>
                  <PaperclipIcon />
                  图片和文件
                  <DropdownMenuShortcut>
                    {mac ? "⌘U" : "Ctrl+U"}
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
        <InputGroupTextarea
          ref={inputRef}
          aria-label="消息"
          placeholder={
            unpicked
              ? `为 ${agent.name} 选一个模型，它就能回复你…`
              : `发送给 ${agent.name}…`
          }
          rows={1}
          maxLength={MAX_TEXT}
          value={draft}
          className="max-h-52 min-h-[30px] min-w-0 px-1 py-[5px] text-sm leading-5 [field-sizing:content] max-md:min-h-11 max-md:basis-full max-md:px-2 max-md:py-2.5 max-md:text-base"
          onChange={(e) => onDraft(e.target.value)}
          onPaste={(e) => {
            const pictures = [...e.clipboardData.files].filter((f) =>
              f.type.startsWith("image/"),
            );
            if (!attach || !pictures.length) return;
            e.preventDefault();
            attach.onAdd(pictures);
          }}
          onKeyDown={(e) => {
            if (editing && e.key === "Escape" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              editing.onCancel();
              return;
            }
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing &&
              // WebKit may end composition before its confirming keydown.
              e.nativeEvent.keyCode !== 229 &&
              enterSends
            ) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
        />
        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-0.5 max-md:order-1 max-md:shrink">
          {models && onModel && (
            <ModelSelect
              compact
              label="切换模型"
              models={models}
              value={agent.model}
              disabled={busy}
              onChange={onModel}
              connect={modelPages}
            />
          )}
          {levels && onEffort && (
            <EffortSelect
              levels={levels}
              value={agent.effort}
              disabled={busy}
              onChange={onEffort}
            />
          )}
          {busy ? (
            // Separate keys: a click on stop must not land on a send button in
            // the same node once the request ends.
            <Tooltip key="stop" label={saving ? "正在保存…" : "停止处理"}>
              <InputGroupButton
                type="button"
                variant="outline"
                size="icon-sm"
                className="size-[30px] rounded-full max-md:size-11"
                aria-label={saving ? "正在保存…" : "停止处理"}
                onClick={onCancel}
                disabled={saving}
              >
                <SquareIcon className="size-3 fill-current" />
              </InputGroupButton>
            </Tooltip>
          ) : (
            <Tooltip key="send" label="发送">
              <InputGroupButton
                type="submit"
                variant="default"
                size="icon-sm"
                // Grey while there is nothing to send, not a faded brand colour.
                className="size-[30px] rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 max-md:size-11"
                aria-label="发送"
                disabled={!canSend}
              >
                <ArrowUpIcon />
              </InputGroupButton>
            </Tooltip>
          )}
        </div>
      </InputGroup>
    </form>
  );
}
