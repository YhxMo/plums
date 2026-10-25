import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  Agent,
  AgentProvider,
  Attachment,
} from "@modules/agents/contract";
import { attachmentProblem } from "@modules/agents/attachments";
import type { Named, WorkspaceChromeController } from "@modules/sdk";
import { cn } from "cn";
import { AgentList } from "./AgentList";
import { ChatView } from "./ChatView";
import type { Blocked } from "./Composer";
import { DetailPanel } from "./DetailPanel";
import { EmptyState } from "./EmptyState";
import { Dialog } from "@/components/Dialog";
import { Button } from "@/components/ui/button";
import { ActionToast } from "@/components/Toast";
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
import { fallbackFocus } from "./focus";
import { toAttachment } from "./attachmentFile";
import { AVATAR_BASE64, AVATAR_SIDE, scaledPicture } from "./imageFile";
import { agentParts, switchPart, type Part } from "./parts";

// The handle is the gap between the list and the conversation card; it only
// shows a brand-coloured line while used.
const handle =
  "w-2 bg-transparent after:w-0.5 after:rounded-full after:transition-colors hover:after:bg-brand/50 data-[separator=active]:after:bg-brand";

export function AgentWorkspace({
  api,
  chrome,
  ui,
  onExtensions,
  onModels,
  onOpenLink,
}: {
  api: AgentProvider;
  chrome: WorkspaceChromeController;
  /** This interface, which each Agent can switch off like its other parts. */
  ui?: Named;
  /** Opens extension management, selecting `id` when given. */
  onExtensions: (id?: string) => void;
  /** Opens the page where the user manages model connections. */
  onModels?: () => void;
  /** Hands an https link to the browser. */
  onOpenLink: (url: string) => Promise<unknown>;
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
  const { error, notice, setError, setNotice, open, act, report } = modals;
  // The removal the current notice can take back, if the provider can.
  const [undoable, setUndoable] = useState<{
    agentId: string;
    notice: string;
  } | null>(null);
  function offerUndo(agentId: string, text: string) {
    if (!api.undo) return;
    setNotice(text);
    setUndoable({ agentId, notice: text });
  }
  useEffect(
    () =>
      chrome.connect((id) => {
        setSelected(id);
        setDetail(false);
      }),
    [chrome],
  );
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  // Files waiting to be sent, kept per conversation like the text.
  const [files, setFiles] = useState<Record<string, Attachment[]>>({});
  const filesNow = useRef(files);
  filesNow.current = files;
  const rewrite = useRewrite({
    api,
    modals,
    drafts,
    setDrafts,
    offerUndo,
  });
  const agent = agents.find((a) => a.id === selected);
  // The open conversation is read; replies elsewhere count as unread.
  const viewing = visible ? (agent?.id ?? null) : null;
  useLayoutEffect(() => {
    api.view?.(viewing);
    return () => api.view?.(null);
  }, [api, viewing]);
  async function addFiles(to: string, added: File[]) {
    const read: Attachment[] = [];
    for (const file of added) {
      try {
        read.push(await toAttachment(file));
      } catch (error) {
        setError(error instanceof Error ? error.message : "无法添加文件。");
      }
    }
    if (!read.length) return;
    const next = [...(filesNow.current[to] ?? []), ...read];
    const problem = attachmentProblem(next);
    if (problem) setError(problem);
    else setFiles((current) => ({ ...current, [to]: next }));
  }
  const key = agent ? `${agent.id}:${agent.currentSessionId}` : "";
  const addFilesNow = useRef(addFiles);
  addFilesNow.current = addFiles;
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
      drop: {
        label: dropLabel,
        add: dropAdds
          ? (added) => void addFilesNow.current(key, [...added])
          : undefined,
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
  ]);
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
      action={
        undoable && notice === undoable.notice
          ? {
              label: "撤销",
              onClick: () => {
                setUndoable(null);
                void act(async () => {
                  await api.undo!(undoable.agentId);
                  setNotice("已恢复");
                });
              },
            }
          : undefined
      }
      onDone={() => {
        setError("");
        setNotice("");
        setUndoable(null);
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
    // One reply at a time per Agent; the session waiting for it is a click away.
    const waiting = a.pending?.sessionId;
    if (waiting && waiting !== a.currentSessionId)
      return {
        text: `正在等「${a.sessions.find((s) => s.id === waiting)?.title}」里的回复，回复后才能再发一条。`,
        action: (
          <Button
            type="button"
            size="sm"
            onClick={() => void act(() => api.session(a.id, "select", waiting))}
          >
            查看
          </Button>
        ),
      };
    const off = (part?: Part) => part && !part.on;
    const turnOn = (part: Part) => (
      <Button
        type="button"
        size="sm"
        onClick={() => switchAgentPart(a, part, true)}
      >
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
    const picked =
      a.model &&
      models.some(
        (m) => m.provider === a.model!.provider && m.id === a.model!.model,
      );
    // Nothing picked yet: the message box shows the model picker itself.
    if (!picked) return undefined;
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
      onModels={onModels}
      onModel={
        api.setModel &&
        ((model) => void act(() => api.setModel!(agent.id, model)))
      }
      onEffort={
        api.setEffort &&
        ((effort) => void act(() => api.setEffort!(agent.id, effort)))
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
      onRenameSession={
        api.renameSession &&
        ((id, source) =>
          open({ action: "renameSession", agent, session: id }, source))
      }
      onCancel={() => api.cancel(agent.id)}
      attach={
        api.info.attachments
          ? {
              files: files[key] ?? [],
              onAdd: (added) => void addFiles(key, added),
              onRemove: (index) =>
                setFiles((f) => ({
                  ...f,
                  [key]: (f[key] ?? []).filter((_, i) => i !== index),
                })),
            }
          : undefined
      }
      editing={rewrite.editing(key)}
      onSend={() => {
        if (rewrite.send(agent, key)) return;
        const input = drafts[key] ?? "";
        const attached = files[key] ?? [];
        // The sent text shows as a pending bubble; a failed send puts it
        // back unless the user has started a new draft.
        setDrafts((d) => ({ ...d, [key]: "" }));
        setFiles((f) => ({ ...f, [key]: [] }));
        // A reply can take minutes; dialogs need not wait for it.
        void report(async () => {
          try {
            await api.send(agent.id, input, attached);
          } catch (error) {
            setDrafts((d) => (d[key] ? d : { ...d, [key]: input }));
            setFiles((f) => (f[key]?.length ? f : { ...f, [key]: attached }));
            throw error;
          }
        });
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
      <div ref={workspaceRoot} className="relative flex h-full min-h-0 bg-chat">
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
      data-frame="own"
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
