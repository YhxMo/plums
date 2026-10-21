import { useRef, type ReactNode, type RefObject } from "react";
import {
  ArrowUpIcon,
  FileTextIcon,
  ImageIcon,
  PlusIcon,
  SquareIcon,
} from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "../components/ui/input-group";

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

/** The card at the foot of a conversation: the message box, or what blocks it. */
export function Composer({
  agent,
  blocked,
  draft,
  onDraft,
  onSend,
  onCancel,
  models,
  onModel,
  onEffort,
  attach,
  desktop,
  inputRef,
}: {
  agent: Agent;
  /** Shown instead of the message box while the Agent cannot reply. */
  blocked?: Blocked;
  draft: string;
  onDraft: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  /** Absent for providers without per-Agent models. */
  models?: readonly ModelChoice[];
  onModel?: (model: AgentModel | null) => void;
  /** Absent for providers that do not keep a thinking strength. */
  onEffort?: (effort: Effort | null) => void;
  attach?: Attach;
  /** Wide layouts send with Enter; phones send with the button. */
  desktop: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const busy = agent.status === "busy";
  const saving = agent.canCancel === false;
  // Only a model that lists strengths gets the control; others show nothing.
  const levels = models?.find(
    (m) => m.provider === agent.model?.provider && m.id === agent.model?.model,
  )?.reasoning;
  const vision = !!models?.find(
    (m) => m.provider === agent.model?.provider && m.id === agent.model?.model,
  )?.vision;
  const textFiles = useRef<HTMLInputElement>(null);
  const pictures = useRef<HTMLInputElement>(null);
  if (blocked)
    return (
      <div
        role="status"
        className="mx-auto mt-1 mb-4 flex min-h-14 w-[calc(100%-32px)] max-w-[760px] flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-2xl border border-border bg-card py-2 pr-2.5 pl-4 text-sm max-md:mb-[max(12px,env(safe-area-inset-bottom))] max-md:w-[calc(100%-24px)]"
      >
        <p className="min-w-48 flex-1 text-muted-foreground">{blocked.text}</p>
        <div className="flex shrink-0 justify-end max-md:w-full">
          {blocked.action}
        </div>
      </div>
    );
  return (
    <form
      className="mx-auto mt-1 mb-4 w-[calc(100%-32px)] max-w-[760px] max-md:mb-[max(12px,env(safe-area-inset-bottom))] max-md:w-[calc(100%-24px)]"
      onSubmit={(e) => {
        e.preventDefault();
        onSend();
      }}
    >
      <InputGroup className="h-auto rounded-[16px] border-border bg-card shadow-none transition-colors duration-200 has-disabled:bg-card has-disabled:opacity-100 dark:bg-card dark:has-disabled:bg-card has-[[data-slot=input-group-control]:focus-visible]:border-brand/60 has-[[data-slot=input-group-control]:focus-visible]:ring-0">
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
          placeholder={`发送给 ${agent.name}…`}
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
              desktop
            ) {
              e.preventDefault();
              if (draft.trim() && !busy) onSend();
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
                  ref={textFiles}
                  type="file"
                  multiple
                  hidden
                  aria-label="选择文本文件"
                  onChange={(e) => {
                    attach.onAdd([...(e.target.files ?? [])]);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={pictures}
                  type="file"
                  multiple
                  hidden
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label="选择图片"
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
                    <DropdownMenuItem
                      onSelect={() => textFiles.current?.click()}
                    >
                      <FileTextIcon />
                      添加文本文件
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={!vision}
                      onSelect={() => pictures.current?.click()}
                    >
                      <ImageIcon />
                      <span className="flex min-w-0 flex-col">
                        添加图片
                        {!vision && (
                          <span className="text-xs text-muted-foreground">
                            当前模型不读图片
                          </span>
                        )}
                      </span>
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
                    disabled={!draft.trim()}
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
