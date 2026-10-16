import { useEffect, useRef, useState } from "react";
import type { PlatformAdapter } from "../platform";
import type { SelectedDocument } from "../documents";
import styles from "./SelectedDocuments.module.css";

export function SelectedDocuments({
  adapter,
  owner,
  enabled,
}: {
  adapter: PlatformAdapter;
  owner: string;
  enabled: boolean;
}) {
  const [items, setItems] = useState<SelectedDocument[]>([]);
  const [status, setStatus] = useState("");
  const [pending, setPending] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  useEffect(() => {
    const epoch = ++generation.current;
    setItems([]);
    setStatus("");
    setPending(false);
    if (!enabled) controller.current?.abort();
    else
      void adapter.documents(owner).then(
        (value) => {
          if (generation.current === epoch) setItems(value);
        },
        () => {
          if (generation.current === epoch)
            setStatus("文档列表读取失败，请撤销全部文档或重新启用后重试。");
        },
      );
    return () => {
      generation.current++;
      controller.current?.abort();
    };
  }, [adapter, owner, enabled]);
  async function select(multiple: boolean) {
    const epoch = generation.current;
    const current = () => generation.current === epoch;
    const c = new AbortController();
    controller.current = c;
    setPending(true);
    setStatus("正在等待系统选择；取消不会增加文档授权。");
    try {
      const result = await adapter.selectDocuments(owner, multiple, c.signal);
      if (!current()) return;
      if (result.status === "selected") {
        const items = await adapter.documents(owner);
        if (!current()) return;
        setItems(items);
        setStatus(
          `已选择 ${result.documents.length} 个文档，请在扩展界面刷新列表后读取。`,
        );
      } else if (result.status === "cancelled")
        setStatus("已取消；若系统选择器仍显示，请关闭它。没有新增文档授权。");
      else if (result.status === "unknown")
        setStatus("选择结果待确认，请先撤销全部文档再重新选择。");
      else
        setStatus(
          `未添加文档：${result.reason === "resource-limit" ? "达到会话资源上限，请撤销旧文档或重新启动应用。" : result.reason === "busy" ? "选择器已打开，请完成或取消当前选择。" : "选择被拒绝或失败，请重试。"}`,
        );
    } catch {
      if (current()) setStatus("选择失败，请核对扩展授权后重试。");
    } finally {
      if (current()) setPending(false);
      if (controller.current === c) controller.current = null;
    }
  }
  async function revoke(handle?: string) {
    const epoch = generation.current;
    const current = () => generation.current === epoch;
    setPending(true);
    try {
      await adapter.revokeDocument(owner, handle);
      if (!current()) return;
      const items = await adapter.documents(owner);
      if (!current()) return;
      setItems(items);
      setStatus("已撤销后续读取。此前已交付给扩展的文本无法收回。");
    } catch {
      if (current())
        setStatus("撤销结果待确认，请撤销全部文档或重新启动应用后再授权。");
    } finally {
      if (current()) setPending(false);
    }
  }
  return (
    <section className={styles.documents} aria-label="文档只读授权">
      <h3>本次文档授权</h3>
      <p>
        仅向此扩展提供所选文档的只读句柄，每次最多64 KiB。停用或退出应用即失效。
      </p>
      {!adapter.available("document.read") ? (
        <p>此平台尚不支持文档选择。</p>
      ) : (
        <>
          {!enabled && <p>启用并确认扩展能力后，可选择文档。</p>}
          <div className={styles.actions}>
            <button
              className="secondary"
              disabled={!enabled || pending}
              onClick={() => void select(false)}
            >
              选择单个文档
            </button>
            <button
              className="secondary"
              disabled={!enabled || pending}
              onClick={() => void select(true)}
            >
              选择多个文档
            </button>
            {pending && (
              <button
                className="secondary"
                disabled={!controller.current}
                onClick={() => controller.current?.abort()}
              >
                取消选择
              </button>
            )}
            <button
              className="secondary"
              disabled={!enabled || pending}
              onClick={() => void revoke()}
            >
              撤销全部文档
            </button>
          </div>
          {items.length ? (
            <ul>
              {items.map((item) => (
                <li key={item.handle}>
                  <span>{item.name}</span>
                  <button
                    className="secondary"
                    disabled={pending || !enabled}
                    aria-label={`撤销 ${item.name}`}
                    onClick={() => void revoke(item.handle)}
                  >
                    撤销
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>没有可读取的文档。</p>
          )}
        </>
      )}
      {status && <p role="status">{status}</p>}
    </section>
  );
}
