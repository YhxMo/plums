import { useRef, useState } from "react";
import {
  CameraIcon,
  ChevronRightIcon,
  ImageOffIcon,
  ImagePlusIcon,
  PencilIcon,
  XIcon,
} from "lucide-react";
import type { Agent } from "@modules/agents/contract";
import { Avatar } from "./Avatar";
import { AgentParts } from "./AgentParts";
import type { Part } from "./parts";
import { InfoTip } from "@/components/Tooltip";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

/**
 * What a person needs to understand an Agent: who it is, and the extensions
 * it is composed of. Models, sessions and other actions live where they are
 * used.
 */
export function DetailPanel({
  agent,
  parts,
  onPart,
  onDescription,
  onAvatar,
  onOpenExtension,
  onClose,
}: {
  agent: Agent;
  /** The provider, interface and model connections, each switched on or off. */
  parts: readonly Part[];
  /** Absent for providers that cannot switch parts off. */
  onPart?: (part: Part, on: boolean) => void;
  /** Resolves true once saved; a failure is reported by the caller. */
  onDescription: (description: string) => Promise<boolean>;
  /** Picks a new picture (a file to scale) or removes it with `null`. */
  onAvatar?: (file: File | null) => void;
  /** Opens extension management, selecting `id` when given. */
  onOpenExtension: (id?: string) => void;
  onClose: () => void;
}) {
  // Only a save in progress holds the details; a pending reply does not.
  const busy = agent.status === "busy" && !agent.pending;
  const [editing, setEditing] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-popover"
      aria-label="Agent 详情"
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between pr-2.5 pl-5 max-md:min-h-14 max-md:pl-6">
        <h2 className="text-[13px] font-medium text-muted-foreground max-md:text-base">
          Agent 详情
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="收起详情"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-7 overflow-y-auto px-5 pt-2 pb-6 max-md:px-6">
        <section className="flex flex-col gap-3" aria-label="介绍">
          <div className="flex items-center gap-3">
            {onAvatar ? (
              <>
                <input
                  ref={picker}
                  type="file"
                  hidden
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  aria-label="选择头像图片"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) onAvatar(file);
                  }}
                />
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      data-slot="avatar-button"
                      aria-label="更换头像"
                      disabled={busy}
                      className="group/avatar-button relative shrink-0 rounded-[26%] outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <Avatar agent={agent} />
                      <span
                        aria-hidden="true"
                        className="absolute inset-0 grid place-items-center rounded-[26%] bg-black/40 text-white opacity-0 transition-opacity group-hover/avatar-button:opacity-100 group-focus-visible/avatar-button:opacity-100 max-md:opacity-0"
                      >
                        <CameraIcon className="size-4" />
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-44">
                    <DropdownMenuItem onSelect={() => picker.current?.click()}>
                      <ImagePlusIcon />
                      上传图片…
                    </DropdownMenuItem>
                    {agent.avatar && (
                      <DropdownMenuItem onSelect={() => onAvatar(null)}>
                        <ImageOffIcon />
                        移除头像
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Avatar agent={agent} />
            )}
            <h3 className="min-w-0 text-base font-semibold wrap-anywhere">
              {agent.name}
            </h3>
          </div>
          {editing === null ? (
            <div className="group/intro flex flex-col items-start gap-1.5">
              <p className="text-[13px] leading-relaxed whitespace-pre-wrap text-foreground/85 wrap-anywhere">
                {agent.description || (
                  <span className="text-muted-foreground">还没有介绍。</span>
                )}
              </p>
              <Button
                variant="ghost"
                size="xs"
                className="-ml-2 text-muted-foreground"
                disabled={busy}
                onClick={() => setEditing(agent.description)}
              >
                <PencilIcon />
                编辑介绍
              </Button>
            </div>
          ) : (
            <form
              className="flex flex-col gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void onDescription(editing).then((saved) => {
                  if (saved) setEditing(null);
                });
              }}
            >
              <Textarea
                aria-label="介绍"
                autoFocus
                value={editing}
                maxLength={4000}
                className="min-h-28 text-[13px]"
                placeholder="它是谁，能帮你做什么，有哪些边界？"
                onChange={(e) => setEditing(e.target.value)}
              />
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
                <Button type="submit" size="sm" disabled={busy}>
                  保存
                </Button>
              </div>
            </form>
          )}
        </section>
        <section className="flex flex-col gap-2.5" aria-label="组成扩展">
          <div className="flex items-center justify-between gap-2">
            <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground max-md:text-sm">
              组成扩展
              <InfoTip
                label="组成扩展"
                text="这个 Agent 由这些扩展组成。关闭一项只影响这个 Agent。"
              />
            </h3>
            <Button
              variant="ghost"
              size="xs"
              className="-mr-2 text-muted-foreground"
              onClick={() => onOpenExtension()}
            >
              扩展管理
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </div>
          <AgentParts
            agentName={agent.name}
            parts={parts}
            onPart={onPart}
            onOpen={onOpenExtension}
            disabled={busy}
          />
        </section>
      </div>
    </aside>
  );
}
