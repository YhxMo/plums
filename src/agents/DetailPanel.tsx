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
  type AgentProviderInfo,
  type ExtensionChoice,
  type ModelChoice,
} from "../../modules/agents/contract";
import { Avatar } from "./Avatar";
import { ExtensionPipeline } from "./ExtensionPipeline";
import { ModelSelect } from "./ModelSelect";
import { Tooltip } from "../components/Tooltip";
import { Button } from "../components/ui/button";

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-2.5 border-t border-sidebar-border/70 px-4.5 py-4 max-md:px-6 max-md:py-5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground max-md:text-sm">
          {title}
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
  provider,
  onClose,
  onPin,
  onSession,
  onDeleteSession,
  onOpenExtension,
  choices,
  onExtensions,
  models,
  onModel,
  onModels,
}: {
  agent: Agent;
  provider: AgentProviderInfo;
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
  // Providers predating `extensions` are shown as the one extension they are.
  const base = provider.extensions ?? [
    { id: agent.extensionId, label: provider.label },
  ];
  const enabled = choices ? enabledExtensions(agent, choices) : [];
  const busy = agent.status === "busy";
  return (
    <aside
      className="flex h-full w-full flex-col overflow-hidden bg-sidebar md:rounded-xl md:shadow-panel"
      aria-label="Agent 详情"
    >
      <header className="flex min-h-12 shrink-0 items-center justify-between py-1.5 pr-2.5 pl-4.5 max-md:min-h-14 max-md:pl-6">
        <h2 className="text-[13px] font-semibold max-md:text-base">
          Agent 详情
        </h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label="收起详情"
          onClick={onClose}
        >
          <XIcon />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center gap-1 px-4.5 pt-2 pb-5 text-center">
          <Avatar agent={agent} size="large" className="shadow-raised" />
          <h2 className="mt-2.5 text-base font-semibold wrap-anywhere">
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
            size="sm"
            className="mt-2.5"
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
          <ul className="grid gap-1.5">
            {base.map((extension) => (
              <li
                key={extension.id}
                className="flex items-center gap-2 rounded-lg bg-brand-soft/60 px-3 py-2"
              >
                <Tooltip label={extension.id}>
                  <button
                    className="flex min-w-0 flex-1 flex-col items-start rounded-md text-left outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                    aria-label={`查看扩展 ${extension.label}`}
                    onClick={() => onOpenExtension(extension.id)}
                  >
                    <span className="truncate text-[13px] font-medium">
                      {extension.label}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      Agent 本体，始终开启
                    </span>
                  </button>
                </Tooltip>
              </li>
            ))}
          </ul>
          {choices && onExtensions && (
            <ExtensionPipeline
              agentName={agent.name}
              choices={choices}
              value={enabled}
              onChange={onExtensions}
              onOpen={onOpenExtension}
            />
          )}
          {!!choices?.length && (
            <p className={note}>
              {enabled.length === 0
                ? agent.model
                  ? "可开启文本扩展对模型回复做后处理。"
                  : "尚未选择模型或开启扩展，此 Agent 暂时无法回复。"
                : enabled.length > 1
                  ? `回复依次经过：${enabled
                      .map((id) => choices.find((c) => c.id === id)?.label)
                      .join(" → ")}`
                  : "开启的扩展处理此 Agent 的回复，可同时开启多个并拖动排序。"}
            </p>
          )}
        </Section>
        <Section title="实际可用能力">
          <ul className="grid gap-1.5">
            {agent.capabilities.map((c) => (
              <li key={c} className="flex items-start gap-2 text-[13px]">
                <CheckIcon className="mt-0.5 size-4 text-running" />
                {c}
              </li>
            ))}
          </ul>
          <p className={note}>角色卡说明不会授予额外访问权限。</p>
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
