import { useCallback, useState, useSyncExternalStore } from "react";
import type { ModelConnectionsApi } from "../../modules/models/extension";
import type {
  ProviderStatus,
  ProviderView,
} from "../../modules/models/providers";
import { tokenLabel } from "../../modules/models/protocols";
import { useAsyncAction } from "../components/useAsyncAction";
import { ProviderForm } from "./ProviderForm";
import s from "./ModelConnections.module.css";

const statusLabel: Record<ProviderStatus, string> = {
  ready: "可用",
  pending: "待核对",
  disabled: "已停用",
  "delete-pending": "删除待核对",
  missing: "需要录入密钥",
  changed: "地址未确认",
};

/** The user's model providers and their models: add, edit, re-key, test, delete. */
export function ModelConnections({ api }: { api: ModelConnectionsApi }) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const providers = useSyncExternalStore(subscribe, () => api.list());
  // `null` lists; `""` is a new provider; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const { busy, error, notice, setNotice, run } = useAsyncAction();

  const test = (provider: ProviderView, model: string) =>
    run(async () => {
      const key = `${provider.id}/${model}`;
      setResults((r) => ({ ...r, [key]: "正在测试…" }));
      try {
        const reply = await api.test(
          provider.id,
          model,
          AbortSignal.timeout(60_000),
        );
        setResults((r) => ({ ...r, [key]: `回复：${reply.slice(0, 60)}` }));
      } catch (reason) {
        setResults((r) => ({ ...r, [key]: "" }));
        throw reason;
      }
    });

  if (editing !== null)
    return (
      <ProviderForm
        api={api}
        providers={providers}
        provider={providers.find((p) => p.id === editing)}
        onDone={(message) => {
          setEditing(null);
          setNotice(message);
        }}
      />
    );
  return (
    <div className="dialog-content">
      <p>
        先添加服务商（请求地址与你自己的 API Key），再添加或获取它提供的模型；在
        Agent 详情里为每个 Agent 选择模型。
      </p>
      {providers.length === 0 ? (
        <p className={s.empty}>还没有服务商。</p>
      ) : (
        <ul className={s.list} aria-label="服务商">
          {providers.map((provider) => (
            <li key={provider.id} aria-label={provider.name}>
              <div className={s.header}>
                <div className={s.summary}>
                  <span className={s.title}>
                    <strong>{provider.name}</strong>
                    <span className={s.status} data-status={provider.status}>
                      {statusLabel[provider.status]}
                    </span>
                  </span>
                  <span className={s.meta}>
                    {api.presets.find((p) => p.id === provider.preset)?.label ??
                      "自定义"}
                    {` · 上下文 ${tokenLabel(provider.context)}`}
                    {provider.notes && ` · ${provider.notes}`}
                  </span>
                  <span className={`${s.meta} ${s.url}`}>{provider.base}</span>
                </div>
                <div className={s.actions}>
                  <button
                    className="secondary"
                    aria-label={`编辑 ${provider.name}`}
                    disabled={busy}
                    onClick={() => setEditing(provider.id)}
                  >
                    编辑
                  </button>
                  <button
                    className="secondary"
                    aria-label={`删除 ${provider.name}`}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        if (!(await api.remove(provider.id)))
                          return setNotice("已取消删除。");
                        setNotice("已删除。");
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              </div>
              {provider.models.length === 0 ? (
                <p className={s.meta}>还没有模型，点「编辑」添加或获取。</p>
              ) : (
                <ul
                  className={s.modelRows}
                  aria-label={`${provider.name} 的模型`}
                >
                  {provider.models.map((model) => {
                    const result = results[`${provider.id}/${model}`];
                    return (
                      <li key={model}>
                        <span className={s.summary}>
                          <span>
                            {model}
                            {Object.hasOwn(provider.windows, model) && (
                              <span className={s.meta}>
                                {` · 上下文 ${tokenLabel(provider.windows[model])}`}
                              </span>
                            )}
                          </span>
                          {result && (
                            <span role="status" className={s.meta}>
                              {result}
                            </span>
                          )}
                        </span>
                        <button
                          className="secondary"
                          aria-label={`测试 ${model}`}
                          disabled={busy || provider.status !== "ready"}
                          onClick={() => void test(provider, model)}
                        >
                          测试
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <button className={s.add} disabled={busy} onClick={() => setEditing("")}>
        添加服务商
      </button>
    </div>
  );
}
