import { useCallback, useState, useSyncExternalStore } from "react";
import { cn } from "cn";
import type { ModelConnectionsApi } from "@modules/models/extension";
import type { ProviderStatus, ProviderView } from "@modules/models/providers";
import { tokenLabel } from "@modules/models/protocols";
import { useAsyncAction } from "@/components/useAsyncAction";
import { DialogBody, DialogDone } from "@/components/Dialog";
import { ActionToast } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { ProviderForm } from "./ProviderForm";
import { useRequestSignal } from "./useRequestSignal";

const statusLabel: Record<ProviderStatus, string> = {
  ready: "可用",
  pending: "待核对",
  disabled: "已停用",
  "delete-pending": "删除待核对",
  missing: "需要 API Key",
  changed: "地址未确认",
};
/** The user's model providers and their models: add, edit (and delete), re-key, test. */
export function ModelConnections({
  api,
  onDone,
}: {
  api: ModelConnectionsApi;
  /** Closes the dialog; the list ends in a button for it. */
  onDone?: () => void;
}) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const providers = useSyncExternalStore(subscribe, () => api.list());
  // `null` lists; `""` is a new provider; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction();
  const requestSignal = useRequestSignal();

  const test = (provider: ProviderView, model: string) =>
    run(async () => {
      const key = `${provider.id}/${model}`;
      setResults((r) => ({ ...r, [key]: "正在测试…" }));
      try {
        const reply = await api.test(provider.id, model, requestSignal());
        setResults((r) => ({ ...r, [key]: `回复：${reply.slice(0, 60)}` }));
      } catch (reason) {
        setResults((r) => ({ ...r, [key]: "" }));
        throw reason;
      }
    });

  if (api.needsReload)
    return (
      <DialogBody>
        <p role="status">
          上次保存结果未确认。已暂停修改和模型请求，请重新读取并核对连接。
        </p>
        <Button
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api.reload();
              setEditing(null);
              setNotice("已重新读取，请核对连接后继续。");
            })
          }
        >
          {busy ? "正在读取…" : "重新读取连接"}
        </Button>
        <ActionToast
          error={error}
          notice={notice}
          onDone={() => {
            setError("");
            setNotice("");
          }}
        />
      </DialogBody>
    );
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
  const list = (
    <DialogBody>
      {providers.length === 0 ? (
        <p className="text-muted-foreground">还没有服务商</p>
      ) : (
        <ul className="grid gap-4" aria-label="服务商">
          {providers.map((provider) => {
            const keyless = provider.status === "missing";
            return (
              <li
                key={provider.id}
                aria-label={provider.name}
                className="rounded-lg border"
              >
                <div className="flex items-center gap-3 p-3">
                  <div className="grid min-w-0 flex-1 gap-0.5">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <strong className="font-semibold">{provider.name}</strong>
                      <Status status={provider.status} />
                    </span>
                    <span className="font-mono text-xs break-all text-muted-foreground">
                      {provider.base}
                    </span>
                    {provider.notes && (
                      <span className="text-xs text-muted-foreground">
                        {provider.notes}
                      </span>
                    )}
                  </div>
                  <Button
                    variant={keyless ? "default" : "outline"}
                    size="xs"
                    aria-label={
                      keyless
                        ? `为 ${provider.name} 填写 Key`
                        : `编辑 ${provider.name}`
                    }
                    disabled={busy}
                    onClick={() => setEditing(provider.id)}
                  >
                    {keyless ? "填写 Key" : "编辑"}
                  </Button>
                </div>
                {provider.models.length === 0 ? (
                  <p className="border-t px-3 py-2.5 text-xs text-muted-foreground">
                    还没有模型
                  </p>
                ) : (
                  <ul aria-label={`${provider.name} 的模型`}>
                    {provider.models.map((model) => {
                      const result = results[`${provider.id}/${model}`];
                      return (
                        <li
                          key={model}
                          className="flex min-h-10 items-center gap-3 border-t px-3 py-1.5"
                        >
                          <span className="grid min-w-0 flex-1 gap-0.5 break-words">
                            {model}
                            {result && (
                              <span
                                role="status"
                                className={cn(
                                  "text-xs text-muted-foreground",
                                  result.startsWith("回复") && "text-running",
                                )}
                              >
                                {result}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            上下文{" "}
                            {tokenLabel(
                              provider.windows[model] ?? provider.context,
                            )}
                          </span>
                          {provider.status === "ready" && (
                            <Button
                              variant="ghost"
                              size="xs"
                              className="text-muted-foreground max-md:min-h-11"
                              aria-label={`测试 ${model}`}
                              disabled={busy}
                              onClick={() => void test(provider, model)}
                            >
                              测试
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <ActionToast
        error={error}
        notice={notice}
        onDone={() => {
          setError("");
          setNotice("");
        }}
      />
      <Button
        variant="outline"
        className="justify-self-start"
        disabled={busy}
        onClick={() => setEditing("")}
      >
        添加服务商
      </Button>
    </DialogBody>
  );
  // Changes save as they are made, so the list only needs a way out.
  return (
    <>
      {list}
      <DialogDone onDone={onDone} />
    </>
  );
}

/** A provider's state: a dot and its word, orange when it needs a key. */
function Status({ status }: { status: ProviderStatus }) {
  const attention = status === "missing" || status === "changed";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs text-muted-foreground",
        attention && "text-brand-text",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full bg-input",
          status === "ready" && "bg-running",
          attention && "bg-brand",
        )}
      />
      {statusLabel[status]}
    </span>
  );
}
