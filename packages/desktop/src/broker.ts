import { DesktopHost, EncryptedSecretStore, ioContext } from "@plums/host";
import path from "node:path";
import { PlumsError } from "@plums/core";
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
      process.send?.({ type: "service-cancel", id });
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
    process.send?.({ type: "service", id, method, args });
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
  secretStore: (id) =>
    new EncryptedSecretStore(
      path.join(dataDir, "instances", id, "secrets.enc.json"),
      {
        async encrypt(v) {
          return (await parent("encrypt", v)) as string;
        },
        async decrypt(v) {
          return (await parent("decrypt", v)) as string;
        },
      },
    ),
  event: (instanceId, packageId, topic, data) =>
    process.send?.({ type: "event", instanceId, packageId, topic, data }),
});
await host.initialize();
process.send?.({ type: "ready" });
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
      case "preview":
        value = await host.preview(a.path as string);
        break;
      case "install":
        value = await host.install(a.token as string);
        break;
      case "library":
        value = await host.listLibrary();
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
      case "agentEnablePlan":
        value = await host.agentEnablePlan(id);
        break;
      case "enableAgent":
        await host.enableAgent(id, a.fingerprint as string);
        break;
      case "enable":
        await host.enable(id, pkg, a.expected as string | undefined);
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
        host.stopSession(id);
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
    process.send?.({ type: "reply", id: m.id, ok: true, value: value ?? null });
  } catch (error) {
    process.send?.({
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
process.on("disconnect", () => {
  host.close();
  process.exit();
});
