import { useEffect, useRef, useState } from "react";
import type { Runtime } from "./runtime";
import type { ShellOperations } from "./useOperations";
import { capabilityLabel } from "./messages";
import styles from "../App.module.css";

type Request = { ids: string[]; run: () => Promise<void> };
export function useAuthorization() {
  const [authorization, setAuthorization] = useState<Request | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (authorization) dialog.current?.showModal();
  }, [authorization]);
  return {
    authorization,
    setAuthorization,
    dialog,
    trigger,
    requestAuthorization(
      ids: string[],
      run: () => Promise<void>,
      source: HTMLElement,
    ) {
      trigger.current = source;
      setAuthorization({ ids, run });
    },
    closeAuthorization() {
      dialog.current?.close();
    },
  };
}
export type Authorization = ReturnType<typeof useAuthorization>;
export function AuthorizationDialog({
  runtime,
  operations,
  controller,
}: {
  runtime: Runtime;
  operations: ShellOperations;
  controller: Authorization;
}) {
  const { host, catalog } = runtime;
  const { operate } = operations;
  const {
    authorization,
    setAuthorization,
    dialog,
    trigger,
    closeAuthorization,
  } = controller;
  return (
    <dialog
      ref={dialog}
      className={styles.authorization}
      aria-labelledby="authorization-title"
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const buttons = event.currentTarget.querySelectorAll("button");
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }}
      onClose={() => {
        setAuthorization(null);
        trigger.current?.focus();
      }}
    >
      {authorization && (
        <>
          <span className="eyebrow">应用内能力授权</span>
          <h2 id="authorization-title">授权并启动扩展</h2>
          <p>以下扩展请求使用列出的应用能力。</p>
          <div className={styles.permissionList}>
            {authorization.ids.map((id) => (
              <section key={id}>
                <strong>
                  {catalog.find((entry) => entry.id === id)?.label ?? id}
                </strong>
                <code>
                  {id} · {host.manifest(id).version}
                </code>
                <ul>
                  {host.manifest(id).capabilities?.map((capability) => (
                    <li key={capability}>{capabilityLabel(capability)}</li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
          <p className={styles.trustNote}>
            可信扩展共享运行环境。授权约束公开契约调用，不构成恶意代码安全沙箱。
          </p>
          <div className={styles.dialogActions}>
            <button
              className="secondary"
              autoFocus
              onClick={closeAuthorization}
            >
              暂不授权
            </button>
            <button
              onClick={() => {
                const action = authorization.run;
                closeAuthorization();
                void operate(action);
              }}
            >
              授权并启动
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
