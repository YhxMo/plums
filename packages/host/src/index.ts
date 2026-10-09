export type {
  GrantApproval,
  GrantChoice,
  GrantConfirm,
} from "./engine-grants.js";
export { DesktopHost } from "./host.js";
export type {
  TierSelection,
  TierEntry,
  TierPlan,
} from "./local-authorization.js";
export type { PanelResource, PanelDelivery } from "./panels.js";
export type {
  HostOptions,
  AgentRecord,
  DesktopTheme,
  DesktopSettings,
} from "./host.js";
export { ExtensionRuntime } from "./runtime.js";
export { HttpsSink, SecureFsSink, publicAddress, ioContext } from "./io.js";
export { EncryptedSecretStore, LocalSecretStore } from "./secrets.js";
export type { SecretCipher } from "./secrets.js";

export type { LibraryItem } from "./library.js";
export type {
  ComponentSource,
  ComponentInspection,
  ComponentDraft,
  ComponentEditorState,
} from "./component-drafts.js";
export type { ComponentBinding } from "./assembly.js";

export type {
  ProtocolBinding,
  ProtocolCandidate,
  ProtocolRequirementState,
} from "./protocol-bindings.js";

export type {
  BusinessResource,
  ResourceQualification,
  ResourceBindingRecord,
} from "./resource-store.js";
export type {
  ResourceRange,
  ResourceRangeSelection,
} from "./resource-service.js";

export type { PolicyBinding, PolicyScopeSelection } from "./policy-service.js";

export type {
  WorkspaceLayout,
  WorkspaceViewSelection,
} from "./workspace-layout.js";

export { startFoundationSession } from "./foundation-session.js";
export type {
  FoundationStartOptions,
  FoundationProcessSession,
} from "./foundation-session.js";
export type {
  InvocationContext,
  RuntimeBridge,
  HostFoundationSession,
  FoundationSessionOptions,
  FoundationAdapterOptions,
} from "./foundation-runtime.js";
export {
  FoundationRegistry,
  createFoundationSession,
} from "./foundation-factory.js";
export type {
  FoundationReference,
  FoundationRegistration,
} from "./foundation-factory.js";
export {
  createOfficialFoundationRegistry,
  OFFICIAL_FOUNDATION_REFERENCE,
  OFFICIAL_FOUNDATION_PROVIDER,
} from "./official-foundation.js";

export {
  discoverLibraryFoundations,
  registerLibraryFoundation,
} from "./foundation-library.js";
export type {
  LibraryFoundation,
  LibraryFoundationOptions,
} from "./foundation-library.js";

export type {
  AgentFoundationBinding,
  FoundationSwitchPhase,
} from "./foundation-state.js";
