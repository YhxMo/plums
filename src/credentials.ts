import { invokeNative } from "./native/invoke";
import type { NativeCommands } from "./native/contract.generated";
import type { CredentialBindingDeclaration } from "../modules/sdk";

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

/** Host management only. This entry never accepts or returns an API key. */
export class CredentialAccess {
  supported = false;
  initializationError: string | null = null;
  private readonly owners = new Set<string>();
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
  route(owner: string, alias: string, revision: number) {
    return this.run("credential_route", { owner, alias, revision });
  }
  reconcile(owner: string, alias: string, revision: number) {
    return this.run("credential_reconcile", { owner, alias, revision });
  }
  delete(owner: string, alias: string, revision: number) {
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
