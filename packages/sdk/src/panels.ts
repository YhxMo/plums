import {
  IMPORT_INVALID,
  PERMISSION_DENIED,
  PlumsError,
  isManifestV2,
  type Manifest,
  type PackageFiles,
} from "@plumsjs/core";
import type { DesktopContribution, ContributionKind } from "./index.js";
import type { EngineSdk } from "./desktop-v2.js";

export const PANEL_MESSAGE_VERSION = "1.0" as const;
export const PANEL_MESSAGE_BYTES = 64 * 1024;
export interface PanelDeclaration {
  id: string;
  title: string;
  entry: string;
  provideId: string;
  messageVersion: typeof PANEL_MESSAGE_VERSION;
  topics: string[];
}
export interface PanelContext {
  agentId: string;
  componentId: string;
  sessionId: string;
  handle: string;
  panelId?: string;
  parentHandle?: string;
  /** Stable layout slot; never an execution credential. */
  viewId?: string;
  requirementId?: string;
}
export interface PanelPost {
  version: typeof PANEL_MESSAGE_VERSION;
  to: string;
  topic: string;
  data: unknown;
}
export interface PanelMessage extends PanelPost {
  sessionId: string;
  messageId: string;
  from: { handle: string; componentId: string; panelId?: string };
}
/** Fractions of the working area, below the trusted host bar. */
export interface PanelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface PanelLayout {
  root: PanelRect;
  panels: (PanelRect & { handle: string })[];
}
export interface FrontendPanelsSdk {
  open(requirementId: string, panelId: string): Promise<PanelContext>;
  close(handle: string): Promise<void>;
  layout(layout: PanelLayout): Promise<void>;
  post(message: PanelPost): Promise<void>;
  onMessage(callback: (message: PanelMessage) => void): () => void;
  /** Invoke this component's contribution with the message sender in the caller chain. */
  respond(
    messageId: string,
    kind: ContributionKind,
    name: string,
    input: unknown,
  ): Promise<unknown>;
}
export interface PlumsFrontendSdk {
  common: import("./common-contract.js").CommonPlatformSdk;
  resources: import("./common-contract.js").CommonResourcesSdk;
  readonly sdkVersion: "2";
  context(): Promise<
    PanelContext & {
      instanceId: string;
      ownerId: string;
      name: string;
      sdkVersion: "2";
      viewport: { width: number; height: number };
    }
  >;
  panels: FrontendPanelsSdk;
  protocols: {
    status(
      requirementId: string,
    ): Promise<import("./protocols.js").ProtocolBindingStatus>;
    invoke(requirementId: string, input: unknown): Promise<unknown>;
  };
  engine: EngineSdk;
  invoke(
    kind: ContributionKind,
    name: string,
    input: unknown,
    packageId?: string,
  ): Promise<unknown>;
  cancel(): Promise<void>;
  openManager(): Promise<void>;
  onEvent(
    callback: (event: {
      packageId?: string;
      topic: string;
      data: unknown;
    }) => void,
  ): () => void;
}
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/;
const topic = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/;
export function validatePanelDeclarations(
  manifest: Manifest,
  c: DesktopContribution,
  safePath: (v: unknown) => string,
  files?: PackageFiles,
): void {
  if (c.panels === undefined) return;
  const invalid = (path: string): never => {
    throw new PlumsError({
      code: IMPORT_INVALID,
      message: "面板声明无效。",
      path,
    });
  };
  const base = "/payload/plumsDesktop/panels";
  if (
    c.sdkVersion !== "2" ||
    !isManifestV2(manifest) ||
    manifest.kind !== "extension" ||
    !Array.isArray(c.panels) ||
    c.panels.length > 8
  )
    invalid(base);
  const ids = new Set<string>();
  for (const [i, p] of c.panels.entries()) {
    const at = `${base}/${i}`;
    if (!p || typeof p !== "object" || Array.isArray(p)) invalid(at);
    if (typeof p.id !== "string" || !identifier.test(p.id) || ids.has(p.id))
      invalid(`${at}/id`);
    ids.add(p.id);
    if (typeof p.title !== "string" || !p.title.trim() || p.title.length > 256)
      invalid(`${at}/title`);
    try {
      safePath(p.entry);
    } catch {
      invalid(`${at}/entry`);
    }
    if (
      typeof p.entry !== "string" ||
      !/\.html?$/i.test(p.entry) ||
      (files && !Object.hasOwn(files, p.entry))
    )
      invalid(`${at}/entry`);
    if (!c.protocols?.provides?.some((v) => v.id === p.provideId))
      invalid(`${at}/provideId`);
    if (p.messageVersion !== PANEL_MESSAGE_VERSION)
      invalid(`${at}/messageVersion`);
    if (
      !Array.isArray(p.topics) ||
      !p.topics.length ||
      p.topics.length > 32 ||
      p.topics.some((v) => typeof v !== "string" || !topic.test(v)) ||
      new Set(p.topics).size !== p.topics.length
    )
      invalid(`${at}/topics`);
  }
}
export function panelDenied(
  reason = "PANEL_UNAVAILABLE",
  executionState: "not_started" | "unknown" = "not_started",
): never {
  throw new PlumsError({
    code: PERMISSION_DENIED,
    message: "面板或消息已不可用，请重新打开工作界面。",
    path: "/panels",
    details: { reason, executionState },
  });
}
/** Canonical JSON only; never echo rejected content in errors. */
export function copyPanelPost(value: unknown): PanelPost {
  if (!value || typeof value !== "object" || Array.isArray(value))
    panelDenied("PANEL_MESSAGE_INVALID");
  const p = value as PanelPost;
  if (
    Object.keys(p).some(
      (k) => !["version", "to", "topic", "data"].includes(k),
    ) ||
    !Object.hasOwn(p, "data") ||
    p.version !== PANEL_MESSAGE_VERSION ||
    typeof p.to !== "string" ||
    p.to.length > 128 ||
    typeof p.topic !== "string" ||
    !topic.test(p.topic)
  )
    panelDenied("PANEL_MESSAGE_INVALID");
  let nodes = 0;
  const check = (v: unknown, depth: number): void => {
    if (++nodes > 16384 || depth > 32) panelDenied("PANEL_MESSAGE_LIMIT");
    if (
      v === null ||
      typeof v === "string" ||
      typeof v === "boolean" ||
      (typeof v === "number" && Number.isFinite(v))
    )
      return;
    if (
      !v ||
      typeof v !== "object" ||
      (!Array.isArray(v) &&
        ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    )
      panelDenied("PANEL_MESSAGE_INVALID");
    for (const item of Array.isArray(v) ? v : Object.values(v))
      check(item, depth + 1);
  };
  check(p.data, 0);
  let text: string;
  try {
    text = JSON.stringify(p);
  } catch {
    panelDenied("PANEL_MESSAGE_INVALID");
  }
  if (Buffer.byteLength(text!) > PANEL_MESSAGE_BYTES)
    panelDenied("PANEL_MESSAGE_LIMIT");
  return JSON.parse(text!);
}
export function copyPanelLayout(value: PanelLayout): PanelLayout {
  const copy = structuredClone(value);
  if (
    !copy ||
    !Array.isArray(copy.panels) ||
    copy.panels.length > 8 ||
    new Set(copy.panels.map((p) => p.handle)).size !== copy.panels.length
  )
    panelDenied("PANEL_LAYOUT_INVALID");
  const rects = [copy.root, ...copy.panels];
  for (const r of rects) {
    if (
      !r ||
      [r.x, r.y, r.width, r.height].some(
        (v) => typeof v !== "number" || !Number.isFinite(v),
      ) ||
      r.x < 0 ||
      r.y < 0 ||
      r.width <= 0 ||
      r.height <= 0 ||
      r.x + r.width > 1.000000001 ||
      r.y + r.height > 1.000000001
    )
      panelDenied("PANEL_LAYOUT_INVALID");
  }
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i]!,
        b = rects[j]!;
      if (
        Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 1e-9 &&
        Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 1e-9
      )
        panelDenied("PANEL_LAYOUT_OVERLAP");
    }
  return copy;
}
