import { useEffect, useState } from "react";
import type { DesktopHost, AgentRecord } from "@plumsjs/host";
import type { Resource } from "../shared/types.js";
type Plan = Awaited<ReturnType<DesktopHost["workspacePlan"]>>;
export function WorkspaceComposition({
  record,
  resources,
}: {
  record: AgentRecord;
  resources: Resource[];
}) {
  const count = resources.filter(
    (r) =>
      (r.manifest.payload as { plumsDesktop?: { frontend?: string } })
        ?.plumsDesktop?.frontend,
  ).length;
  const [plan, setPlan] = useState<Plan>(),
    [root, setRoot] = useState(record.agent.startup ?? ""),
    [selected, setSelected] = useState<string[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    setRoot(record.agent.startup ?? "");
  }, [record.instanceId, record.agent.startup]);
  useEffect(() => {
    if (count < 1) return;
    let current = true;
    setPlan(undefined);
    setError("");
    void window.manager
      .call("workspacePlan", {
        instanceId: record.instanceId,
        componentId: root || undefined,
      })
      .then((p) => {
        if (!current) return;
        const next = p as Plan;
        setPlan(next);
        setSelected(
          next.layout?.views
            .filter(
              (v) =>
                !v.panelId &&
                v.visible &&
                next.frontends.some(
                  (f) =>
                    f.componentId === v.componentId &&
                    f.digest === v.digest &&
                    f.enabled,
                ),
            )
            .map((v) => v.componentId) ?? [],
        );
      })
      .catch(() => {
        if (current) setError("界面组合未能读取，请重试。");
      });
    return () => {
      current = false;
    };
  }, [record.instanceId, resources, root, count]);
  if (count < 1) return null;
  const run = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    try {
      await window.manager.call("setWorkspaceViews", {
        instanceId: record.instanceId,
        componentId: root,
        components: selected,
        fingerprint: plan.fingerprint,
      });
      setPlan(
        (await window.manager.call("workspacePlan", {
          instanceId: record.instanceId,
          componentId: root,
        })) as Plan,
      );
    } catch {
      setError("组合未保存。请刷新后重新选择。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="section workspace-composition"
      data-testid="workspace-composition"
    >
      <h3>工作界面组合</h3>
      <p className="muted">
        选择主界面和并排界面。每个界面独立连接已选后端，关闭重开时恢复布局。权限与后台接管在可信管理页单独批准。
      </p>
      {error && <p role="alert">{error}</p>}
      {!plan && !error && <p role="status">正在读取界面…</p>}
      {plan && (
        <>
          <label>
            主界面
            <select
              value={root}
              disabled={busy}
              onChange={(e) => setRoot(e.target.value)}
            >
              <option value="">选择界面</option>
              {plan.frontends.map((f) => (
                <option
                  key={f.componentId}
                  value={f.componentId}
                  disabled={!f.enabled}
                >
                  {f.name}
                  {!f.enabled ? "（未启用）" : ""}
                </option>
              ))}
            </select>
          </label>
          {plan.frontends
            .filter((f) => f.componentId !== root)
            .map((f) => (
              <label className="controlled-option" key={f.componentId}>
                <input
                  type="checkbox"
                  disabled={busy || !f.enabled}
                  checked={selected.includes(f.componentId)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...selected, f.componentId]
                        : selected.filter((id) => id !== f.componentId),
                    )
                  }
                />
                {f.name}
                {!f.enabled ? "（未启用）" : ""}
              </label>
            ))}
          {plan.frontends
            .filter(
              (f) => f.componentId === root || selected.includes(f.componentId),
            )
            .flatMap((f) =>
              f.requirements
                .filter((r) => r.state !== "bound")
                .map((r) => (
                  <p className="muted" key={`${f.componentId}:${r.id}`}>
                    {f.name} · {r.id}：尚未连接兼容后端，请在组件连接中选择。
                  </p>
                )),
            )}
          {plan.diagnostics.map((d) => (
            <p role="status" key={d.viewId}>
              {d.viewId}：保存的界面已不可用。保存组合可移除此选择。
            </p>
          ))}
          <div className="workspace-actions">
            <button
              className="sm"
              disabled={busy || !root}
              onClick={() => void run()}
            >
              保存组合
            </button>
            <button
              className="sm"
              disabled={busy || !root}
              onClick={() =>
                void window.manager
                  .call("openAgent", {
                    instanceId: record.instanceId,
                    componentId: root,
                  })
                  .catch(() => setError("界面未能打开，请检查组件状态。"))
              }
            >
              打开所选主界面
            </button>
          </div>
        </>
      )}
    </section>
  );
}
