import type { CapabilityCaller, PackageContents } from "@plums/core";
import type {
  ContributionKind,
  FoundationSession,
  FoundationActor,
} from "@plums/sdk";

/** Trusted call state. A provider cannot choose or replace these principals. */
export interface InvocationContext {
  assertActive?: () => Promise<void>;
  policyEvaluation?: boolean;
  callers: CapabilityCaller[];
  ancestry: string[];
  signal: AbortSignal;
  invocationId?: string;
  engineScope?: string;
  grantId?: string;
  grantScope?: import("@plums/core").GrantUse;
  resourceInstanceId?: string;
  taskId?: string;
  commonCallId?: string;
  onDispatch?: () => void;
  frontend?: import("@plums/sdk").PanelContext;
}
export type RuntimeBridge = (
  method: string,
  args: Record<string, unknown>,
  context: InvocationContext,
) => Promise<unknown>;
export type HostFoundationSession = FoundationSession<InvocationContext>;
export interface FoundationSessionOptions {
  component: PackageContents;
  actor: Omit<FoundationActor, "instanceId">;
  bridge: RuntimeBridge;
  assertActive(): Promise<void>;
  assertCurrent(): void;
  /** Trusted process observer; never supplied by a component. */
  trackProcess?: (child: import("node:child_process").ChildProcess) => void;
  allocateSnapshot?: () => { root: string; release(): void };
  beforeInvoke?: (
    kind: ContributionKind,
    name: string,
    input: unknown,
    context: InvocationContext,
  ) => Promise<(() => Promise<void>) | undefined>;
}
export interface FoundationAdapterOptions extends FoundationSessionOptions {
  readonly binding: Readonly<FoundationActor>;
}
export function copyInvocationContext(
  context: InvocationContext,
): InvocationContext {
  return {
    ...context,
    callers: structuredClone(context.callers),
    ancestry: [...context.ancestry],
    ...(context.grantScope
      ? { grantScope: structuredClone(context.grantScope) }
      : {}),
    ...(context.frontend
      ? { frontend: structuredClone(context.frontend) }
      : {}),
  };
}
