import { randomUUID } from "node:crypto";
import {
  desktopContribution,
  copyPanelPost,
  copyPanelLayout,
  panelDenied,
  type PanelContext,
  type PanelDeclaration,
  type PanelPost,
  type PanelMessage,
  type PanelLayout,
} from "@plums/sdk";
import type { PackageFiles } from "@plums/core";
import {
  protocolPlan,
  protocolFingerprint,
  resolveProtocol,
  type ProtocolBinding,
} from "./protocol-bindings.js";
import type { Session } from "./host.js";

export interface PanelResource {
  context: PanelContext;
  entry: string;
  files: PackageFiles;
  legacyAgentEvents?: boolean;
}
export type PanelDelivery =
  | {
      type: "message";
      agentId: string;
      sessionId: string;
      message: PanelMessage;
    }
  | { type: "closed"; agentId: string; sessionId: string; handle?: string };
interface Endpoint {
  context: PanelContext;
  controller: AbortController;
  signature: string;
  declaration?: PanelDeclaration;
  binding?: ProtocolBinding;
}
interface FrontendSession {
  id: string;
  agent: Session;
  root: Endpoint;
  endpoints: Map<string, Endpoint>;
  fingerprint: string;
  pendingOpen: number;
  inFlight: number;
  rateStart: number;
  rateCount: number;
  receipts: Map<string, { from: string; to: string }>;
  detach: () => void;
}
interface Hooks {
  current(s: Session): boolean;
  files(s: Session, componentId: string, entry: string): Promise<PackageFiles>;
  sanitize(s: Session, data: unknown): Promise<unknown>;
  deliver(event: PanelDelivery): void | Promise<void>;
  closed(s: Session): void;
  closedEndpoint?(s: Session, componentId: string, handle: string): void;
}
const freeze = <T>(v: T): T => {
  if (v && typeof v === "object") {
    Object.values(v).forEach(freeze);
    Object.freeze(v);
  }
  return v;
};
/** Ephemeral identities only. Nothing here is persisted or included in Agent exports. */
export class PanelSessions {
  private sessions = new Map<string, FrontendSession>();
  private openings = new Map<string, object>();
  constructor(private hooks: Hooks) {}
  private notify(event: PanelDelivery): void {
    try {
      void Promise.resolve(this.hooks.deliver(freeze(event))).catch(() => {});
    } catch {}
  }
  private async signature(s: Session, pkg: string): Promise<string> {
    const p = await s.core.getPackage(pkg);
    if (!p.installed.enabled) panelDenied("PANEL_COMPONENT_DISABLED");
    return protocolFingerprint([
      p.installed,
      p.manifest,
      await s.core.settingsRevision(pkg),
    ]);
  }
  async open(
    s: Session,
    frontend: {
      packageId: string;
      entry: string;
      files: PackageFiles;
      legacyAgentEvents?: boolean;
    },
  ): Promise<PanelResource> {
    const opening = {};
    this.openings.set(s.record.instanceId, opening);
    for (const old of this.sessions.values())
      if (old.agent.record.instanceId === s.record.instanceId)
        this.close(old.id);
    const signal = s.controller.signal;
    const id = randomUUID(),
      handle = randomUUID();
    const root: Endpoint = {
      context: {
        agentId: s.record.instanceId,
        componentId: frontend.packageId,
        sessionId: id,
        handle,
        viewId: "root",
      },
      controller: new AbortController(),
      signature: await this.signature(s, frontend.packageId),
    };
    const fingerprint = (await protocolPlan(s.core, s.record)).fingerprint;
    if (
      !this.hooks.current(s) ||
      signal.aborted ||
      this.openings.get(s.record.instanceId) !== opening
    )
      panelDenied();
    const cancel = () => this.close(id);
    const state: FrontendSession = {
      id,
      agent: s,
      root,
      endpoints: new Map([[handle, root]]),
      fingerprint,
      pendingOpen: 0,
      inFlight: 0,
      rateStart: Date.now(),
      rateCount: 0,
      receipts: new Map(),
      detach: () => signal.removeEventListener("abort", cancel),
    };
    this.sessions.set(id, state);
    signal.addEventListener("abort", cancel, { once: true });
    await this.check(state, root);
    return {
      context: structuredClone(root.context),
      entry: frontend.entry,
      files: frontend.files,
      legacyAgentEvents: frontend.legacyAgentEvents === true,
    };
  }
  private state(sessionId: string, handle: string) {
    const s = this.sessions.get(sessionId),
      e = s?.endpoints.get(handle);
    if (!s || !e) panelDenied("PANEL_HANDLE_STALE");
    return { s, e };
  }
  private async check(s: FrontendSession, e: Endpoint): Promise<void> {
    try {
      if (
        this.sessions.get(s.id) !== s ||
        s.endpoints.get(e.context.handle) !== e ||
        e.controller.signal.aborted ||
        !this.hooks.current(s.agent) ||
        s.agent.controller.signal.aborted
      )
        panelDenied("PANEL_HANDLE_STALE");
      if (
        (await protocolPlan(s.agent.core, s.agent.record)).fingerprint !==
          s.fingerprint ||
        (await this.signature(s.agent, s.root.context.componentId)) !==
          s.root.signature ||
        (await this.signature(s.agent, e.context.componentId)) !== e.signature
      )
        panelDenied("PANEL_SESSION_CHANGED");
      if (
        e.binding &&
        JSON.stringify(
          await resolveProtocol(
            s.agent.core,
            s.agent.record,
            s.root.context.componentId,
            e.binding.requirementId,
          ),
        ) !== JSON.stringify(e.binding)
      )
        panelDenied("PANEL_BINDING_CHANGED");
      if (
        this.sessions.get(s.id) !== s ||
        s.endpoints.get(e.context.handle) !== e ||
        e.controller.signal.aborted ||
        !this.hooks.current(s.agent)
      )
        panelDenied("PANEL_HANDLE_STALE");
    } catch (error) {
      if (
        s.endpoints.get(e.context.handle) === e &&
        !e.controller.signal.aborted
      )
        this.close(s.id);
      throw error;
    }
  }
  async principal(sessionId: string, handle: string, messageId?: string) {
    const { s, e } = this.state(sessionId, handle);
    await this.check(s, e);
    const receipt =
      messageId === undefined ? undefined : s.receipts.get(messageId);
    if (messageId !== undefined && (!receipt || receipt.to !== handle))
      panelDenied("PANEL_MESSAGE_STALE");
    const sender = receipt && s.endpoints.get(receipt.from);
    if (receipt && !sender) panelDenied("PANEL_MESSAGE_STALE");
    if (sender) await this.check(s, sender);
    return {
      agent: s.agent,
      context: structuredClone(e.context),
      sender: sender?.context.componentId,
      signal: AbortSignal.any([
        e.controller.signal,
        ...(sender ? [sender.controller.signal] : []),
      ]),
      assertActive: async () => {
        await this.check(s, e);
        if (sender) await this.check(s, sender);
      },
    };
  }
  async openPanel(
    sessionId: string,
    handle: string,
    requirementId: string,
    panelId: string,
  ): Promise<PanelResource> {
    const { s, e } = this.state(sessionId, handle);
    await this.check(s, e);
    if (
      e !== s.root ||
      typeof requirementId !== "string" ||
      typeof panelId !== "string"
    )
      panelDenied("PANEL_OPEN_DENIED");
    if (s.endpoints.size + s.pendingOpen >= 9) panelDenied("PANEL_LIMIT");
    s.pendingOpen++;
    try {
      const binding = await resolveProtocol(
        s.agent.core,
        s.agent.record,
        e.context.componentId,
        requirementId,
      );
      const declaration = desktopContribution(
        (await s.agent.core.getPackage(binding.providerId)).manifest,
      )?.panels?.find(
        (p) => p.id === panelId && p.provideId === binding.provideId,
      );
      if (!declaration) panelDenied("PANEL_NOT_DECLARED");
      const files = await this.hooks.files(
        s.agent,
        binding.providerId,
        declaration.entry,
      );
      const signature = await this.signature(s.agent, binding.providerId);
      await this.check(s, e);
      const existing = [...s.endpoints.values()].find(
        (p) =>
          p.binding?.requirementId === requirementId &&
          p.context.panelId === panelId,
      );
      if (existing) {
        await this.check(s, existing);
        return {
          context: structuredClone(existing.context),
          entry: declaration.entry,
          files,
        };
      }
      const context: PanelContext = {
        agentId: s.agent.record.instanceId,
        componentId: binding.providerId,
        sessionId,
        handle: randomUUID(),
        panelId,
        requirementId,
        viewId: `panel:${requirementId}:${panelId}`,
        parentHandle: handle,
      };
      const endpoint: Endpoint = {
        context,
        controller: new AbortController(),
        signature,
        declaration: structuredClone(declaration),
        binding,
      };
      s.endpoints.set(context.handle, endpoint);
      await this.check(s, endpoint);
      return {
        context: structuredClone(context),
        entry: declaration.entry,
        files,
      };
    } finally {
      s.pendingOpen--;
    }
  }
  async layout(
    sessionId: string,
    handle: string,
    layout: PanelLayout,
  ): Promise<PanelLayout> {
    const copied = copyPanelLayout(layout),
      { s, e } = this.state(sessionId, handle);
    await this.check(s, e);
    if (e !== s.root) panelDenied("PANEL_LAYOUT_DENIED");
    for (const item of copied.panels) {
      const child = s.endpoints.get(item.handle);
      if (!child || child === s.root) panelDenied("PANEL_HANDLE_STALE");
      await this.check(s, child);
    }
    await this.check(s, e);
    return copied;
  }
  /** Called only by trusted composition management, never by the business bridge. */
  async openView(
    sessionId: string,
    source: string,
    frontend: { packageId: string; entry: string; files: PackageFiles },
  ): Promise<PanelResource> {
    const { s, e } = this.state(sessionId, source);
    await this.check(s, e);
    if (e !== s.root) panelDenied("PANEL_OPEN_DENIED");
    const viewId = `frontend:${frontend.packageId}`;
    if (s.endpoints.size + s.pendingOpen >= 9) panelDenied("PANEL_LIMIT");
    s.pendingOpen++;
    try {
      const signature = await this.signature(s.agent, frontend.packageId);
      await this.check(s, e);
      if ([...s.endpoints.values()].some((p) => p.context.viewId === viewId))
        panelDenied("PANEL_ALREADY_OPEN");
      const context: PanelContext = {
        agentId: s.agent.record.instanceId,
        componentId: frontend.packageId,
        sessionId,
        handle: randomUUID(),
        viewId,
        parentHandle: source,
      };
      const endpoint: Endpoint = {
        context,
        signature,
        controller: new AbortController(),
      };
      s.endpoints.set(context.handle, endpoint);
      await this.check(s, endpoint);
      return {
        context: structuredClone(context),
        entry: frontend.entry,
        files: frontend.files,
      };
    } finally {
      s.pendingOpen--;
    }
  }
  async contexts(sessionId: string, source: string): Promise<PanelContext[]> {
    const { s, e } = this.state(sessionId, source);
    if (e !== s.root) panelDenied("PANEL_LAYOUT_DENIED");
    for (const endpoint of s.endpoints.values()) await this.check(s, endpoint);
    return [...s.endpoints.values()].map((p) => structuredClone(p.context));
  }
  closeAgent(id: string) {
    for (const s of this.sessions.values())
      if (s.agent.record.instanceId === id) this.close(s.id);
  }
  closeComponents(id: string, components: string[]) {
    for (const s of this.sessions.values())
      if (
        s.agent.record.instanceId === id &&
        [...s.endpoints.values()].some((e) =>
          components.includes(e.context.componentId),
        )
      )
        this.close(s.id);
  }
  async post(
    sessionId: string,
    handle: string,
    input: PanelPost,
  ): Promise<void> {
    const copied = copyPanelPost(input),
      { s, e } = this.state(sessionId, handle),
      target = s.endpoints.get(copied.to);
    if (!target || target === e || (e !== s.root && target !== s.root))
      panelDenied("PANEL_TARGET_DENIED");
    const child = e === s.root ? target : e;
    if (
      !child.declaration?.topics.includes(copied.topic) ||
      child.declaration.messageVersion !== copied.version
    )
      panelDenied("PANEL_TOPIC_DENIED");
    if (Date.now() - s.rateStart >= 1000) {
      s.rateStart = Date.now();
      s.rateCount = 0;
    }
    if (s.inFlight >= 32 || ++s.rateCount > 128)
      panelDenied("PANEL_BACKPRESSURE");
    s.inFlight++;
    try {
      await this.check(s, e);
      await this.check(s, target);
      let data: unknown;
      try {
        data = await this.hooks.sanitize(s.agent, copied.data);
      } catch {
        panelDenied("PANEL_MESSAGE_UNAVAILABLE");
      }
      await this.check(s, e);
      await this.check(s, target);
      const messageId = randomUUID();
      if (s.receipts.size >= 128)
        s.receipts.delete(s.receipts.keys().next().value!);
      s.receipts.set(messageId, { from: handle, to: target.context.handle });
      const message: PanelMessage = {
        ...copied,
        data,
        sessionId,
        messageId,
        from: {
          handle,
          componentId: e.context.componentId,
          ...(e.context.panelId ? { panelId: e.context.panelId } : {}),
        },
      };
      try {
        await this.hooks.deliver(
          freeze({
            type: "message",
            agentId: s.agent.record.instanceId,
            sessionId,
            message,
          }),
        );
      } catch {
        panelDenied("PANEL_DELIVERY_FAILED", "unknown");
      }
    } finally {
      s.inFlight--;
    }
  }
  async closePanel(
    sessionId: string,
    source: string,
    handle: string,
  ): Promise<void> {
    const { s, e } = this.state(sessionId, source);
    await this.check(s, e);
    const target = s.endpoints.get(handle);
    if (!target || (e !== s.root && target !== e))
      panelDenied("PANEL_CLOSE_DENIED");
    if (target === s.root) {
      this.close(sessionId);
      return;
    }
    s.endpoints.delete(handle);
    target.controller.abort();
    this.hooks.closedEndpoint?.(
      s.agent,
      target.context.componentId,
      target.context.handle,
    );
    for (const [id, r] of s.receipts)
      if (r.from === handle || r.to === handle) s.receipts.delete(id);
    this.notify({
      type: "closed",
      agentId: s.agent.record.instanceId,
      sessionId,
      handle,
    });
  }
  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    this.sessions.delete(sessionId);
    s.detach();
    for (const e of s.endpoints.values()) {
      e.controller.abort();
      this.hooks.closedEndpoint?.(
        s.agent,
        e.context.componentId,
        e.context.handle,
      );
    }
    s.endpoints.clear();
    s.receipts.clear();
    this.hooks.closed(s.agent);
    this.notify({
      type: "closed",
      agentId: s.agent.record.instanceId,
      sessionId,
    });
  }
}
