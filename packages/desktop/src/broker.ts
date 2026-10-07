import { DesktopHost, LocalSecretStore, ioContext } from "@plums/host";
import path from "node:path";
import { PlumsError } from "@plums/core";
// Closing panels and runtimes may emit notifications after the parent has gone.
function send(message: object): void {
  if (process.connected && process.send) process.send(message, () => {});
}
const pending = new Map<
  string,
  { resolve: (v: unknown) => void; reject: () => void }
>();
let next = 0;
function parent(
  method: string,
  args: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(Error("Host service cancelled"));
      return;
    }
    const id = String(++next);
    const timer = setTimeout(() => {
      pending.delete(id);
      cleanup();
      reject(Error("Host service timed out"));
    }, 120_000);
    const cancel = () => {
      pending.delete(id);
      cleanup();
      send({ type: "service-cancel", id });
      reject(Error("Host service cancelled"));
    };
    signal?.addEventListener("abort", cancel, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    };
    pending.set(id, {
      resolve: (value) => {
        cleanup();
        resolve(value);
      },
      reject: () => {
        cleanup();
        reject(Error("Host service failed"));
      },
    });
    send({ type: "service", id, method, args });
  });
}
const dataDir = process.env.PLUMS_DATA_DIR!;
const host = new DesktopHost({
  dataDir,
  nodePath: process.execPath,
  confirm: {
    async ask(request) {
      return (
        (await parent("confirm", request, ioContext.getStore()?.signal)) ===
        true
      );
    },
  },
  grantConfirm: async (request, signal) =>
    (await parent("grant-confirm", request, signal)) as
      | import("@plums/host").GrantChoice
      | undefined,
  secretStore: (id) =>
    new LocalSecretStore(
      path.join(dataDir, "instances", id, "secrets"),
      path.join(dataDir, "instances", id, "secrets.enc.json"),
    ),
  event: (instanceId, packageId, topic, data) =>
    send({ type: "event", instanceId, packageId, topic, data }),
  panelEvent: (delivery) => {
    send({ type: "panel-event", delivery });
  },
});
await host.initialize();
send({ type: "ready" });
process.on("message", async (raw: unknown) => {
  const m = raw as {
    type: string;
    id: string;
    method: string;
    args: Record<string, unknown>;
    ok: boolean;
    value: unknown;
  };
  if (m.type === "service-reply") {
    const p = pending.get(m.id);
    pending.delete(m.id);
    if (p) m.ok ? p.resolve(m.value) : p.reject();
    return;
  }
  if (m.type !== "request") return;
  const a = m.args ?? {};
  const id = a.instanceId as string;
  const pkg = a.packageId as string;
  try {
    let value: unknown;
    switch (m.method) {
      case "list":
        value = await host.listAgents();
        break;
      case "desktopSettings":
        value = host.getDesktopSettings();
        break;
      case "setDesktopSettings":
        await host.setDesktopSettings(a.dnsMode);
        break;
      case "setDesktopTheme":
        await host.setDesktopTheme(a.theme);
        break;
      case "preview":
        value = await host.preview(a.path as string);
        break;
      case "install":
        value = await host.install(a.token as string);
        break;
      case "library":
        value = await host.listLibrary();
        break;
      case "inspectComponent":
        value = await host.inspectComponent(
          a.source as import("@plums/host").ComponentSource,
        );
        break;
      case "openComponentDraft":
        value = await host.openComponentDraft(
          a.source as import("@plums/host").ComponentSource,
        );
        break;
      case "readComponentDraft":
        value = await host.readComponentDraft(a.token as string);
        break;
      case "retainComponentDraft":
        await host.retainComponentDraft(
          a.token as string,
          a.editor as import("@plums/host").ComponentEditorState,
        );
        break;
      case "writeComponentDraft":
        value = await host.writeComponentDraft(
          a.token as string,
          a.text as string,
          a.revision as string,
        );
        break;
      case "revealComponentDraft":
        value = await host.revealComponentDraft(
          a.token as string,
          a.relative as string | undefined,
        );
        break;
      case "discardComponentDraft":
        await host.discardComponentDraft(a.token as string);
        break;
      case "validateComponentDraft":
        value = await host.validateComponentDraft(a.token as string);
        break;
      case "componentDraftSnapshot":
        value = await host.componentDraftSnapshot(
          a.token as string,
          a.validationToken as string,
        );
        break;
      case "saveComponentDraft":
        value = await host.saveComponentDraft(
          a.token as string,
          a.validationToken as string,
          a.consent === true,
        );
        break;
      case "planAssembly":
        value = await host.planAssembly(a.digests as string[]);
        break;
      case "importLibrary":
        value = await host.importLibrary(a.token as string);
        break;
      case "importBundleComponents":
        value = await host.importBundleComponents(a.token as string);
        break;
      case "removeLibrary":
        await host.removeLibrary(a.digest as string);
        break;
      case "exportLibrary":
        value = [...(await host.exportLibrary(a.digest as string))];
        break;
      case "createAgent":
        value = await host.createAgent(
          a.name as string,
          a.digests as string[],
          a.characterId as string | undefined,
          a.startup as string | undefined,
          a.protocolBindings as
            | import("@plums/sdk").ProtocolBindingIntent[]
            | undefined,
        );
        break;
      case "editAgent":
        await host.editAgent(
          id,
          a.name as string,
          a.characterId as string | undefined,
          a.startup as string | undefined,
        );
        break;
      case "addLibraryComponent":
        await host.addLibraryComponent(id, a.digest as string);
        break;
      case "previewLibraryUpdate":
        value = await host.previewLibraryUpdate(id, a.digest as string);
        break;
      case "resources":
        value = await host.resources(id);
        break;
      case "resourcePlan":
        value = await host.resourcePlan(id);
        break;
      case "createResourceGroup":
        value = await host.createResourceGroup(
          id,
          a.fingerprint as string,
          a.name as string,
          a.contentContract as string | undefined,
        );
        break;
      case "setResourceQualification":
        await host.setResourceQualification(
          id,
          a.fingerprint as string,
          a.resourceId as string,
          a.componentId as string,
          a.operations as import("@plums/sdk").ResourceOperation[],
        );
        break;
      case "setResourceBinding":
        await host.setResourceBinding(
          id,
          a.fingerprint as string,
          a.componentId as string,
          a.requirementId as string,
          a.resourceId as string | undefined,
        );
        break;
      case "removeResourceGroup":
        await host.removeResourceGroup(
          id,
          a.fingerprint as string,
          a.resourceId as string,
        );
        break;
      case "grantResourceRange":
        value = await host.grantResourceRange(
          id,
          a.fingerprint as string,
          a.mode as "task" | "full-access",
          a.durationMs as number,
          a.selection as import("@plums/host").ResourceRangeSelection[],
        );
        break;
      case "revokeResourceRange":
        await host.revokeResourceRange(id);
        break;
      case "frontendCommon":
        value = await host.frontendCommon(
          a.sessionId as string,
          a.source as string,
          a.method as string,
          a.request as Record<string, unknown>,
        );
        break;
      case "permitTaskTakeover":
        await host.permitTaskTakeover(
          id,
          a.taskId as string,
          pkg,
          a.enabled as boolean,
        );
        value = null;
        break;
      case "policyPlan":
        value = await host.policyPlan(id);
        break;
      case "selectPolicy":
        await host.selectPolicy(
          id,
          a.fingerprint as string,
          a.providerId as string | undefined,
          a.provideId as string | undefined,
          a.mode as string | undefined,
        );
        value = null;
        break;
      case "grantPolicyScope":
        value = await host.grantPolicyScope(
          id,
          a.fingerprint as string,
          a.durationMs as number,
          a.selection as import("@plums/host").PolicyScopeSelection[],
        );
        break;
      case "revokePolicyScope":
        await host.revokePolicyScope(id);
        value = null;
        break;
      case "commonTasks":
        value = await host.commonTasks(id);
        break;
      case "stopCommonTask":
        await host.stopCommonTask(id, a.taskId as string);
        value = null;
        break;
      case "setComponentBackground":
        await host.setComponentBackground(id, pkg, a.enabled as boolean);
        value = null;
        break;
      case "bindControlledProgram":
        await host.bindControlledProgram(
          id,
          a.target as string,
          a.program as string,
          a.reads as string[],
          a.writes as string[],
        );
        value = null;
        break;
      case "frontendResource":
        value = await host.frontendResource(
          a.sessionId as string,
          a.source as string,
          a.operation as string,
          a.request as Record<string, unknown>,
        );
        break;
      case "taskScopePlan":
        value = await host.taskScopePlan(id);
        break;
      case "grantTaskScope":
        value = await host.grantTaskScope(
          id,
          a.fingerprint as string,
          a.durationMs as number,
          a.selection as import("@plums/core").TaskScopeSelection[],
        );
        break;
      case "revokeTaskScope":
        await host.revokeTaskScope(id);
        break;
      case "agentEnablePlan":
        value = await host.agentEnablePlan(id);
        break;
      case "enableAgent":
        await host.enableAgent(id, a.fingerprint as string);
        break;
      case "enable":
        await host.enable(
          id,
          pkg,
          a.expected as string | undefined,
          a.expectedAccess as string | undefined,
        );
        break;
      case "disable":
        await host.disable(id, pkg);
        break;
      case "uninstall":
        await host.uninstallPackage(id, pkg);
        break;
      case "setStartup":
        await host.setStartup(id, pkg);
        break;
      case "update":
        value = await host.updatePackage(
          id,
          a.token as string,
          pkg,
          a.consent === true,
        );
        break;
      case "bindRoot":
        await host.bindRoot(id, a.name as string, a.path as string);
        break;
      case "unbindRoot":
        await host.unbindRoot(id, a.name as string);
        break;
      case "settings":
        await host.setSettings(
          id,
          pkg,
          a.values as Record<string, unknown>,
          a.secrets as Record<string, string>,
        );
        break;
      case "export":
        value = [...(await host.exportAgent(id))];
        break;
      case "remove":
        await host.removeAgent(id);
        break;
      case "stop":
        await host.revokeTaskScope(id);
        break;
      case "frontend": {
        const f = await host.frontend(id);
        value = f
          ? {
              ...f,
              files: Object.fromEntries(
                Object.entries(f.files).map(([p, b]) => [p, [...b]]),
              ),
            }
          : null;
        break;
      }
      case "workspacePlan":
        value = await host.workspacePlan(
          id,
          a.componentId as string | undefined,
        );
        break;
      case "setWorkspaceViews":
        value = await host.setWorkspaceViews(
          id,
          a.componentId as string,
          a.components as string[],
          a.fingerprint as string,
        );
        break;
      case "restoreWorkspace": {
        const restored = await host.restoreWorkspace(
          a.sessionId as string,
          a.source as string,
        );
        value = {
          ...restored,
          resources: restored.resources.map((r) => ({
            ...r,
            files: Object.fromEntries(
              Object.entries(r.files).map(([p, b]) => [p, [...b]]),
            ),
          })),
        };
        break;
      }
      case "openFrontend":
      case "openPanel": {
        const resource =
          m.method === "openFrontend"
            ? await host.openFrontend(id, a.componentId as string | undefined)
            : await host.openPanel(
                a.sessionId as string,
                a.source as string,
                a.requirementId as string,
                a.panelId as string,
              );
        value = resource
          ? {
              ...resource,
              files: Object.fromEntries(
                Object.entries(resource.files).map(([p, b]) => [p, [...b]]),
              ),
            }
          : null;
        break;
      }
      case "closeFrontend":
        host.closeFrontend(a.sessionId as string);
        break;
      case "closePanel":
        await host.closePanel(
          a.sessionId as string,
          a.source as string,
          a.handle as string,
        );
        break;
      case "panelLayout":
        value = await host.panelLayout(
          a.sessionId as string,
          a.source as string,
          a.layout as import("@plums/sdk").PanelLayout,
        );
        break;
      case "postPanel":
        await host.postPanel(
          a.sessionId as string,
          a.source as string,
          a.message as import("@plums/sdk").PanelPost,
        );
        break;
      case "frontendContext":
        value = await host.frontendContext(
          a.sessionId as string,
          a.source as string,
        );
        break;
      case "frontendInvoke":
        value = await host.frontendInvoke(
          a.sessionId as string,
          a.source as string,
          a.request as Parameters<DesktopHost["frontendInvoke"]>[2],
        );
        break;
      case "frontendProtocolStatus":
        value = await host.frontendProtocolStatus(
          a.sessionId as string,
          a.source as string,
          a.requirementId as string,
        );
        break;
      case "frontendEngine":
        value = await host.frontendEngine(
          a.sessionId as string,
          a.source as string,
          a.operation as string,
          a.args as Record<string, unknown>,
        );
        break;
      case "protocolPlan":
        value = await host.protocolPlan(id);
        break;
      case "setProtocolBinding":
        await host.setProtocolBinding(
          id,
          a.fingerprint as string,
          a.consumerId as string,
          a.requirementId as string,
          a.choice as import("@plums/sdk").ProtocolBindingIntent | undefined,
        );
        break;
      case "protocolStatus":
        value = await host.protocolStatus(
          id,
          a.ownerId as string,
          a.requirementId as string,
        );
        break;
      case "invokeProtocol":
        value = await host.invokeProtocol(
          id,
          a.ownerId as string,
          a.requirementId as string,
          a.input,
        );
        break;
      case "invoke":
        value = await host.invoke(
          id,
          a.ownerId as string,
          a.targetId as string,
          a.kind as "commands" | "tools" | "connectors",
          a.name as string,
          a.input,
        );
        break;
      case "engine":
        value = await host.engineCall(id, pkg, a.operation as string, a);
        break;
      case "engineStatus":
        value = await host.engineStatus(id, pkg, a.engineId as string);
        break;
      case "startEngine":
        value = await host.startEngine(id, pkg, a.engineId as string);
        break;
      case "stopEngine":
        await host.stopEngine(id, pkg, a.engineId as string);
        break;
      case "revokeEngine":
        await host.revokeEngine(id, pkg, a.engineId as string);
        break;
      case "audit":
        value = await host.audit(id);
        break;
      case "approveMcp":
        value = await host.approveMcp(
          id,
          pkg,
          a.permissionId as string,
          a.tools as never[],
        );
        break;
      default:
        throw Error("Unknown method");
    }
    send({ type: "reply", id: m.id, ok: true, value: value ?? null });
  } catch (error) {
    send({
      type: "reply",
      id: m.id,
      ok: false,
      error:
        error instanceof PlumsError
          ? {
              code: error.code,
              message: error.message,
              path: error.path,
              details: error.details,
            }
          : {
              code: "HOST_FAILED",
              message:
                "操作未完成，请检查组件声明、设置与依赖，或返回管理页重试。",
            },
    });
  }
});
let shuttingDown = false;
const shutdown = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  void host
    .close()
    .catch(() => {})
    .finally(() => process.exit());
};
process.on("disconnect", shutdown);
process.on("SIGTERM", shutdown);
