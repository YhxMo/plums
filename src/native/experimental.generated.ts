// Generated from compiled Rust IPC declarations. Do not edit.
import type { NativeCommands } from "./contract.generated";
export interface ExperimentalCommands extends NativeCommands {
  probe_grant: {
    args: { owner: string; allow: boolean };
    response: null;
    error: { code: string; outcome: string };
  };
  probe_prepare: {
    args: { owner: string; id: string; binding: string; body: string };
    response: null;
    error: { code: string; outcome: string };
  };
  probe_cancel: {
    args: { owner: string; id: string };
    response: null;
    error: { code: string; outcome: string };
  };
  probe_execute: {
    args: { owner: string; id: string };
    response: { status: number; body: string };
    error: { code: string; outcome: string };
  };
  probe_faults: {
    args: {
      owner: string;
      faults: {
        prepare_receipt?: boolean;
        prepare_before?: boolean;
        cancel_before?: boolean;
        cancel_receipt?: boolean;
        execute_receipt?: boolean;
      };
    };
    response: null;
    error: { code: string; outcome: string };
  };
  probe_info: {
    args: Record<string, never>;
    response: { os: string; arch: string; pending: number };
    error: never;
  };
}
