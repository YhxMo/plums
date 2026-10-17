import { invoke } from "@tauri-apps/api/core";
import type {
  CredentialBindingDeclaration,
  NetworkRoute,
} from "../modules/sdk";

export interface CredentialBinding {
  owner: string;
  alias: string;
  source: string;
  version: string;
  declaration: CredentialBindingDeclaration;
  route: NetworkRoute;
  revision: number;
  status: "pending" | "ready" | "disabled" | "delete-pending";
}
export type CredentialManagementResponse =
  | { status: "saved" }
  | { status: "cancelled" }
  | { status: "unknown" }
  | { status: "rejected"; reason: string };

/** Host management only. This entry never accepts or returns an API key. */
export class CredentialAccess {
  supported = false;
  private readonly owners = new Set<string>();
  async initialize(native: boolean) {
    if (!native) return;
    try {
      this.supported = (await invoke("credential_supported")) === true;
      if (this.supported) await this.inventory();
    } catch {
      // A bad binding file must not hide the native management entry.
    }
  }
  async list(owner: string) {
    if (!this.supported) return [];
    try {
      const items = await invoke<CredentialBinding[]>("credential_list", {
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
    const items = await invoke<CredentialBinding[]>("credential_inventory");
    this.owners.clear();
    for (const item of items) this.owners.add(item.owner);
    return items;
  }
  async prepareUninstall(owner: string, declared: boolean) {
    if (!this.supported || (!declared && !this.owners.has(owner))) return;
    const result = await this.run("credential_retain", { owner });
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
  private async run(
    command: string,
    args: Record<string, unknown>,
  ): Promise<CredentialManagementResponse> {
    if (!this.supported) return { status: "rejected", reason: "unavailable" };
    try {
      return await invoke<CredentialManagementResponse>(command, args);
    } catch {
      return { status: "unknown" };
    }
  }
}
