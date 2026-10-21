import type { ReactNode } from "react";
import {
  CheckIcon,
  ChevronRightIcon,
  MessageSquareTextIcon,
  PlusIcon,
  StarIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { cn } from "cn";
import {
  enabledExtensions,
  type Agent,
  type AgentModel,
  type ExtensionChoice,
  type ModelChoice,
} from "../../modules/agents/contract";
import { Avatar } from "./Avatar";
import { ExtensionPipeline } from "./ExtensionPipeline";
import { ModelSelect } from "./ModelSelect";
import type { Part } from "./parts";
import { InfoTip, Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";

function Section({
  title,
  info,
  action,
  children,
}: {
  title: string;
  /** Background on the section, behind an info button beside the title. */
  info?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 max-md:px-6 max-md:py-5">
      <div className="flex min-h-6 items-center justify-between gap-2">
        <h3 className="flex items-center gap-1 text-xs font-semibold tracking-wide text-muted-foreground max-md:text-sm">
          {title}
          {info && <InfoTip label={title} text={info} />}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

const note = "text-xs leading-relaxed text-muted-foreground";

export function DetailPanel({
  agent,
  onClose,
  onPin,
  onSession,
  onDeleteSession,
  onOpenExtension,
  parts,
  onPart,
  choices,
  onExtensions,
  models,
  onModel,
  onModels,
}: {
  agent: Agent;
  /** The provider, interface and model connections, each switched on or off. */
  parts: readonly Part[];
  /** Absent for providers that cannot switch parts off. */
  onPart?: (part: Part, on: boolean) => void;
  /** Absent for providers that do not let each Agent choose. */
  choices?: readonly ExtensionChoice[];
  /** Sets the switched-on extensions, in order. */
  onExtensions?: (ids: string[]) => void;
  /** Absent for providers without per-Agent models. */
  models?: readonly ModelChoice[];
  onModel?: (model: AgentModel | null) => void;
  onModels?: () => void;
  onClose: () => void;
  onPin: () => void;
  onSession: (action: "create" | "select", id?: string) => void;
  onDeleteSession: (id: string, source: HTMLElement) => void;
  /** Opens extension management, selecting `id` when given. */
  onOpenExtension: (id?: string) => void;
}) {
  const enabled = choices ? enabledExtensions(agent, choices) : [];
  const busy = agent.status === "busy";
  return (
    <aside
      className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-popover"
      aria-label="Agent 详情"
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between border-b border-border/60 pr-2.5 pl-4 max-md:min-h-14 max-md:border-0 max-md:pl-6">
        <h2 className="text-[13px] font-semibold max-md:text-base">
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-0.5 px-4 pt-4 pb-4 text-center">
          <Avatar
            agent={agent}
            className="size-12 shadow-raised [&_svg]:size-6"
          />
          <h2 className="mt-2 text-[15px] font-semibold wrap-anywhere">
            {agent.name}
          </h2>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 rounded-full",
                busy ? "animate-pulse bg-running" : "bg-muted-foreground/40",
              )}
            />
            {busy ? "正在回复" : "空闲"}
          </span>
          <Button
            variant={agent.pinned ? "secondary" : "outline"}
            size="xs"
            className="mt-2"
            onClick={onPin}
          >
            <StarIcon className={cn(agent.pinned && "fill-brand text-brand")} />
            {agent.pinned ? "取消特别关注" : "设为特别关注"}
          </Button>
        </div>
        {agent.description && (
          <Section title="角色说明">
            <p className="text-[13px] leading-relaxed whitespace-pre-wrap wrap-anywhere">
              {agent.description}
            </p>
          </Section>
        )}
        {models && onModel && (
          <Section
            title="模型"
            action={
              onModels && (
                <Button
                  variant="link"
                  size="xs"
                  className="px-0 text-brand-text"
                  onClick={onModels}
                >
                  {models.length ? "管理模型连接" : "添加模型连接"}
                  <ChevronRightIcon data-icon="inline-end" />
                </Button>
              )
            }
          >
            <ModelSelect
              label={`${agent.name} 使用的模型`}
              models={models}
              value={agent.model}
              disabled={busy}
              onChange={onModel}
            />
          </Section>
        )}
        <Section
          title="组成扩展"
          info="开启的扩展组成这个 Agent；带编号的文本扩展依次处理回复，可拖动调整先后。"
          action={
            <Button
              variant="link"
              size="xs"
              className="px-0 text-brand-text"
              onClick={() => onOpenExtension()}
            >
              扩展管理
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          }
        >
          {!onPart && (
            <ul className="grid gap-1.5">
              {parts.map(({ choice }) => (
                <li key={choice.id}>
                  <Tooltip label={choice.id}>
                    <button
                      className="w-full truncate rounded-lg bg-brand-soft/60 px-3 py-2 text-left text-[13px] font-medium outline-none transition-colors hover:bg-brand-soft focus-visible:ring-3 focus-visible:ring-ring/50"
                      aria-label={`查看扩展 ${choice.label}`}
                      onClick={() => onOpenExtension(choice.id)}
                    >
                      {choice.label}
                    </button>
                  </Tooltip>
                </li>
              ))}
            </ul>
          )}
          {(onPart || (choices && onExtensions)) && (
            <ExtensionPipeline
              agentName={agent.name}
              parts={parts}
              onPart={onPart}
              choices={choices ?? []}
              value={enabled}
              onChange={(ids) => onExtensions?.(ids)}
              onOpen={onOpenExtension}
            />
          )}
          {!parts.some((p) => p.connector && p.on) && !enabled.length && (
            <p className={note}>
              还没有开启模型连接或文本扩展，此 Agent 暂时无法回复。
            </p>
          )}
        </Section>
        <Section title="实际可用能力" info="角色卡说明不会授予额外访问权限。">
          <ul className="grid gap-1.5">
            {agent.capabilities.map((c) => (
              <li key={c} className="flex items-start gap-2 text-[13px]">
                <CheckIcon className="mt-0.5 size-4 text-running" />
                {c}
              </li>
            ))}
          </ul>
        </Section>
        {agent.multiSession && (
          <Section
            title="会话"
            action={
              <Tooltip label="新建会话">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="新建会话"
                  disabled={busy}
                  onClick={() => onSession("create")}
                >
                  <PlusIcon />
                </Button>
              </Tooltip>
            }
          >
            <ul className="grid gap-0.5">
              {agent.sessions.map((session) => (
                <li
                  key={session.id}
                  className="group/session flex items-center gap-1 rounded-lg has-aria-pressed:bg-sidebar-primary hover:bg-sidebar-accent"
                >
                  <button
                    data-slot="session-row"
                    className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 max-md:min-h-11"
                    aria-pressed={session.id === agent.currentSessionId}
                    disabled={busy}
                    onClick={() => onSession("select", session.id)}
                  >
                    <MessageSquareTextIcon className="size-4 text-muted-foreground" />
                    <span className="truncate">{session.title}</span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`删除会话 ${session.title}`}
                    disabled={busy}
                    onClick={(e) =>
                      onDeleteSession(session.id, e.currentTarget)
                    }
                  >
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
            {busy && <p className={note}>停止处理后可管理会话。</p>}
          </Section>
        )}
      </div>
    </aside>
  );
}
