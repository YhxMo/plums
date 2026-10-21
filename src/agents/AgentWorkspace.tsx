import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Agent, AgentProvider } from "../../modules/agents/contract";
import type { Named, WorkspaceChromeController } from "../../modules/sdk";
import { cn } from "cn";
import { AgentList } from "./AgentList";
import { ChatView, type Blocked } from "./ChatView";
import { ModelSelect } from "./ModelSelect";
import { DetailPanel } from "./DetailPanel";
import { EmptyState } from "./EmptyState";
import { Dialog } from "../components/Dialog";
import { Button } from "../components/ui/button";
import { ActionToast } from "../components/Toast";
import { useMediaQuery } from "../components/useMediaQuery";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../components/ui/resizable";
import { useAgentModals } from "./useAgentModals";
import { AgentDialogs } from "./AgentDialogs";
import type { AgentAction } from "./AgentMenu";
import { fallbackFocus } from "./focus";
import { agentParts, switchPart, type Part } from "./parts";

// The list's own shadow marks the edge; the handle only shows while used.
// A hairline between the list and the conversation, brand-coloured while used.
const handle =
  "bg-border/70 transition-colors after:w-2 hover:bg-brand/50 data-[separator=active]:bg-brand";

export function AgentWorkspace({
  api,
  chrome,
  ui,
  onExtensions,
  onModels,
}: {
  api: AgentProvider;
  chrome: WorkspaceChromeController;
  /** This interface, which each Agent can switch off like its other parts. */
  ui?: Named;
  /** Opens extension management, selecting `id` when given. */
  onExtensions: (id?: string) => void;
  /** Opens the page where the user manages model connections. */
  onModels?: () => void;
}) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const snapshot = useCallback(() => api.list(), [api]);
  const agents = useSyncExternalStore(subscribe, snapshot);
  const mobile = useMediaQuery("(max-width: 767px)");
  // Wide windows make room for the details drawer; narrower ones let it cover.
  const wide = useMediaQuery("(min-width: 1100px)");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const workspaceRoot = useRef<HTMLDivElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const returnToAgent = useRef<string | null>(null);
  const focusFallback = () => fallbackFocus(workspaceRoot.current);
  const returnToList = useCallback(() => {
    returnToAgent.current = selected;
    setSelected(null);
    setDetail(false);
  }, [selected]);
  useEffect(() => {
    if (selected || !returnToAgent.current) return;
    const target = workspaceRoot.current?.querySelector<HTMLElement>(
      `[data-agent-id="${CSS.escape(returnToAgent.current)}"]`,
    );
    if (target?.getClientRects().length) target.focus();
    else fallbackFocus(workspaceRoot.current)?.focus();
    returnToAgent.current = null;
  }, [selected]);
  const modals = useAgentModals();
  const { error, notice, setError, setNotice, open, act } = modals;
  useEffect(
    () =>
      chrome.connect((id) => {
        setSelected(id);
        setDetail(false);
      }),
    [chrome],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const agent = agents.find((a) => a.id === selected);
  const key = agent ? `${agent.id}:${agent.currentSessionId}` : "";
  useEffect(() => {
    chrome.publish({
      // The conversation names itself in its own header, on every width.
      title: "",
      back: mobile && agent ? returnToList : undefined,
      contextOwner: agent?.extensionId,
      sidebar: agents.length
        ? {
            label: "Agent 详情",
            open: detail && !!agent,
            presentation: mobile ? "dialog" : "sidebar",
            close() {
              setDetail(false);
            },
            toggle(source) {
              detailTrigger.current = source;
              if (!agent) setSelected(agents[0].id);
              setDetail((open) => !open);
            },
          }
        : undefined,
    });
  }, [chrome, agent, agents, detail, mobile, returnToList]);
  function agentAction(
    a: Agent,
    action: AgentAction,
    source?: HTMLElement | null,
  ) {
    if (action === "pin")
      void act(() => api.update(a.id, { pinned: !a.pinned }));
    else open({ action, agent: a }, source);
  }
  const feedback = (
    <ActionToast
      error={error}
      notice={notice}
      onDone={() => {
        setError("");
        setNotice("");
      }}
    />
  );
  // Providers predating `extensions` are shown as the one extension they are.
  const provider = api.info.extensions ?? [
    { id: agent?.extensionId ?? "", label: api.info.label },
  ];
  const parts =
    agent &&
    agentParts({ provider, ui, api, model: agent.model, off: agent.off });
  function switchAgentPart(a: Agent, part: Part, on: boolean) {
    void act(async () => {
      const next = switchPart(part, on, api, a.model);
      if (next.model) await api.setModel!(a.id, next.model);
      else await api.setOff!(a.id, part.choice.id, next.off);
    });
  }
  const models = api.modelChoices?.();
  /** The first thing stopping this Agent from replying here, if any. */
  function blocker(a: Agent): Blocked | undefined {
    const off = (part?: Part) => part && !part.on;
    const turnOn = (part: Part) => (
      <Button size="sm" onClick={() => switchAgentPart(a, part, true)}>
        开启
      </Button>
    );
    const [core] = parts!;
    const view = ui && parts!.find((p) => p.choice.id === ui.id);
    if (off(view))
      return {
        text: `此 Agent 已关闭「${view!.choice.label}」，开启后才能在这里对话。`,
        action: turnOn(view!),
      };
    if (off(core))
      return {
        text: `此 Agent 已关闭「${core.choice.label}」，开启后它才会回复。`,
        action: turnOn(core),
      };
    if (!models || !api.setModel) return undefined;
    if (!models.length)
      return {
        text: "先连接一个 AI 模型，它才能理解和回复你。",
        action: onModels && (
          <Button size="sm" onClick={onModels}>
            连接模型
          </Button>
        ),
      };
    const picked =
      a.model &&
      models.some(
        (m) => m.provider === a.model!.provider && m.id === a.model!.model,
      );
    if (!picked)
      return {
        text: `为 ${a.name} 选一个模型，它就能回复你。`,
        action: (
          <span className="w-56 max-md:w-full">
            <ModelSelect
              compact
              label={`${a.name} 使用的模型`}
              models={models}
              value={a.model}
              onChange={(model) => void act(() => api.setModel!(a.id, model))}
            />
          </span>
        ),
      };
    const connection = parts!.find((p) => p.choice.id === a.model!.provider);
    if (off(connection))
      return {
        text: `此 Agent 已关闭「${connection!.choice.label}」，开启后它才会回复。`,
        action: turnOn(connection!),
      };
    return undefined;
  }
  const detailContent = agent && (
    <DetailPanel
      agent={agent}
      parts={parts!}
      onPart={api.setOff && ((part, on) => switchAgentPart(agent, part, on))}
      onDescription={async (description) => {
        let saved = false;
        await act(async () => {
          await api.update(agent.id, { description });
          saved = true;
        });
        return saved;
      }}
      onClose={() => setDetail(false)}
      onOpenExtension={(id) => {
        setDetail(false);
        onExtensions(id);
      }}
    />
  );
  const list = (
    <AgentList
      agents={agents}
      selected={selected}
      onSelect={(id) => {
        setSelected(id);
        setDetail(false);
      }}
      onAdd={(source) => open("add", source)}
      onAction={agentAction}
    />
  );
  const main = !agent ? (
    <EmptyState
      hasAgents={agents.length > 0}
      onImport={(source) => open("import", source)}
      onAdd={(source) => open("create", source)}
      onExtensions={() => onExtensions()}
    />
  ) : (
    <ChatView
      agent={agent}
      blocked={blocker(agent)}
      draft={drafts[key] ?? ""}
      onDraft={(value) => setDrafts((d) => ({ ...d, [key]: value }))}
      onBack={returnToList}
      models={models}
      onModel={
        api.setModel &&
        ((model) => void act(() => api.setModel!(agent.id, model)))
      }
      onDetail={(source) => {
        detailTrigger.current = source;
        setDetail(true);
      }}
      onAction={(action, source) => agentAction(agent, action, source)}
      onSession={(action, id) =>
        void act(() => api.session(agent.id, action, id))
      }
      onDeleteSession={(id, source) =>
        open({ action: "deleteSession", agent, session: id }, source)
      }
      onCancel={() => api.cancel(agent.id)}
      onSend={() => {
        const input = drafts[key] ?? "";
        // The sent text shows as a pending bubble; a failed send puts it
        // back unless the user has started a new draft.
        setDrafts((d) => ({ ...d, [key]: "" }));
        void act(async () => {
          try {
            await api.send(agent.id, input);
          } catch (error) {
            setDrafts((d) => (d[key] ? d : { ...d, [key]: input }));
            throw error;
          }
        });
      }}
      onResend={(text) => void act(() => api.send(agent.id, text))}
      onDeleteMessage={
        api.removeMessage
          ? (id) =>
              void act(() =>
                api.removeMessage!(agent.id, agent.currentSessionId, id),
              )
          : undefined
      }
      onError={setError}
    />
  );
  const showDetail = detail && !!agent;
  const dialogs = (
    <AgentDialogs
      api={api}
      ui={ui}
      modals={modals}
      fallbackFocus={focusFallback}
      onCreated={(agent) => {
        setSelected(agent.id);
        setDetail(false);
      }}
      onRemoved={(id) => {
        if (selected === id) setSelected(null);
      }}
      onExtensions={() => onExtensions()}
      onModels={onModels}
    />
  );
  // Details pop out above the conversation: a bottom sheet on phones, a
  // non-modal drawer on desktop so the chat stays usable beside them.
  const details = showDetail && (
    <Dialog
      title="Agent 详情"
      sheet={mobile ? "bottom" : "right"}
      returnFocusTo={detailTrigger.current}
      fallbackFocus={focusFallback}
      onClose={() => setDetail(false)}
    >
      {feedback}
      {detailContent}
    </Dialog>
  );
  if (mobile)
    return (
      <div
        ref={workspaceRoot}
        className="relative flex h-full min-h-0 bg-background"
      >
        {!showDetail && feedback}
        {/* Phones show the list or one conversation, never both. */}
        {agent || !agents.length ? (
          <div className="flex min-h-0 w-full flex-col">{main}</div>
        ) : (
          list
        )}
        {details}
        {dialogs}
      </div>
    );
  return (
    <div
      ref={workspaceRoot}
      className={cn(
        "relative flex h-full min-h-0 transition-[padding] duration-200 ease-out",
        showDetail && wide && "pr-[336px]",
      )}
    >
      {!showDetail && feedback}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0">
        <ResizablePanel
          id="agent-list"
          defaultSize={256}
          minSize={208}
          maxSize={380}
          className="flex min-h-0 flex-col"
        >
          {list}
        </ResizablePanel>
        <ResizableHandle className={handle} />
        <ResizablePanel
          id="agent-main"
          minSize={360}
          className="flex min-h-0 min-w-0 flex-col"
        >
          {main}
        </ResizablePanel>
      </ResizablePanelGroup>
      {details}
      {dialogs}
    </div>
  );
}
