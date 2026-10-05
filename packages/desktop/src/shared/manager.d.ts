import type { AgentRuntimeState } from "./types.js";
export interface ManagerBridge {
  onWindowState: (fn: (state: { fullscreen: boolean }) => void) => () => void;
  onAgentState: (fn: (state: AgentRuntimeState) => void) => () => void;
  call: (method: string, args?: unknown) => Promise<unknown>;
  filePath: (file: File) => string;
  onSelect: (fn: (instanceId: string) => void) => () => void;
  onRefresh: (fn: () => void) => () => void;
  onImport: (fn: (preview: unknown) => void) => () => void;
}
declare global {
  interface Window {
    manager: ManagerBridge;
  }
}
