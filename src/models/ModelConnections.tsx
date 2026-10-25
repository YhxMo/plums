import { useCallback, useState, useSyncExternalStore } from "react";
import {
  PencilIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
  ZapIcon,
} from "lucide-react";
import { cn } from "cn";
import type { ModelConnectionsApi } from "@modules/models/extension";
import type { ProviderStatus, ProviderView } from "@modules/models/providers";
import { tokenLabel } from "@modules/models/protocols";
import { useAsyncAction } from "@/components/useAsyncAction";
import { DialogBody } from "@/components/Dialog";
import { ActionToast } from "@/components/Toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ProviderForm } from "./ProviderForm";
import { useRequestSignal } from "./useRequestSignal";

const statusLabel: Record<ProviderStatus, string> = {
  ready: "可用",
  pending: "待核对",
  disabled: "已停用",
  "delete-pending": "删除待核对",
  missing: "需要录入密钥",
  changed: "地址未确认",
};
const statusTone: Partial<Record<ProviderStatus, string>> = {
  ready: "bg-running/12 text-foreground",
  missing: "bg-brand-soft text-brand-text",
  changed: "bg-brand-soft text-brand-text",
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
  return (
    <DialogBody>
      <p className="text-muted-foreground">
        先添加服务商（请求地址与你自己的 API Key），再添加或获取它提供的模型；在
        对话输入区为每个 Agent 选择模型。
      </p>
      {providers.length === 0 ? (
        <Empty className="gap-3 border border-dashed p-6 md:p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle className="text-sm">还没有服务商</EmptyTitle>
            <EmptyDescription>
              添加一个服务商后，Agent 就能选用它的模型。
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="grid gap-3" aria-label="服务商">
          {providers.map((provider) => (
            <li
              key={provider.id}
              aria-label={provider.name}
              className="grid gap-3 rounded-xl border bg-card p-3.5"
            >
              <div className="flex items-start justify-between gap-3 max-form:flex-col max-form:items-stretch">
                <div className="grid min-w-0 gap-0.5 text-sm">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <strong className="font-semibold">{provider.name}</strong>
                    <Badge
                      variant="secondary"
                      className={statusTone[provider.status]}
                    >
                      {statusLabel[provider.status]}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {api.presets.find((p) => p.id === provider.preset)?.label ??
                      "自定义"}
                    {`，上下文 ${tokenLabel(provider.context)}`}
                    {provider.notes && `，${provider.notes}`}
                  </span>
                  <span className="font-mono text-xs break-all text-muted-foreground">
                    {provider.base}
                  </span>
                </div>
                <div className="flex shrink-0 gap-2 max-form:*:flex-1">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`编辑 ${provider.name}`}
                    disabled={busy}
                    onClick={() => setEditing(provider.id)}
                  >
                    <PencilIcon data-icon="inline-start" />
                    编辑
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
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
                    <Trash2Icon data-icon="inline-start" />
                    删除
                  </Button>
                </div>
              </div>
              {provider.models.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  还没有模型，点「编辑」添加或获取。
                </p>
              ) : (
                <ul
                  className="divide-y overflow-hidden rounded-lg border bg-background/60"
                  aria-label={`${provider.name} 的模型`}
                >
                  {provider.models.map((model) => {
                    const result = results[`${provider.id}/${model}`];
                    return (
                      <li
                        key={model}
                        className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5 text-sm"
                      >
                        <span className="grid min-w-0 gap-0.5 break-words">
                          <span>
                            {model}
                            {Object.hasOwn(provider.windows, model) && (
                              <span className="text-xs text-muted-foreground">
                                {`上下文 ${tokenLabel(provider.windows[model])}`}
                              </span>
                            )}
                          </span>
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
                        <Button
                          variant="ghost"
                          size="xs"
                          className="max-md:min-h-11"
                          aria-label={`测试 ${model}`}
                          disabled={busy || provider.status !== "ready"}
                          onClick={() => void test(provider, model)}
                        >
                          <ZapIcon data-icon="inline-start" />
                          测试
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          ))}
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
      <Button disabled={busy} onClick={() => setEditing("")}>
        <PlusIcon data-icon="inline-start" />
        添加服务商
      </Button>
    </DialogBody>
  );
}
