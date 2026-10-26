import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  OWNER,
  type Agent,
  type AgentPatch,
  type AgentProvider,
} from "@modules/agents/contract";
import type { Named, WorkspaceChromeController } from "@modules/sdk";
import { cn } from "cn";
import { AgentList } from "./AgentList";
import { ChatView } from "./ChatView";
import { DetailPanel } from "./DetailPanel";
import { EmptyState } from "./EmptyState";
import type { ModelPage } from "./ModelSelect";
import { Dialog, DialogDone } from "@/components/Dialog";
import { useMediaQuery } from "@/components/useMediaQuery";
import { atLeast, below } from "@/components/breakpoints";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useRewrite } from "./useRewrite";
import { useAgentModals } from "./useAgentModals";
import { AgentDialogs } from "./AgentDialogs";
import type { AgentAction } from "./AgentMenu";
import { ImportDrop } from "./ImportDrop";
import { AVATAR_BASE64, AVATAR_SIDE, scaledPicture } from "./imageFile";
import { agentParts, switchPart, type Part } from "./parts";
import { reportText, useMemories, type Memories } from "./useMemories";
import { exportRoleCard, type AgentFiles } from "./agentFiles";
import { useDrafts } from "./useDrafts";
import { useUndoNotice } from "./useUndoNotice";
import { replyBlocker } from "./blocker";

// The handle is the gap between the list and the conversation card; it only
// shows a brand-coloured line while used.
/** The 8px gap is the handle; the pointer alone shows it can be dragged. */
const handle = "w-2 bg-transparent";

/** Each connector's own page for its models. */
function pagesFor(
  api: AgentProvider,
  onModels?: (page: string | null) => void,
): readonly ModelPage[] | undefined {
  if (!onModels) return undefined;
  return (api.connectors?.() ?? []).flatMap(({ label, manage }) =>
    manage ? [{ label, open: () => onModels(manage) }] : [],
  );
}

