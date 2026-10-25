import type { RecoveryWelcomeProps } from "./controllers";
import { Button } from "@/components/ui/button";

const steps = ["查看扩展", "确认授权", "运行与保存"];

export function RecoveryWelcome({
  operations,
  experiments,
  authorization,
  onExtensions,
}: RecoveryWelcomeProps) {
  const { busy } = operations;
  const { started, start, available, authorizationOwners } = experiments;
  const { requestAuthorization } = authorization;
  return (
    <main className="h-full p-2 pt-0">
      <div className="h-full overflow-auto rounded-xl border bg-card">
        <div className="mx-auto max-w-150 px-6 py-[clamp(28px,7vh,72px)]">
          <img
            className="mb-5 size-12 rounded-[10px] object-contain"
            src="/brand/plums.png"
            alt=""
          />
          <span className="text-xs font-semibold text-muted-foreground">
            你的本地工作空间
          </span>
          <h1 className="mt-2 mb-3 text-xl leading-snug font-semibold">
            {started
              ? "扩展正在等待条件。"
              : available
                ? "从一个可替换的界面开始。"
                : "当前没有可显示的界面。"}
          </h1>
          <p className="max-w-128 leading-relaxed text-muted-foreground">
            {started
              ? "查看扩展状态以恢复依赖，或重新启用默认组合。已保存的数据会在恢复时读取。"
              : available
                ? "服务处理输入，布局呈现结果。先查看扩展，再授权启动你的第一个组合。"
                : "在扩展管理中启用一个界面扩展，例如默认 Agent 界面。已保存的数据会在恢复时读取。"}
          </p>
          <ol className="my-5 flex flex-wrap gap-x-5 gap-y-2.5 text-muted-foreground">
            {steps.map((step, index) => (
              <li key={step} className="flex items-center gap-2">
                <b className="grid size-6 place-items-center rounded-full bg-brand-soft text-xs text-brand-text">
                  {index + 1}
                </b>
                {step}
              </li>
            ))}
          </ol>
          <div className="flex flex-wrap gap-3 max-md:flex-col max-md:items-stretch">
            {available && (
              <Button
                size="lg"
                disabled={busy}
                onClick={(event) =>
                  requestAuthorization(
                    authorizationOwners,
                    start,
                    event.currentTarget,
                  )
                }
              >
                {started ? "恢复权限与默认界面" : "授予实验能力并启动"}
              </Button>
            )}
            <Button size="lg" variant="outline" onClick={onExtensions}>
              查看本地扩展
            </Button>
          </div>
          {available && (
            <p className="mt-5 text-xs text-muted-foreground">
              默认组合：文本工作台、大写服务、工作台与画布布局。只处理本地示例文本。
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
