import { useEffect, useState } from "react";
import type { DesktopHost, PolicyScopeSelection } from "@plums/host";
const modeNames: Record<string, string> = {
  "full-access": "完全访问",
  automatic: "自动审查",
  confirm: "高危人工确认",
  custom: "自定义",
};
const categoryNames: Record<string, string> = {
  fs: "文件",
  resource: "业务资源",
  https: "网络",
  exec: "命令",
  tool: "工具",
};
const operationNames: Record<string, string> = {
  read: "读取",
  list: "列出",
  write: "写入",
  delete: "删除",
  send: "发送",
  request: "请求",
  run: "运行",
  invoke: "调用",
};
type Plan = Awaited<ReturnType<DesktopHost["policyPlan"]>>;
export function PolicyModes({
  instanceId,
  revision,
}: {
  instanceId: string;
  revision: unknown;
}) {
  const [plan, setPlan] = useState<Plan>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [provider, setProvider] = useState(""),
    [mode, setMode] = useState("custom"),
    [duration, setDuration] = useState(900_000),
    [selection, setSelection] = useState<PolicyScopeSelection[]>([]);
  const refresh = async () => {
    const next = (await window.manager.call("policyPlan", {
      instanceId,
    })) as Plan;
    setPlan(next);
  };
  useEffect(() => {
    let current = true;
    setPlan(undefined);
    setSelection([]);
    setError("");
    const read = () =>
      window.manager
        .call("policyPlan", { instanceId })
        .then((value) => {
          if (current) setPlan(value as Plan);
        })
        .catch(() => {
          if (current) setError("策略状态未能读取，请重试。");
        });
    void read();
    const timer = setInterval(() => void read(), 1000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [instanceId, revision]);
  const run = async (method: string, args: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await window.manager.call(method, {
        instanceId,
        fingerprint: plan?.fingerprint,
        ...args,
      });
      setSelection([]);
      await refresh();
    } catch {
      setError("操作未完成。请检查当前组件、范围和策略，再重试。");
    } finally {
      setBusy(false);
    }
  };
  if (!plan && !error) return null;
  if (!plan?.selected && !plan?.candidates.length && !error) return null;
  return (
    <section className="section policy-modes" data-testid="policy-modes">
      <h3>权限策略</h3>
      <p className="muted">
        选择一个策略，并批准本次最大范围。策略可在所选范围内代替你确认，拒绝不可被覆盖；需要单次确认时，策略不可用会回到可信确认窗口。脱敏请求可能经提供者已声明、已批准的目标外发。重启后须重新批准。
      </p>
      {error && <p role="alert">{error}</p>}
      <p role="status">
        {plan?.selected
          ? `已选择：${plan.componentNames[plan.selected.providerId] ?? plan.selected.providerId} · ${modeNames[plan.selected.mode] ?? plan.selected.mode}。${plan.active ? `有效至 ${new Date(plan.active.expiresAt).toLocaleTimeString()}` : "未批准活动范围，策略操作暂停。"}`
          : "当前使用安全确认。"}
      </p>
      <fieldset disabled={busy}>
        <legend>选择策略</legend>
        <label>
          策略组件
          <select
            aria-label="策略组件"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
          >
            <option value="">请选择</option>
            {plan?.candidates.map((c) => (
              <option
                key={c.binding.providerId + "/" + c.binding.provideId}
                value={c.binding.providerId + "/" + c.binding.provideId}
              >
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          模式名称
          <select
            aria-label="模式名称"
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            <option value="full-access">完全访问</option>
            <option value="automatic">自动审查</option>
            <option value="confirm">高危人工确认</option>
            <option value="custom">自定义</option>
          </select>
        </label>
        <p className="muted">
          名称用于标记偏好，实际决定由所选策略提供。跨 Agent
          业务资源的完全访问范围在业务资源中单独选择。
        </p>
        <button
          className="sm"
          disabled={!provider}
          onClick={() => {
            const [providerId, provideId] = provider.split("/");
            void run("selectPolicy", { providerId, provideId, mode });
          }}
        >
          保存策略
        </button>
        {plan?.selected && (
          <button className="sm" onClick={() => void run("selectPolicy", {})}>
            恢复安全确认
          </button>
        )}
      </fieldset>
      {plan?.selected && (
        <fieldset disabled={busy}>
          <legend>本次最大范围</legend>
          <p className="muted">
            逐项选择参与组件、操作和目标。资源访问还须处于已批准的业务资源范围，调用链各组件均须覆盖。
          </p>
          <div className="policy-scope-list">
            {plan.available.map((row, i) => {
              const checked = (plan.active?.selection ?? selection).some(
                (v) => JSON.stringify(v) === JSON.stringify(row),
              );
              return (
                <label className="controlled-option" key={i}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={!!plan.active}
                    onChange={(e) =>
                      setSelection(
                        e.target.checked
                          ? [...selection, row]
                          : selection.filter(
                              (v) => JSON.stringify(v) !== JSON.stringify(row),
                            ),
                      )
                    }
                  />
                  <span>
                    {plan.componentNames[row.componentId] ?? row.componentId} ·{" "}
                    {categoryNames[row.category]}/
                    {operationNames[row.operation] ?? row.operation} ·{" "}
                    {plan.targetNames[row.target] ?? row.target}
                  </span>
                </label>
              );
            })}
          </div>
          {!plan.available.length && (
            <p className="muted">
              当前没有可选操作。请先配置组件及业务资源范围。
            </p>
          )}
          <label>
            有效期
            <select
              aria-label="策略有效期"
              value={duration}
              disabled={!!plan.active}
              onChange={(e) => setDuration(Number(e.target.value))}
            >
              <option value={900_000}>15 分钟</option>
              <option value={3_600_000}>1 小时</option>
            </select>
          </label>
          <button
            className="sm"
            disabled={!selection.length || !!plan.active}
            onClick={() =>
              void run("grantPolicyScope", { durationMs: duration, selection })
            }
          >
            批准所选范围
          </button>
          <button
            className="sm"
            disabled={!plan.active}
            onClick={() => void run("revokePolicyScope", {})}
          >
            撤销并停止
          </button>
        </fieldset>
      )}
    </section>
  );
}
