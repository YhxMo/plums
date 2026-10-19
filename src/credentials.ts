import { invokeNative } from "./native/invoke";
import type { NativeCommands } from "./native/contract.generated";
import type {
  CredentialBindingDeclaration,
  CredentialConnectResult,
  CredentialConnection,
  CredentialFailureOutcome,
  CredentialProtocol,
  CredentialResponse,
} from "../modules/sdk";
import { validateCredentialTarget } from "../modules/sdk/credential-bindings";

export type CredentialBinding =
  NativeCommands["credential_list"]["response"][number];
export type CredentialManagementResponse =
  NativeCommands["credential_configure"]["response"];
type Mutation =
  | "credential_retain"
  | "credential_configure"
  | "credential_route"
  | "credential_reconcile"
  | "credential_delete";

const reasons: Record<string, string> = {
  denied: "扩展没有凭据请求权限。",
  busy: "该扩展已有请求在进行或连接正在修改，请稍后再试。",
  missing: "连接尚未配置，请在扩展管理中录入 API Key。",
  "not-ready": "连接未就绪，请在扩展管理中录入或核对 API Key。",
  "not-confirmed": "已取消发送，请求未发出。",
  "proxy-unsupported": "当前版本只支持直连，请把连接方式改为直连。",
  "secret-unavailable": "无法读取系统中保存的 API Key，请重新录入。",
  "invalid-request": "请求格式无效或超过 64 KiB，未发送。",
  stale: "连接或授权已变化，本次结果未交付。",
  timeout: "请求超时，远端结果未确认。",
  redirect: "服务返回了跳转，已拒绝跟随，远端结果未确认。",
  "response-too-large": "响应超过 2 MiB，远端结果未确认。",
  "response-encoding": "响应不是有效的 UTF-8 文本，远端结果未确认。",
};
function requestFailure(code: string, outcome: CredentialFailureOutcome) {
  const fallback =
    outcome === "unknown" ? "请求结果未确认，不会自动重试。" : "请求未发送。";
  return Object.assign(new Error(reasons[code] ?? fallback), {
    code,
    outcome,
  });
}
const bytes = (value: string) => new TextEncoder().encode(value).length;
/** Request body cap, matching the native transports. */
export const MAX_REQUEST = 65536;
/** A read on the bound site: plain absolute path, no query; Rust checks it again. */
const sitePath = /^(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._~-]+)+$/;
/** Connections an extension made itself; static manifest aliases never match. */
const connectionAlias = /^c-[a-z0-9]{8}$/;
const MAX_CONNECTIONS = 16;
/** What the host knows about an owner that manages its own connections. */
export type ConnectionOwner = {
  source: string;
  version: string;
  protocols: Record<string, CredentialProtocol>;
};
const sameTemplate = (
  declaration: CredentialBindingDeclaration,
  template: CredentialProtocol,
) =>
  declaration.contentType === template.contentType &&
  JSON.stringify(declaration.authentication) ===
    JSON.stringify(template.authentication) &&
  JSON.stringify(Object.entries(declaration.headers).sort()) ===
    JSON.stringify(Object.entries(template.headers).sort());
function connectFailure(message: string) {
  return Object.assign(new Error(message), {
    code: "invalid-request",
    outcome: "not-dispatched" as const,
  });
}

