import { useRef, useState } from "react";
import { ShieldCheckIcon } from "lucide-react";
import type { AuthorizationDialogProps } from "./controllers";
import { capabilityLabel } from "./messages";
import { Dialog, DialogActions, DialogBody } from "@/components/Dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type Request = { ids: string[]; run: () => Promise<void> };
export function useAuthorization() {
  const [authorization, setAuthorization] = useState<Request | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  return {
    authorization,
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
      setAuthorization(null);
    },
  };
}
export type Authorization = ReturnType<typeof useAuthorization>;
export function AuthorizationDialog({
  runtime,
  operations,
  controller,
}: AuthorizationDialogProps) {
  const { host, catalog } = runtime;
  const { operate } = operations;
  const { authorization, trigger, closeAuthorization } = controller;
  if (!authorization) return null;
  return (
    <Dialog
      title="授权并启动扩展"
      returnFocusTo={trigger.current}
      onClose={closeAuthorization}
    >
      <DialogBody>
        <p className="text-muted-foreground">
          以下扩展请求使用列出的应用能力。
        </p>
        <ul className="grid gap-2">
          {authorization.ids.map((id) => (
            <li key={id} className="rounded-lg bg-muted/60 p-3">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <strong>
                  {catalog.find((entry) => entry.id === id)?.label ?? id}
                </strong>
                <code className="text-xs text-muted-foreground">
                  {id} · {host.manifest(id).version}
                </code>
              </div>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {host.manifest(id).capabilities?.map((capability) => (
                  <li key={capability}>
                    <Badge variant="outline" className="bg-background">
                      <ShieldCheckIcon />
                      {capabilityLabel(capability, host.manifest(id))}
                    </Badge>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          可信扩展共享运行环境。授权约束公开契约调用，不构成恶意代码安全沙箱。
        </p>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" onClick={closeAuthorization}>
          暂不授权
        </Button>
        <Button
          onClick={() => {
            const action = authorization.run;
            closeAuthorization();
            void operate(action);
          }}
        >
          授权并启动
        </Button>
      </DialogActions>
    </Dialog>
  );
}
