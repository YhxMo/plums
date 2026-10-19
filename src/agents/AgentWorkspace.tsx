import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Agent, AgentProvider } from "../../modules/agents/contract";
import type { WorkspaceChromeController } from "../../modules/sdk";
import { AgentList } from "./AgentList";
import { ChatView } from "./ChatView";
import { DetailPanel } from "./DetailPanel";
import { EmptyState } from "./EmptyState";
import { Dialog } from "../components/Dialog";
import { Toast } from "../components/Toast";
import { useMediaQuery } from "../components/useMediaQuery";
import { useAgentModals } from "./useAgentModals";
import { AgentDialogs } from "./AgentDialogs";
import { fallbackFocus } from "./focus";
import s from "./AgentList.module.css";
import detailStyles from "./DetailPanel.module.css";

export function AgentWorkspace({
  api,
  chrome,
  onExtensions,
  onModels,
}: {
  api: AgentProvider;
  chrome: WorkspaceChromeController;
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
  const { modal, error, notice, setError, setNotice, open, act } = modals;
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
    const session = agent?.sessions.find(
      (item) => item.id === agent.currentSessionId,
    );
    const title =
      agent && session
        ? session.title && session.title !== agent.name
          ? `${agent.name} · ${session.title}`
          : agent.name
        : "";
    chrome.publish({
      // The desktop conversation names itself in its own header.
      title: mobile ? title : "",
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
    action: "pin" | "rename" | "remove",
    source?: HTMLElement | null,
  ) {
    if (action === "pin")
      void act(() => api.update(a.id, { pinned: !a.pinned }));
    else open({ action, agent: a }, source);
  }
  const feedback =
    (error || notice) && !modal ? (
      <Toast
        key={error || notice}
        message={error || notice}
        error={!!error}
        onDone={() => {
          setError("");
          setNotice("");
        }}
      />
    ) : null;
  const detailContent = agent && (
    <DetailPanel
      agent={agent}
      provider={api.info}
      onClose={() => setDetail(false)}
      onPin={() => agentAction(agent, "pin")}
      onSession={(action, id) =>
        void act(() => api.session(agent.id, action, id))
      }
      onDeleteSession={(id, source) =>
        open({ action: "deleteSession", agent, session: id }, source)
      }
      onOpenExtension={(id) => {
        setDetail(false);
        onExtensions(id);
      }}
      choices={api.extensionChoices?.()}
      models={api.modelChoices?.()}
      onModel={
        api.setModel &&
        ((model) => void act(() => api.setModel!(agent.id, model)))
      }
      onModels={
        onModels &&
        (() => {
          setDetail(false);
          onModels();
        })
      }
      onExtension={
        api.setExtension &&
        ((extensionId, on) =>
          void act(() => api.setExtension!(agent.id, extensionId, on)))
      }
    />
  );
  return (
    <div
      ref={workspaceRoot}
      className={s.workspace}
      data-conversation={!!agent}
      data-has-agents={agents.length > 0}
      data-detail={detail}
    >
      {!(mobile && detail && agent) && feedback}
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
      <div className={s.mainColumn}>
        {!agent ? (
          <EmptyState
            hasAgents={agents.length > 0}
            onImport={(source) => open("import", source)}
            onAdd={(source) => open("create", source)}
            onExtensions={() => onExtensions()}
          />
        ) : (
          <ChatView
            agent={agent}
            provider={api.info}
            draft={drafts[key] ?? ""}
            onDraft={(value) => setDrafts((d) => ({ ...d, [key]: value }))}
            onBack={returnToList}
            onDetail={(source) => {
              detailTrigger.current = source;
              setDetail((d) => !d);
            }}
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
        )}
      </div>
      {detail &&
        agent &&
        (mobile ? (
          <Dialog
            title="Agent 详情"
            bare
            returnFocusTo={detailTrigger.current}
            fallbackFocus={focusFallback}
            onClose={() => setDetail(false)}
          >
            <div className={detailStyles.mobileDetail}>
              {feedback}
              {detailContent}
            </div>
          </Dialog>
        ) : (
          <div className={detailStyles.detailHost}>{detailContent}</div>
        ))}
      <AgentDialogs
        api={api}
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
      />
    </div>
  );
}