/** Host management only. This entry never accepts or returns an API key. */
export class CredentialAccess {
  supported = false;
  initializationError: string | null = null;
  private readonly owners = new Set<string>();
  /** Set by the composition root; owners without protocols cannot connect. */
  describe: (owner: string) => ConnectionOwner | undefined = () => undefined;
  async initialize(native: boolean) {
    if (!native) return;
    try {
      this.supported = (await invokeNative("credential_supported")) === true;
      if (this.supported) await this.inventory();
      this.initializationError = null;
    } catch (error) {
      // A bad binding file must not hide the native management entry, but the
      // failure must stay observable instead of reading as "unsupported".
      const message = error instanceof Error ? error.message : String(error);
      this.initializationError = message.trim() || "初始化探测失败";
    }
  }
  async list(owner: string) {
    if (!this.supported) return [];
    try {
      const items = await invokeNative("credential_list", {
        owner,
      });
      if (items.length) this.owners.add(owner);
      else this.owners.delete(owner);
      return items;
    } catch {
      throw Error("连接记录不可用；原记录已保留，请检查后重新启动应用。");
    }
  }
  async inventory() {
    if (!this.supported) return [];
    const items = await invokeNative("credential_inventory");
    this.owners.clear();
    for (const item of items) this.owners.add(item.owner);
    return items;
  }
  async prepareUninstall(owner: string, declared: boolean) {
    if (!this.supported || (!declared && !this.owners.has(owner))) return;
    await this.release(owner);
    const result = await this.run("credential_retain", { owner });
    if (result.status === "rejected")
      throw Error(
        result.reason === "unavailable"
          ? "凭据服务当前不可用，操作未执行；原记录已保留。"
          : "凭据绑定未能禁用；请核对连接记录后重试。",
      );
    if (result.status !== "saved")
      throw Error(
        "凭据绑定禁用回执待核对，安装路径仍保留；请检查连接记录后重试。",
      );
  }
  async configure(
    owner: string,
    alias: string,
    source: string,
    version: string,
    declaration: CredentialBindingDeclaration,
    revision: number,
  ) {
    return this.run("credential_configure", {
      owner,
      alias,
      source,
      version,
      declaration,
      revision,
    });
  }
  /**
   * `credential.connect`: an extension lists, saves or removes connections
   * built from its protocol templates. Saving opens the native key panel,
   * which shows the target the user typed; the extension never sees a key.
   */
  async connect(
    owner: string,
    payload: unknown,
  ): Promise<CredentialConnection[] | CredentialConnectResult> {
    const known = this.describe(owner);
    const request = (payload ?? {}) as Record<string, unknown>;
    if (!known || typeof payload !== "object" || Array.isArray(payload))
      throw connectFailure("连接参数无效。");
    const items = (await this.list(owner)).filter((item) =>
      connectionAlias.test(item.alias),
    );
    if (request.action === "list" && Object.keys(request).length === 1)
      return items.map(({ alias, declaration, status }) => ({
        alias,
        protocol: Object.keys(known.protocols).find((name) =>
          sameTemplate(declaration, known.protocols[name]),
        ),
        label: declaration.label,
        target: declaration.target,
        status,
      }));
    const { action, alias, protocol, label, target } = request;
    const existing = items.find((item) => item.alias === alias);
    if (
      action === "remove" &&
      Object.keys(request).sort().join() === "action,alias" &&
      existing
    ) {
      const result = await this.delete(
        owner,
        existing.alias,
        existing.revision,
      );
      return { alias: existing.alias, ...result };
    }
    const template =
      typeof protocol === "string" && Object.hasOwn(known.protocols, protocol)
        ? known.protocols[protocol]
        : undefined;
    if (
      action !== "save" ||
      Object.keys(request).some(
        (key) =>
          !["action", "alias", "protocol", "label", "target"].includes(key),
      ) ||
      !template ||
      typeof label !== "string" ||
      !label.trim() ||
      label.length > 80 ||
      // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
      /[\u0000-\u001f\u007f]/.test(label) ||
      (alias !== undefined && !existing) ||
      (alias === undefined && items.length >= MAX_CONNECTIONS)
    )
      throw connectFailure("连接参数无效。");
    try {
      validateCredentialTarget(target);
    } catch {
      throw connectFailure(
        "服务地址须是 https:// 开头、不带端口与查询参数的完整地址。",
      );
    }
    const name =
      existing?.alias ??
      `c-${crypto.randomUUID().replaceAll("-", "").slice(0, 8)}`;
    const result = await this.configure(
      owner,
      name,
      known.source,
      known.version,
      { ...template, label, target: target as string },
      existing?.revision ?? 0,
    );
    return { alias: name, ...result };
  }
  /** Sends through the owner's binding; the key is injected natively. */
  async request(
    owner: string,
    payload: unknown,
    signal?: AbortSignal,
  ): Promise<CredentialResponse> {
    const { version, binding, body, method, path } = (payload ?? {}) as Record<
      string,
      unknown
    >;
    const fields =
      payload && typeof payload === "object"
        ? Object.keys(payload).sort().join()
        : "";
    const send =
      fields === "binding,body,version" &&
      typeof body === "string" &&
      bytes(body) <= MAX_REQUEST;
    const read =
      fields === "binding,method,path,version" &&
      method === "GET" &&
      typeof path === "string" &&
      path.length <= 256 &&
      sitePath.test(path);
    if (version !== 1 || typeof binding !== "string" || !(send || read))
      throw requestFailure("invalid-request", "not-dispatched");
    if (signal?.aborted) throw requestFailure("cancelled", "not-dispatched");
    const id = crypto.randomUUID();
    const abort = () =>
      void invokeNative("credential_abort", { owner, id }).catch(() => {});
    signal?.addEventListener("abort", abort, { once: true });
    try {
      return await invokeNative("credential_request", {
        owner,
        id,
        binding,
        ...(read
          ? { body: "", path: path as string }
          : { body: body as string }),
      });
    } catch (error) {
      const { code, outcome } = (error ?? {}) as Record<string, unknown>;
      if (
        typeof code === "string" &&
        (outcome === "not-dispatched" || outcome === "unknown")
      )
        throw requestFailure(code, outcome);
      throw requestFailure("transport", "unknown");
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  /** Ends the owner's send confirmations and any request in flight. */
  async release(owner: string) {
    if (this.supported)
      await invokeNative("credential_release", { owner }).catch(() => {});
  }
  route(owner: string, alias: string, revision: number) {
    return this.run("credential_route", { owner, alias, revision });
  }
  reconcile(owner: string, alias: string, revision: number) {
    return this.run("credential_reconcile", { owner, alias, revision });
  }
  async delete(owner: string, alias: string, revision: number) {
    // Revocation stops the request in flight before the key is removed.
    await this.release(owner);
    return this.run("credential_delete", { owner, alias, revision });
  }
  private async run<K extends Mutation>(
    command: K,
    args: NativeCommands[K]["args"],
  ): Promise<CredentialManagementResponse> {
    if (!this.supported) return { status: "rejected", reason: "unavailable" };
    try {
      return await invokeNative(command, args);
    } catch {
      return { status: "unknown" };
    }
  }
}
