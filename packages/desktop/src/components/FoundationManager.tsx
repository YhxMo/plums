import { useEffect, useRef, useState } from "react";
import type { DesktopHost } from "@plums/host";
import type { FoundationSelection } from "@plums/sdk";
import { useAction } from "../hooks/useAction.js";
type Management = Awaited<ReturnType<DesktopHost["foundationManagement"]>>;
type Plan = Awaited<ReturnType<DesktopHost["foundationPlan"]>>;
const key = (s: FoundationSelection) =>
  JSON.stringify([s.source, s.id, s.version, s.digest]);
const reasonText: Record<string, string> = {
  FOUNDATION_UNAVAILABLE:
    "固定制品缺失或损坏。请导入同一制品，或检查另一底座后切换。",
  FOUNDATION_INVALID: "底座制品无效。请重新导入原始 ZIP。",
  FOUNDATION_INCOMPATIBLE: "此底座未满足 Agent 或组件要求，请选择兼容制品。",
  FOUNDATION_DATA_ADAPTER_REQUIRED:
    "数据格式需要适配。请保留数据，选择支持当前格式的底座。",
  FOUNDATION_RECOVERY_REQUIRED:
    "记录或事务无法恢复。请重试；未来版本需使用支持它的应用，损坏记录需从备份修复。",
  FOUNDATION_BUSY: "另一宿主仍在使用此 Agent，请先关闭该会话。",
};
export function FoundationManager({
  instanceId,
  onImport,
}: {
  instanceId?: string;
  onImport?: () => void;
}) {
  const [data, setData] = useState<Management>(),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<Record<string, string>>({}),
    [plans, setPlans] = useState<Record<string, Plan>>({});
  const generation = useRef(0),
    action = useAction(instanceId ?? "foundations");
  const reload = async () => {
    const current = ++generation.current;
    try {
      const value = (await window.manager.call("foundationManagement", {
        instanceId,
      })) as Management;
      if (current === generation.current) {
        setData(value);
        setPlans({});
        setError("");
      }
    } catch {
      if (current === generation.current)
        setError("底座管理未能读取，请重试。");
    }
  };
  useEffect(() => {
    setData(undefined);
    setSelected({});
    setPlans({});
    void reload();
    const unsubscribe = window.manager.onRefresh(() => void reload());
    return () => {
      generation.current++;
      unsubscribe();
    };
  }, [instanceId]);
  const operate = (fn: () => Promise<unknown>) =>
    void action.run(async () => {
      await fn();
      await reload();
    });
  return (
    <section
      className="foundation-manager"
      data-testid="foundation-manager"
      aria-busy={action.pending}
    >
      <div className="section-heading">
        <div>
          <h2>执行底座</h2>
          <p>
            Agent
            固定使用具体制品。切换会停止相关运行并清除本次任务授权，组件配置与数据保留。
          </p>
        </div>
        <div className="inline-actions">
          {onImport && (
            <button onClick={onImport} disabled={action.pending}>
              导入底座 ZIP
            </button>
          )}
          <button
            onClick={() =>
              operate(() => window.manager.call("restoreBuiltinFoundation"))
            }
            disabled={action.pending}
          >
            修复当前内置制品
          </button>
          <button onClick={() => void reload()} disabled={action.pending}>
            刷新底座
          </button>
        </div>
      </div>
      {(error || action.error) && (
        <p role="alert" className="notice error">
          {error || action.error}
        </p>
      )}
      {!data && !error && <p role="status">正在读取底座…</p>}
      {data?.catalogFailure && (
        <p role="alert" className="notice error">
          部分底座无法读取。请修复或重新导入原始制品。
        </p>
      )}
      {data && !instanceId && (
        <div className="foundation-catalog" aria-label="已安装底座">
          {data.catalog.map((item) => (
            <article key={key(item.selection)} className="foundation-item">
              <strong>{item.selection.id}</strong>
              <p>
                {item.selection.source === "builtin"
                  ? "官方内置"
                  : "第三方公共库"}{" "}
                · v{item.selection.version}
              </p>
              <small>
                摘要 {item.selection.digest.slice(0, 16)} ·{" "}
                {item.provider.platforms.join("、")} · 兼容性依据：声明
              </small>
              <p>
                {item.usedBy.length
                  ? `${item.usedBy.length} 个 Agent 引用，制品保留`
                  : "暂无 Agent 引用"}
              </p>
              <div className="inline-actions">
                <button
                  disabled={action.pending}
                  onClick={() =>
                    operate(() =>
                      window.manager.call("exportFoundation", {
                        selection: item.selection,
                      }),
                    )
                  }
                >
                  导出底座 ZIP
                </button>
                <button
                  disabled={action.pending || item.usedBy.length > 0}
                  onClick={() =>
                    operate(() =>
                      window.manager.call("removeFoundation", {
                        selection: item.selection,
                      }),
                    )
                  }
                >
                  删除底座
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {data?.agents.map((agent) => {
        const chosen = data.catalog.find(
            (a) => key(a.selection) === selected[agent.instanceId],
          ),
          plan = plans[agent.instanceId];
        return (
          <div
            key={agent.instanceId}
            className="foundation-agent"
            data-testid="foundation-agent"
          >
            <h3>{agent.name}</h3>
            <p role="status">
              {agent.current
                ? `${agent.current.selection.id} · v${agent.current.selection.version} · ${agent.current.selection.source === "builtin" ? "官方内置" : "第三方公共库"} · ${agent.current.enabled ? "已启用" : "已停用"}`
                : "当前选择无法读取"}
            </p>
            {agent.current && (
              <small>
                固定摘要 {agent.current.selection.digest.slice(0, 16)}
              </small>
            )}
            {agent.reason && (
              <p className="notice error">
                {reasonText[agent.reason] ?? "底座暂不可用，请检查选择。"}
              </p>
            )}
            {agent.recoveryBlocked ? (
              <button
                disabled={action.pending}
                onClick={() =>
                  operate(() =>
                    window.manager.call("retryFoundationRecovery", {
                      instanceId: agent.instanceId,
                    }),
                  )
                }
              >
                重试保留数据的恢复
              </button>
            ) : (
              <>
                <label className="field">
                  <strong>为 {agent.name} 选择底座</strong>
                  <select
                    aria-label={`为 ${agent.name} 选择底座`}
                    value={selected[agent.instanceId] ?? ""}
                    disabled={action.pending}
                    onChange={(e) => {
                      setSelected({
                        ...selected,
                        [agent.instanceId]: e.target.value,
                      });
                      setPlans((p) => {
                        const next = { ...p };
                        delete next[agent.instanceId];
                        return next;
                      });
                    }}
                  >
                    <option value="">请选择精确制品</option>
                    {data.catalog.map((item) => (
                      <option
                        key={key(item.selection)}
                        value={key(item.selection)}
                      >
                        {item.selection.id} · v{item.selection.version} ·{" "}
                        {item.selection.digest.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="inline-actions">
                  <button
                    disabled={!chosen || action.pending}
                    onClick={() =>
                      void action.run(async () => {
                        const current = generation.current;
                        const p = (await window.manager.call("foundationPlan", {
                          instanceId: agent.instanceId,
                          selection: chosen!.selection,
                        })) as Plan;
                        if (current !== generation.current) return;
                        setPlans((prev) => ({
                          ...prev,
                          [agent.instanceId]: p,
                        }));
                      }, false)
                    }
                  >
                    检查兼容
                  </button>
                  <button
                    disabled={
                      !plan?.compatible ||
                      !chosen ||
                      key(plan.candidate) !== key(chosen.selection) ||
                      action.pending
                    }
                    onClick={() =>
                      operate(() =>
                        window.manager.call("switchFoundation", {
                          instanceId: agent.instanceId,
                          selection: plan!.candidate,
                          fingerprint: plan!.fingerprint,
                        }),
                      )
                    }
                  >
                    切换并启用
                  </button>
                  <button
                    disabled={
                      !agent.current ||
                      action.pending ||
                      (!agent.current.enabled && !agent.compatible)
                    }
                    onClick={() =>
                      operate(() =>
                        window.manager.call("setFoundationEnabled", {
                          instanceId: agent.instanceId,
                          enabled: !agent.current!.enabled,
                        }),
                      )
                    }
                  >
                    {agent.current?.enabled ? "停用底座" : "启用底座"}
                  </button>
                </div>
                {plan && (
                  <div className="foundation-plan" role="status">
                    <p>
                      {plan.compatible
                        ? "声明兼容，可切换。切换后需重新批准任务范围。"
                        : (reasonText[
                            (plan.failure as { reason?: string })?.reason ?? ""
                          ] ?? "候选底座无法使用。")}
                    </p>
                    {!plan.compatible &&
                      !!plan.failure &&
                      "reports" in (plan.failure as object) && (
                        <pre>
                          {JSON.stringify(
                            (plan.failure as { reports: unknown }).reports,
                            null,
                            2,
                          )}
                        </pre>
                      )}
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      {data && !data.agents.length && (
        <p>还没有 Agent。创建或导入后，可以在这里选择执行底座。</p>
      )}
    </section>
  );
}
