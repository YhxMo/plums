import {
  createContext,
  useContext,
  useReducer,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import type { AgentRecord } from "@plums/host";
import type { Resource, CatalogItem, AgentDetail } from "../shared/types.js";
import type { AgentStatus } from "../components/StatusChip.js";
import type { AgentRuntimeState } from "../shared/types.js";
import type { Route, Tab } from "../app/route.js";

interface ManagerState {
  route: Route;
  statuses: Record<string, AgentStatus>;
  runtime: AgentRuntimeState;
  agents: AgentRecord[];
  library: CatalogItem[];
  resources: Resource[];
  record?: AgentRecord;
  dnsMode: string;
  loading: boolean;
  initialized: boolean;
  loadError: string;
}
type Change =
  | { type: "runtime"; value: AgentRuntimeState }
  | { type: "loading"; id?: string }
  | {
      type: "loaded";
      statuses: Record<string, AgentStatus>;
      agents: AgentRecord[];
      library: CatalogItem[];
      dnsMode: string;
      id?: string;
      detail?: AgentDetail;
    }
  | { type: "failed"; error: string }
  | { type: "tab"; tab: Tab };
const initialState: ManagerState = {
  route: { tab: "home" },
  statuses: {},
  runtime: null,
  agents: [],
  library: [],
  resources: [],
  dnsMode: "system",
  loading: true,
  initialized: false,
  loadError: "",
};
function reducer(state: ManagerState, change: Change): ManagerState {
  switch (change.type) {
    case "runtime":
      return { ...state, runtime: change.value };
    case "loading":
      return {
        ...state,
        loading: true,
        loadError: "",
        route: { ...state.route, agentId: change.id },
        ...(change.id !== state.route.agentId
          ? { record: undefined, resources: [] }
          : {}),
      };
    case "loaded":
      return {
        ...state,
        agents: change.agents,
        statuses: change.statuses,
        library: change.library,
        dnsMode: change.dnsMode,
        route: { ...state.route, agentId: change.id },
        resources: change.detail?.packages ?? [],
        record: change.detail?.record,
        loading: false,
        initialized: true,
        loadError: "",
      };
    case "failed":
      return { ...state, loading: false, loadError: change.error };
    case "tab":
      return { ...state, route: { ...state.route, tab: change.tab } };
  }
}
function failureMessage(error: unknown): string {
  const failure = error as { message?: string } | null;
  return typeof failure?.message === "string"
    ? failure.message
    : "操作未完成。";
}
interface ManagerContextValue {
  state: ManagerState;
  load: (id?: string) => Promise<AgentDetail | undefined>;
  setTab: (tab: Tab) => void;
}
const ManagerContext = createContext<ManagerContextValue | null>(null);
export function ManagerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const selected = useRef<string | undefined>(undefined);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const load = useCallback(async (id = selected.current) => {
    const generation = ++epoch.current;
    selected.current = id;
    dispatch({ type: "loading", id });
    try {
      const [agents, library, settings] = await Promise.all([
        window.manager.call("list") as Promise<AgentRecord[]>,
        window.manager.call("library") as Promise<CatalogItem[]>,
        window.manager.call("desktopSettings") as Promise<{ dnsMode: string }>,
      ]);
      if (!mounted.current || generation !== epoch.current) return;
      const current = agents.some((agent) => agent.instanceId === id)
        ? id
        : agents[0]?.instanceId;
      const statuses = Object.fromEntries(
        await Promise.all(
          agents.map(async (agent) => [
            agent.instanceId,
            (await window.manager.call("agentStatus", {
              instanceId: agent.instanceId,
            })) as AgentStatus,
          ]),
        ),
      );
      if (!mounted.current || generation !== epoch.current) return;
      const detail = current
        ? ((await window.manager.call("resources", {
            instanceId: current,
          })) as AgentDetail)
        : undefined;
      if (!mounted.current || generation !== epoch.current) return;
      selected.current = current;
      dispatch({
        type: "loaded",
        statuses,
        agents,
        library,
        dnsMode: settings.dnsMode,
        id: current,
        detail,
      });
      return detail;
    } catch (error) {
      if (!mounted.current || generation !== epoch.current) return;
      dispatch({ type: "failed", error: failureMessage(error) });
      throw error;
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const runtimeEpoch = { changed: false };
    const runtimeEvents = window.manager.onAgentState((value) => {
      runtimeEpoch.changed = true;
      dispatch({ type: "runtime", value });
    });
    void window.manager
      .call("agentState")
      .then((value) => {
        if (mounted.current && !runtimeEpoch.changed)
          dispatch({ type: "runtime", value: value as AgentRuntimeState });
      })
      .catch(() => {});
    void load().catch(() => {});
    const unsubscribe = window.manager.onRefresh(
      () => void load().catch(() => {}),
    );
    return () => {
      mounted.current = false;
      epoch.current++;
      unsubscribe();
      runtimeEvents();
    };
  }, [load]);
  const setTab = useCallback((tab: Tab) => dispatch({ type: "tab", tab }), []);
  const value = useMemo(
    () => ({
      state: {
        ...state,
        statuses: state.runtime
          ? {
              ...state.statuses,
              [state.runtime.instanceId]: "running" as const,
            }
          : state.statuses,
      },
      load,
      setTab,
    }),
    [state, load, setTab],
  );
  return (
    <ManagerContext.Provider value={value}>{children}</ManagerContext.Provider>
  );
}
export function useManagerStore() {
  const value = useContext(ManagerContext);
  if (!value) throw Error("ManagerProvider is required");
  return value;
}
