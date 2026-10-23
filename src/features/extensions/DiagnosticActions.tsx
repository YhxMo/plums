import { useState } from "react";
import type { DiagnosticActionsProps } from "@/shell/controllers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
export function DiagnosticActions({
  runtime,
  operations,
  workspace,
  authorization,
  experiments,
}: DiagnosticActionsProps) {
  const { host, adapter } = runtime;
  const { busy, operate, setNotice } = operations;
  const { activeView, setSelected } = workspace;
  const { requestAuthorization } = authorization;
  const { started, start, writeDenied } = experiments;
  // The adapter keeps the fault; a remounted panel shows what is in force.
  const [fault, setFault] = useState(() => adapter.failWrites);
  return (
    <>
      <Button
        variant="secondary"
        className="justify-self-start"
        disabled={busy || !experiments.available}
        onClick={(event) =>
          requestAuthorization(["workbench"], start, event.currentTarget)
        }
      >
        授予实验能力并启动
      </Button>
      <div className="grid grid-cols-2 gap-2 max-md:grid-cols-1">
        <Button
          variant="outline"
          disabled={!started || busy}
          onClick={() =>
            void operate(async () => {
              const upper = host.inspect("transform.upper").status === "active";
              await host.stop(upper ? "transform.upper" : "transform.reverse");
              await host.start(upper ? "transform.reverse" : "transform.upper");
              setNotice("服务已替换，工作台已重新连接。");
            })
          }
        >
          替换服务
        </Button>
        <Button
          variant="outline"
          disabled={!activeView || busy}
          onClick={() =>
            void operate(async () => {
              const owner = host
                .views()
                .find((view) => view.id === activeView)!.owner;
              await host.stop(owner);
              setSelected("default");
              setNotice("布局已停用，已选择可用界面。");
            })
          }
        >
          停用当前布局
        </Button>
        <Button
          variant="outline"
          disabled={!started || busy}
          onClick={() =>
            void operate(async () => {
              await host.start("ui.broken");
              setSelected("broken");
            })
          }
        >
          测试故障布局
        </Button>
        <Button
          variant="outline"
          disabled={!started || busy}
          onClick={(event) => {
            if (writeDenied)
              requestAuthorization(
                ["workbench"],
                async () => {
                  await host.grant("workbench", ["state.read", "state.write"]);
                },
                event.currentTarget,
              );
            else
              void operate(async () => {
                await host.grant("workbench", ["state.read"]);
                setNotice("写入能力已撤销，工作台等待重新授权。");
              });
          }}
        >
          {writeDenied ? "恢复状态写入" : "撤销状态写入"}
        </Button>
        <Label className="col-span-full flex min-h-9 items-center gap-2 font-normal">
          <Checkbox
            checked={fault}
            onCheckedChange={(checked) => {
              adapter.failWrites = checked === true;
              setFault(checked === true);
            }}
          />
          注入存储写入失败
        </Label>
        <p className="col-span-full text-xs text-muted-foreground">
          故障注入只用于本应用实验，不代表操作系统授权。
        </p>
      </div>
    </>
  );
}
