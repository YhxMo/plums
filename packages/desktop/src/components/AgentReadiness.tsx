import { useEffect, useState } from "react";
import type { DesktopHost, ReadinessReason } from "@plumsjs/host";
import type { Resource } from "../shared/types.js";

type Plan = Awaited<ReturnType<DesktopHost["agentReadinessPlan"]>>;
const copy: Record<ReadinessReason["code"], string> = {
  SETTINGS_REQUIRED: "补齐必填配置",
  PROTOCOL_REQUIRED: "连接兼容组件",
  ENABLE_REQUIRED: "查看权限并启用组件",
  LOCAL_AUTHORIZATION_REQUIRED: "确认本地执行声明与范围",
  LOCAL_TIER_REQUIRED: "核对本地执行档位与上限",
  PROJECT_UNAVAILABLE: "项目档位暂不可用",
  FOUNDATION_UNAVAILABLE: "检查执行底座",
  STATE_UNAVAILABLE: "重新读取准备状态",
  RESOURCE_PAGE: "使用通用资源状态页",
};
const actions: Record<ReadinessReason["action"], string> = {
  settings: "填写配置",
  connections: "查看连接",
  enable: "配置并查看权限",
  permissions: "查看权限",
  foundation: "检查底座",
  resources: "查看资源",
  refresh: "重新读取",
};

export function AgentReadiness({
  instanceId,
  resources,
  onFix,
}: {
  instanceId: string;
  resources: Resource[];
  onFix: (reason: ReadinessReason) => void;
}) {
  const [plan, setPlan] = useState<Plan>();
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let current = true;
    setPlan(undefined);
    setError("");
    void window.manager
      .call("agentReadinessPlan", { instanceId })
      .then((value) => {
        if (current) setPlan(value as Plan);
      })
      .catch(() => {
        if (current) setError("准备状态未能读取，请重新读取。");
      });
    return () => {
      current = false;
    };
  }, [instanceId, resources, reload]);
  return (
    <section className="panel readiness" aria-label="使用前检查">
      <div className="section-heading">
        <div>
          <h2>使用前检查</h2>
          <p role="status">
            {error
              ? "准备状态暂不可用"
              : !plan
                ? "正在读取准备状态…"
                : plan.prepared
                  ? "声明与准备条件已满足"
                  : `还有 ${plan.reasons.filter((r) => r.blocking).length} 项准备条件待处理`}
          </p>
        </div>
        <button className="ghost sm" onClick={() => setReload((n) => n + 1)}>
          重新读取清单
        </button>
      </div>
      <p className="readiness-evidence">
        依据：宿主声明与准备条件。此清单不验证外部服务或调用成功，也不授予权限；任务范围与策略有效期须另行确认。
      </p>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {!!plan?.reasons.length && (
        <ul className="readiness-list">
          {plan.reasons.map((reason, index) => {
            const resource = resources.find((p) => p.id === reason.packageId);
            const field = reason.field
              ? resource?.settings.schema?.properties[reason.field]?.title ||
                reason.field
              : undefined;
            return (
              <li
                key={`${reason.code}:${reason.packageId}:${reason.field}:${reason.requirementId}:${reason.engineId}:${index}`}
              >
                <div>
                  <strong>{copy[reason.code]}</strong>
                  <small>
                    {reason.blocking ? "待处理" : "说明"}
                    {resource ? ` · ${resource.name}` : ""}
                    {field ? ` · ${field}` : ""}
                    {reason.requirementId ? ` · ${reason.requirementId}` : ""}
                    {reason.engineId ? ` · ${reason.engineId}` : ""}
                  </small>
                  {reason.code === "PROJECT_UNAVAILABLE" && (
                    <p>
                      项目运行入口仍返回
                      TIER_UNAVAILABLE，确认授权不能使它可用。
                    </p>
                  )}
                </div>
                <button
                  className="sm"
                  onClick={() =>
                    reason.action === "refresh"
                      ? setReload((n) => n + 1)
                      : onFix(reason)
                  }
                >
                  {actions[reason.action]}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
