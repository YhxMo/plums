import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { Agent, AgentProvider } from "../../../modules/sdk/agents";
import type { WorkspaceChromeController } from "../../../modules/sdk";
import { AgentList } from "../../components/AgentList";
import { ChatView } from "../../components/ChatView";
import { DetailPanel } from "../../components/DetailPanel";
import { EmptyState } from "../../components/EmptyState";
import { Dialog } from "../../components/Dialog";
import { Icon } from "../../components/Icon";
import { useMediaQuery } from "../../shell/useMediaQuery";
import { useAgentModals } from "./useAgentModals";
import { AgentDialogs } from "./AgentDialogs";
import { fallbackFocus } from "./focus";
import s from "../../components/Workspace.module.css";

export function AgentWorkspace({
  api,
  chrome,
  onExtensions,
}: {
  api: AgentProvider;
  chrome: WorkspaceChromeController;
  onExtensions: () => void;
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
  const focusFallback = () => fallbackFocus(workspaceRoot.current);
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
      title,
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
  }, [chrome, agent, agents, detail, mobile]);
  function agentAction(
    a: Agent,
    action: "pin" | "rename" | "remove",
    source?: HTMLElement | null,
  ) {
    if (action === "pin")
      void act(() => api.update(a.id, { pinned: !a.pinned }));
    else open({ action, agent: a }, source);
  }
  const feedback = (className: string) =>
    (error || notice) && !modal ? (
      <div className={className} role={error ? "alert" : "status"}>
        {error || notice}
        <button
          className="icon-button"
          aria-label="关闭提示"
          onClick={() => {
            setError("");
            setNotice("");
          }}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
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
      {!(mobile && detail && agent) && feedback(s.sharedFeedback)}
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
            onExtensions={onExtensions}
          />
        ) : (
          <ChatView
            agent={agent}
            provider={api.info}
            draft={drafts[key] ?? ""}
            onDraft={(value) => setDrafts((d) => ({ ...d, [key]: value }))}
            onBack={() => {
              setSelected(null);
              setDetail(false);
            }}
            onDetail={(source) => {
              detailTrigger.current = source;
              setDetail((d) => !d);
            }}
            onCancel={() => api.cancel(agent.id)}
            onSend={() => {
              const input = drafts[key] ?? "";
              void act(async () => {
                await api.send(agent.id, input);
                setDrafts((d) => (d[key] === input ? { ...d, [key]: "" } : d));
              });
            }}
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
            <div className={s.mobileDetail}>
              {feedback(s.detailFeedback)}
              {detailContent}
            </div>
          </Dialog>
        ) : (
          <div className={s.detailHost}>{detailContent}</div>
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
        onExtensions={onExtensions}
      />
    </div>
  );
}
