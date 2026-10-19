import { useEffect, useState } from "react";
import {
  extensionOwner,
  type CredentialBindingDeclaration,
} from "../../../modules/sdk";
import type {
  CredentialAccess,
  CredentialBinding,
  CredentialManagementResponse,
} from "../../credentials";
import type { CredentialOperations } from "../../shell/controllers";
import styles from "./SelectedDocuments.module.css";
import { resultMessage } from "./credential-copy";

const stateLabel = {
  ready: "凭据已保存，连接尚未验证",
  pending: "保存结果待核对",
  disabled: "连接已禁用",
  "delete-pending": "已禁用，凭据删除待核对",
};
export function CredentialBindings({
  access,
  operations,
  id,
  source,
  version,
  declarations,
  managed = false,
}: {
  access: CredentialAccess;
  operations: CredentialOperations;
  id: string;
  source: string;
  version: string;
  declarations: Record<string, CredentialBindingDeclaration>;
  /** The extension makes its own connections from protocol templates. */
  managed?: boolean;
}) {
  const [items, setItems] = useState<CredentialBinding[]>([]);
  const [status, setStatus] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  /** Keys being typed, by alias; cleared once submitted. */
  const [keys, setKeys] = useState<Record<string, string>>({});
  const owner = extensionOwner(id);
  useEffect(() => {
    let live = true;
    setItems([]);
    setStatus("");
    setUnavailable(false);
    void access.list(owner).then(
      (value) => {
        if (live) setItems(value);
      },
      () => {
        if (live) {
          setUnavailable(true);
          setStatus("连接记录不可用，原记录已保留。");
        }
      },
    );
    return () => {
      live = false;
    };
  }, [access, owner]);
  const run = (
    trigger: HTMLElement,
    operation: () => Promise<CredentialManagementResponse>,
    success = "连接记录已更新。",
  ) =>
    void operations.operate(async () => {
      const result = await operation();
      setStatus(resultMessage(result, success));
      try {
        setItems(await access.list(owner));
        setUnavailable(false);
      } catch {
        setUnavailable(true);
        setStatus("操作回执待核对；连接记录当前不可用，请重新启动后检查。");
      } finally {
        requestAnimationFrame(() => {
          if (trigger.isConnected && !trigger.hasAttribute("disabled"))
            trigger.focus();
        });
      }
    });
  if (!Object.keys(declarations).length && !items.length && !status && !managed)
    return null;
  const aliases = [
    ...new Set([
      ...Object.keys(declarations),
      ...items.map((item) => item.alias),
    ]),
  ];
  return (
    <section className={styles.documents} aria-label="连接与凭据">
      <h3>连接与凭据</h3>
      {access.supported && access.initializationError && (
        <p role="status">
          初始化读取失败：{access.initializationError}
          。原记录已保留，重新加载应用后可重试。
        </p>
      )}
      {!access.supported ? (
        <p>
          {access.initializationError
            ? `凭据服务初始化失败：${access.initializationError}。请重新加载应用后重试。`
            : "请在 Mac 或 Android 应用中配置连接。"}
        </p>
      ) : (
        <>
          <p>
            API Key
            只保存在本机，用于向下方地址发送请求，保存后不再显示；保存本身不发送请求。当前版本只通过直连发送，设置了网络代理的连接会拒绝发送。
          </p>
          {aliases.map((alias) => {
            const item = items.find((item) => item.alias === alias);
            const declaration = declarations[alias];
            // Made by the extension from a protocol template; it re-enters keys itself.
            const own = managed && !declaration && /^c-/.test(alias);
            const revision = item?.revision ?? 0;
            const disabled = operations.busy || unavailable;
            return (
              <div key={alias}>
                <strong>{declaration?.label ?? item!.declaration.label}</strong>
                <p>{item?.declaration.target ?? declaration!.target}</p>
                {own ? (
                  <p>由扩展新建，在它的连接页面中修改或重新录入密钥。</p>
                ) : (
                  !declaration && (
                    <p>此扩展当前不使用该连接，可核对或删除已保存的凭据。</p>
                  )
                )}
                <p>
                  {item ? stateLabel[item.status] : "尚未录入凭据"}
                  {item && (item.source !== source || item.version !== version)
                    ? "；来源或版本已变化，须重新绑定"
                    : ""}
                </p>
                {item && (
                  <p>
                    {item.route.type === "direct"
                      ? "网络：直连"
                      : `网络代理：${item.route.url}（当前版本不支持经代理发送）`}
                  </p>
                )}
                {declaration && (
                  <form
                    className={styles.actions}
                    onSubmit={(event) => {
                      event.preventDefault();
                      const key = keys[alias]?.trim();
                      if (!key) return;
                      setKeys((value) => ({ ...value, [alias]: "" }));
                      // Focus returns to the emptied key field.
                      const field = event.currentTarget.querySelector("input")!;
                      run(field, () =>
                        access.configure(
                          owner,
                          alias,
                          source,
                          version,
                          declaration,
                          revision,
                          key,
                        ),
                      );
                    }}
                  >
                    <input
                      type="password"
                      aria-label={`${declaration.label} 的 API Key`}
                      value={keys[alias] ?? ""}
                      maxLength={4096}
                      autoComplete="off"
                      spellCheck={false}
                      placeholder={
                        item?.status === "ready"
                          ? "已保存，填写新的 Key 替换"
                          : "粘贴 API Key"
                      }
                      disabled={
                        disabled ||
                        item?.status === "pending" ||
                        item?.status === "delete-pending"
                      }
                      onChange={(event) =>
                        setKeys((value) => ({
                          ...value,
                          [alias]: event.target.value,
                        }))
                      }
                    />
                    <button
                      type="submit"
                      className="secondary"
                      disabled={
                        disabled ||
                        !keys[alias]?.trim() ||
                        item?.status === "pending" ||
                        item?.status === "delete-pending"
                      }
                    >
                      {item?.status === "ready"
                        ? "更换 API Key"
                        : "保存 API Key"}
                    </button>
                  </form>
                )}
                <div className={styles.actions}>
                  {item && (
                    <>
                      {(declaration || own) && (
                        <button
                          className="secondary"
                          disabled={
                            disabled || item.status === "delete-pending"
                          }
                          onClick={(event) =>
                            run(event.currentTarget, () =>
                              access.route(owner, alias, revision),
                            )
                          }
                        >
                          网络设置
                        </button>
                      )}
                      {item.status === "pending" && (
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={(event) =>
                            run(event.currentTarget, () =>
                              access.reconcile(owner, alias, revision),
                            )
                          }
                        >
                          核对保存状态
                        </button>
                      )}
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={(event) =>
                          run(
                            event.currentTarget,
                            () => access.delete(owner, alias, revision),
                            "已撤销并删除凭据。",
                          )
                        }
                      >
                        {item.status === "delete-pending"
                          ? "继续删除凭据"
                          : "撤销并删除凭据"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}

export function RetainedCredentialBindings({
  access,
  operations,
  installed,
}: {
  access: CredentialAccess;
  operations: CredentialOperations;
  installed: string[];
}) {
  const [items, setItems] = useState<CredentialBinding[]>([]);
  const [failed, setFailed] = useState(false);
  const identities = installed.join(",");
  useEffect(() => {
    let live = true;
    if (operations.busy) return;
    void access.inventory().then(
      (items) => {
        if (live) {
          setItems(items);
          setFailed(false);
        }
      },
      () => {
        if (live) setFailed(true);
      },
    );
    return () => {
      live = false;
    };
  }, [access, identities, operations.busy]);
  const retained = items.filter(
    (item) => !installed.includes(item.owner.slice("extension.".length)),
  );
  const owners = [...new Set(retained.map((item) => item.owner))];
  if (!owners.length && !failed) return null;
  return (
    <section className={styles.documents} aria-label="卸载后保留的凭据">
      <h3>卸载后保留的凭据</h3>
      {failed && <p role="status">凭据记录暂不可用，请重新启动后核对。</p>}
      {owners.map((owner) => {
        const first = retained.find((item) => item.owner === owner)!;
        return (
          <div key={owner}>
            <strong>{owner.slice("extension.".length)}</strong>
            <CredentialBindings
              access={access}
              operations={operations}
              id={owner.slice("extension.".length)}
              source={first.source}
              version={first.version}
              declarations={{}}
            />
          </div>
        );
      })}
    </section>
  );
}
