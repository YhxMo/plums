import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { ArrowUpIcon, PaperclipIcon, PlusIcon, SquareIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type {
  Agent,
  AgentModel,
  Attachment,
  Effort,
  ModelChoice,
} from "../../modules/agents/contract";
import { MAX_TEXT } from "../../modules/agents/store";
import { DraftAttachments } from "./AttachmentView";
import { EffortSelect } from "./EffortSelect";
import { ModelSelect } from "./ModelSelect";
import { Tooltip } from "../components/Tooltip";
import { useMediaQuery } from "../components/useMediaQuery";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../components/ui/input-group";

const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** What the message box can attach; absent when the provider takes none. */
export type Attach = {
  files: readonly Attachment[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
};

/** Why this Agent cannot reply here yet, and the one step that fixes it. */
export type Blocked = { text: string; action: ReactNode };

const swap = {
  initial: { opacity: 0, scale: 0.6 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.6 },
  transition: { duration: 0.15 },
} as const;

/** One composer in every state; missing models or disabled parts block sending. */
export function Composer({
  agent,
  blocked,
  draft,
  onDraft,
  onSend,
  onCancel,
  models,
  onModels,
  onModel,
  onEffort,
  attach,
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
  onModels?: () => void;
  onModel?: (model: AgentModel | null) => void;
  /** Absent for providers that do not keep a thinking strength. */
  onEffort?: (effort: Effort | null) => void;
  attach?: Attach;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const busy = agent.status === "busy";
  const saving = agent.canCancel === false;
  // Only a model that lists strengths gets the control; others show nothing.
  const chosen = models?.find(
    (m) => m.provider === agent.model?.provider && m.id === agent.model?.model,
  );
  const levels = chosen?.reasoning;
  // An empty catalog and an unselected model share the same composer state.
  const unpicked = models !== undefined && !!onModel && !chosen;
  const canSend = !!draft.trim() && !busy && !unpicked && !blocked;
  const files = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  // Input behavior follows the device, not the width of a desktop window.
  const enterSends = useMediaQuery("(any-pointer: fine)");
  const canAttach = !!attach && !busy;
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
      className="mx-auto mt-1 mb-4 w-[calc(100%-32px)] max-w-[760px] max-md:mb-[max(12px,env(safe-area-inset-bottom))] max-md:w-[calc(100%-24px)]"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSend) onSend();
      }}
    >
      <InputGroup className="h-auto rounded-[16px] border-border bg-card shadow-none transition-colors duration-200 has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card has-[[data-slot=input-group-control]:focus-visible]:border-brand/60 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
        {blocked && (
          <div
            role="status"
            className="flex w-full items-center justify-between gap-3 px-4 pt-3 text-xs text-muted-foreground"
          >
            <p>{blocked.text}</p>
            {blocked.action}
          </div>
        )}
        {attach && attach.files.length > 0 && (
          <InputGroupAddon align="block-start" className="p-0">
            <DraftAttachments
              attachments={attach.files}
              disabled={busy}
              onRemove={attach.onRemove}
            />
          </InputGroupAddon>
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
          className="max-h-52 min-h-14 px-4 pt-3.5 pb-1 text-sm leading-relaxed [field-sizing:content] max-md:min-h-12 max-md:text-base"
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
        <InputGroupAddon
          align="block-end"
          className="cursor-default gap-1 px-2 pb-2 max-md:pb-1.5"
        >
          <div className="mr-auto flex min-w-0 items-center gap-0.5">
            {attach && (
              <>
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
                        className="size-8 text-muted-foreground aria-expanded:bg-muted max-md:size-10"
                        aria-label="添加附件"
                        disabled={busy}
                      >
                        <PlusIcon />
                      </InputGroupButton>
                    </DropdownMenuTrigger>
                  </Tooltip>
                  <DropdownMenuContent
                    align="start"
                    side="top"
                    className="w-56"
                  >
                    <DropdownMenuItem onSelect={() => files.current?.click()}>
                      <PaperclipIcon />
                      图片和文件
                      <DropdownMenuShortcut>
                        {mac ? "⌘U" : "Ctrl+U"}
                      </DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            {models && onModel && (
              <ModelSelect
                compact
                label="切换模型"
                models={models}
                value={agent.model}
                disabled={busy}
                onChange={onModel}
                onConnect={onModels}
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
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            {busy ? (
              <motion.span key="stop" {...swap}>
                <Tooltip label={saving ? "正在保存…" : "停止处理"}>
                  <InputGroupButton
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    className="size-[34px] rounded-[10px] max-md:size-11"
                    aria-label={saving ? "正在保存…" : "停止处理"}
                    onClick={onCancel}
                    disabled={saving}
                  >
                    <SquareIcon className="fill-current" />
                  </InputGroupButton>
                </Tooltip>
              </motion.span>
            ) : (
              <motion.span key="send" {...swap}>
                <Tooltip label="发送">
                  <InputGroupButton
                    type="submit"
                    variant="default"
                    size="icon-sm"
                    className="size-[34px] rounded-[10px] max-md:size-11"
                    aria-label="发送"
                    disabled={!canSend}
                  >
                    <ArrowUpIcon />
                  </InputGroupButton>
                </Tooltip>
              </motion.span>
            )}
          </AnimatePresence>
        </InputGroupAddon>
      </InputGroup>
    </form>
  );
}