export function AgentWorkspace({
  api,
  chrome,
  ui,
  memories,
  onExtensions,
  onModels,
  onOpenLink,
  files,
}: {
  api: AgentProvider;
  chrome: WorkspaceChromeController;
  /** This interface, which each Agent can switch off like its other parts. */
  ui?: Named;
  /** The memory providers, for what each Agent remembers and its page. */
  memories?: Memories;
  /** Opens extension management, selecting `id` when given. */
  onExtensions: (id?: string) => void;
  /** Opens the page where the user manages model connections. */
  /** Opens a connector's page for its models, or the extensions for `null`. */
  onModels?: (page: string | null) => void;
  /** Hands an https link to the browser. */
  onOpenLink: (url: string) => Promise<unknown>;
  /** Role cards and whole-Agent files out of and into the app. */
  files: AgentFiles;
}) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const snapshot = useCallback(() => api.list(), [api]);
  const agents = useSyncExternalStore(subscribe, snapshot);
  const visible = useSyncExternalStore(
    chrome.visibility.subscribe,
    chrome.visibility.getSnapshot,
  );
  const mobile = useMediaQuery(below("md"));
  // Wide windows make room for the details drawer; narrower ones let it cover.
  const wide = useMediaQuery(atLeast("wide"));
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  /** The Agent whose settings dialog is open, and what opened it. */
  const [settings, setSettings] = useState<{
    id: string;
    source: HTMLElement | null;
  } | null>(null);
  const workspaceRoot = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const returnToAgent = useRef<string | null>(null);
  // Where focus rests when what it was on has gone: the whole workspace, not
  // one of its controls.
  const focusFallback = () => workspaceRoot.current;
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
    else focusFallback()?.focus();
    returnToAgent.current = null;
  }, [selected]);
  const modals = useAgentModals();
  const { setError, setNotice, open, act, report } = modals;
  // The menu's command is published once and reaches the current dialog state.
  const startCreate = useRef(() => {});
  useLayoutEffect(() => {
    startCreate.current = () => open("create", null);
  });
  const undoNotice = useUndoNotice(modals);
  // Counts the person's own rewrites and undos; the conversation then
  // goes to its newest message, wherever it was scrolled.
  const [latest, setLatest] = useState(0);
  function offerUndo(agentId: string, text: string) {
    if (!api.undo) return;
    undoNotice.offer(text, async () => {
      await api.undo!(agentId);
      setLatest((n) => n + 1);
    });
  }
  // Each consolidation is announced once, with a way to take it back.
  const memoryProviders = useMemories(memories, (memory, report) => {
    const name = agents.find((a) => a.id === report.agent)?.name;
    if (!name) return;
    undoNotice.offer(reportText(name, report), () =>
      memory.value.undo(report.id),
    );
  });
  useEffect(
    () =>
      chrome.connect((id) => {
        setSelected(id);
        setDetail(false);
      }),
    [chrome],
  );
  const drafts = useDrafts({ api, report, setError });
  const { addFiles } = drafts;
  const rewrite = useRewrite({
    api,
    modals,
    drafts: drafts.drafts,
    setDrafts: drafts.setDrafts,
    offerUndo(agentId, text) {
      setLatest((n) => n + 1);
      offerUndo(agentId, text);
    },
  });
  const agent = agents.find((a) => a.id === selected);
  // The open conversation is read; replies elsewhere count as unread.
  const viewing = visible ? (agent?.id ?? null) : null;
  useLayoutEffect(() => {
    api.view?.(viewing);
    return () => api.view?.(null);
  }, [api, viewing]);
  const key = agent ? `${agent.id}:${agent.currentSessionId}` : "";
  // Files dragged anywhere in the window join the open conversation;
  // otherwise the hint says why they cannot.
  const refusal = !agents.length
    ? "添加 Agent 后才能拖入附件"
    : !agent
      ? "选择一个 Agent 后才能拖入附件"
      : !api.info.attachments
        ? "当前 Agent 不接收附件"
        : rewrite.editing(key)
          ? "编辑消息时不能添加附件"
          : null;
  const dropLabel = refusal ?? `松开以添加附件到「${agent!.name}」的会话`;
  const dropAdds = !refusal;
  useEffect(() => {
    chrome.publish({
      // The conversation names itself in its own header, on every width.
      title: "",
      // List and conversation are cards of their own beside the rail.
      frame: mobile ? undefined : "own",
      back: mobile && agent ? returnToList : undefined,
      contextOwner: agent?.extensionId,
      sidebar: agents.length
        ? {
            label: "Agent 详情",
            open: detail && !!agent,
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
      drop: {
        label: dropLabel,
        add: dropAdds ? (added) => addFiles(key, added) : undefined,
      },
      commands: {
        new: () => startCreate.current(),
        find() {
          search.current?.focus();
          search.current?.select();
        },
      },
    });
  }, [
    chrome,
    agent,
    agents,
    detail,
    mobile,
    returnToList,
    dropLabel,
    dropAdds,
    key,
    addFiles,
  ]);
  /** The extensions an Agent is made of: provider, interface, memory, its model's connection. */
  const partIds = (a: Agent) =>
    agentParts({
      provider: api.info.extensions ?? [],
      ui,
      api,
      model: a.model,
      memories: (api.memories?.() ?? []).map((choice) => ({ choice })),
    })
      .filter((p) => !p.connector || p.choice.id === a.model?.provider)
      .map((p) => p.choice.id);
  function agentAction(
    a: Agent,
    action: AgentAction,
    source?: HTMLElement | null,
  ) {
    if (action === "pin")
      void act(() => api.update(a.id, { pinned: !a.pinned }));
    else if (action === "export")
      void act(async () => {
        if (await exportRoleCard(a, files)) setNotice("已导出角色卡");
      });
    else if (action === "settings") {
      setDetail(false);
      setSettings({ id: a.id, source: source ?? null });
    } else if (action === "bundle")
      open({ action, agent: a, parts: partIds(a) }, source);
    else open({ action, agent: a }, source);
  }
  const feedback = undoNotice.toast;
  // Providers predating `extensions` are shown as the one extension they are.
  const provider = api.info.extensions ?? [
    { id: agent?.extensionId ?? "", label: api.info.label },
  ];
  const partsOf = (agent: Agent) =>
    agentParts({
      provider,
      ui,
      api,
      model: agent.model,
      off: agent.off,
      memories: (api.memories?.() ?? []).map((choice) => {
        const memory = memoryProviders.find((m) => m.id === choice.id);
        return {
          choice,
          ...(memory && {
            count: memory.value.count(agent.id, OWNER),
            ...(memory.value.page && {
              open: () => void memory.value.page!.open(agent.id),
            }),
          }),
        };
      }),
    });
  function switchAgentPart(a: Agent, part: Part, on: boolean) {
    void act(async () => {
      const next = switchPart(part, on, api, a.model);
      if (next.model) await api.setModel!(a.id, next.model);
      else await api.setOff!(a.id, part.choice.id, next.off);
    });
  }
  const models = api.modelChoices?.();
  const modelPages = pagesFor(api, onModels);
  /** Saves text edited in the details; resolves true once saved. */
  async function saveText(agentId: string, patch: AgentPatch) {
    let saved = false;
    await act(async () => {
      await api.update(agentId, patch);
      saved = true;
    });
    return saved;
  }
  /** An Agent's details: in the drawer with its own close button, or in the settings dialog. */
  const detailsOf = (agent: Agent, close: () => void, drawer: boolean) => (
    <DetailPanel
      agent={agent}
      parts={partsOf(agent)}
      onPart={api.setOff && ((part, on) => switchAgentPart(agent, part, on))}
      onDescription={(description) => saveText(agent.id, { description })}
      onInstructions={
        agent.instructions === undefined
          ? undefined
          : (instructions) => saveText(agent.id, { instructions })
      }
      onAvatar={(file) =>
        void act(async () => {
          if (!file) return api.update(agent.id, { avatar: null });
          const { mime, data } = await scaledPicture(file, {
            side: AVATAR_SIDE,
            limit: AVATAR_BASE64,
            crop: true,
          });
          await api.update(agent.id, { avatar: `data:${mime};base64,${data}` });
        })
      }
      onClose={drawer ? close : undefined}
      onOpenExtension={(id) => {
        close();
        onExtensions(id);
      }}
    />
  );
  // A role card dropped on the list opens the import, read as if chosen.
  function importFile(file: File) {
    open("import", null);
    void act(() => modals.roleCard.readFile(file));
  }
  const list = (
    <ImportDrop onImport={importFile} onRefuse={setError}>
      <AgentList
        agents={agents}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          setDetail(false);
        }}
        onAdd={(source) => open("create", source)}
        onImport={(source) => open("import", source)}
        onAction={agentAction}
        searchRef={search}
      />
    </ImportDrop>
  );
  const main = !agent ? (
    <EmptyState
      hasAgents={agents.length > 0}
      onAdd={(source) => open("create", source)}
      onImport={(source) => open("import", source)}
    />
  ) : (
    <ChatView
      agent={agent}
      blocked={replyBlocker(agent, {
        parts: partsOf(agent),
        ui,
        models: api.setModel && models,
        onSelect: (id) => void act(() => api.session(agent.id, "select", id)),
        onTurnOn: (part) => switchAgentPart(agent, part, true),
      })}
      draft={drafts.text(key)}
      onDraft={(value) => drafts.setText(key, value)}
      onBack={returnToList}
      models={models}
      modelPages={
        // The composer can leave for the extensions; its draft stays.
        modelPages?.length || !onModels
          ? modelPages
          : [{ label: "扩展", open: () => onModels(null) }]
      }
      onModel={
        api.setModel &&
        ((model) => void act(() => api.setModel!(agent.id, model)))
      }
      onEffort={
        api.setEffort &&
        ((effort) => void act(() => api.setEffort!(agent.id, effort)))
      }
      onAction={(action, source) => agentAction(agent, action, source)}
      onSession={(action, id) =>
        void act(() => api.session(agent.id, action, id))
      }
      onDeleteSession={(id, source) =>
        open({ action: "deleteSession", agent, session: id }, source)
      }
      onRenameSession={
        api.renameSession &&
        ((id, source) =>
          open({ action: "renameSession", agent, session: id }, source))
      }
      latest={latest}
      onCancel={() => api.cancel(agent.id)}
      attach={
        api.info.attachments
          ? {
              files: drafts.files(key),
              onAdd: (added) => drafts.addFiles(key, added),
              onRemove: (index) => drafts.removeFile(key, index),
            }
          : undefined
      }
      editing={rewrite.editing(key)}
      onSend={() => {
        if (!rewrite.send(agent, key)) drafts.send(key, agent.id);
      }}
      onEdit={
        rewrite.start && ((message) => rewrite.start!(agent, key, message))
      }
      onRegenerate={
        rewrite.regenerate && ((message) => rewrite.regenerate!(agent, message))
      }
      onDeleteMessage={
        api.removeMessage
          ? (id) =>
              void act(async () => {
                await api.removeMessage!(agent.id, agent.currentSessionId, id);
                offerUndo(agent.id, "已删除消息");
              })
          : undefined
      }
      onOpenLink={(url) =>
        void onOpenLink(url).catch(() => setError("未能在浏览器中打开链接。"))
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
      onSessionDeleted={(id) => offerUndo(id, "已删除会话")}
      modelPages={modelPages?.length ? modelPages : undefined}
      files={files}
      onNotice={setNotice}
    />
  );
  // Details pop out above the conversation: a bottom sheet on phones, a
  // non-modal drawer on desktop so the chat stays usable beside them.
  const details = showDetail && agent && (
    <Dialog
      title="Agent 详情"
      sheet={mobile ? "bottom" : "right"}
      returnFocusTo={detailTrigger.current}
      fallbackFocus={focusFallback}
      onClose={() => setDetail(false)}
    >
      {feedback}
      {detailsOf(agent, () => setDetail(false), true)}
    </Dialog>
  );
  const settingsAgent = settings && agents.find((a) => a.id === settings.id);
  // Settings open over everything, for any row, without switching the chat.
  const settingsDialog = settingsAgent && (
    <Dialog
      title="Agent 设置"
      sheet={mobile ? "bottom" : undefined}
      returnFocusTo={settings.source}
      fallbackFocus={focusFallback}
      onClose={() => setSettings(null)}
    >
      {feedback}
      {detailsOf(settingsAgent, () => setSettings(null), false)}
      {/* Edits save in place, so the dialog only needs a way out. */}
      <DialogDone onDone={() => setSettings(null)} />
    </Dialog>
  );
  // The undo toast shows in the topmost layer that is open.
  const outside = !showDetail && !settingsAgent;
  if (mobile)
    return (
      <div
        ref={workspaceRoot}
        data-slot="agent-workspace"
        tabIndex={-1}
        className="relative flex h-full min-h-0 bg-chat outline-none"
      >
        {outside && feedback}
        {/* Phones show the list or one conversation, never both. */}
        {agent || !agents.length ? (
          <div className="flex min-h-0 w-full flex-col">{main}</div>
        ) : (
          list
        )}
        {details}
        {settingsDialog}
        {dialogs}
      </div>
    );
  return (
    <div
      ref={workspaceRoot}
      data-slot="agent-workspace"
      tabIndex={-1}
      className={cn(
        "relative flex h-full min-h-0 outline-none transition-[padding] duration-200 ease-out",
        showDetail && wide && "pr-[304px]",
      )}
    >
      {outside && feedback}
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
      {settingsDialog}
      {dialogs}
    </div>
  );
}
