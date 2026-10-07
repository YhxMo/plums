import { useEffect, useState } from "react";
import type { DesktopHost, AgentRecord } from "@plums/host";
import type { Resource } from "../shared/types.js";
const desktopContribution = (manifest: Resource["manifest"]) =>
  (manifest.payload as { plumsDesktop?: { common?: { background?: boolean } } })
    ?.plumsDesktop;
type Tasks = Awaited<ReturnType<DesktopHost["commonTasks"]>>;
const stateName: Record<string, string> = {
  starting: "准备中",
  running: "运行中",
  cancelling: "正在停止",
  stopped: "已停止",
  crashed: "已中断",
  completed: "已完成",
};
const resultName: Record<string, string> = {
  not_started: "尚未执行",
  unknown: "执行结果未知，请核实后再操作",
  completed: "已执行，请勿自动重试",
};
export function ControlledTasks({
  record,
  resources,
}: {
  record: AgentRecord;
  resources: Resource[];
}) {
  const [tasks, setTasks] = useState<Tasks>(),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [target, setTarget] = useState(""),
    [reads, setReads] = useState<string[]>([]),
    [writes, setWrites] = useState<string[]>([]),
    [takeover, setTakeover] = useState<Record<string, string>>({});
  const [chosenBackground, setChosenBackground] = useState(
    record.backgroundComponents ?? [],
  );
  useEffect(
    () => setChosenBackground(record.backgroundComponents ?? []),
    [record.instanceId, record.backgroundComponents],
  );
  const backgrounds = resources.filter(
    (r) => desktopContribution(r.manifest)?.common?.background,
  );
  const programs = [
    ...new Set(
      resources.flatMap((r) =>
        r.manifest.permissions.flatMap((p) =>
          "kind" in p && p.kind === "exec" ? [p.target] : [],
        ),
      ),
    ),
  ];
  useEffect(() => {
    if (
      !resources.some((r) => desktopContribution(r.manifest)?.common) &&
      !programs.length &&
      !record.backgroundComponents?.length &&
      !Object.keys(record.controlledPrograms ?? {}).length
    ) {
      setTasks([]);
      return;
    }
    let active = true;
    const refresh = () =>
      window.manager
        .call("commonTasks", { instanceId: record.instanceId })
        .then((t) => {
          if (active) {
            setTasks(t as Tasks);
            setError("");
          }
        })
        .catch(() => {
          if (active) setError("任务状态未能读取，请重试。");
        });
    void refresh();
    const timer = setInterval(() => void refresh(), 1000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [record.instanceId, resources]);
  const run = async (method: string, extra: Record<string, unknown>) => {
    setBusy(true);
    setError("");
    try {
      await window.manager.call(method, {
        instanceId: record.instanceId,
        ...extra,
      });
      setTasks(
        (await window.manager.call("commonTasks", {
          instanceId: record.instanceId,
        })) as Tasks,
      );
      return true;
    } catch {
      setError("操作未完成。请刷新当前状态后重试。");
      return false;
    } finally {
      setBusy(false);
    }
  };
  if (!backgrounds.length && !programs.length && !tasks?.length && !error)
    return null;
  return (
    <section
      className="section controlled-tasks"
      data-testid="controlled-tasks"
    >
      <h3>后台与受控任务</h3>
      <p className="muted">
        后台开关决定界面关闭后是否继续运行。每次操作仍需有效权限，停止后不会自动重试。
      </p>
      {error && <p role="alert">{error}</p>}
      {backgrounds.map((r) => (
        <label className="controlled-option" key={r.id}>
          <input
            type="checkbox"
            disabled={busy}
            checked={chosenBackground.includes(r.id)}
            onChange={(e) => {
              const enabled = e.target.checked,
                old = chosenBackground;
              setChosenBackground(
                enabled ? [...old, r.id] : old.filter((id) => id !== r.id),
              );
              void run("setComponentBackground", {
                packageId: r.id,
                enabled,
              }).then((ok) => {
                if (!ok) setChosenBackground(old);
              });
            }}
          />
          {r.name}：允许声明的 Agent 后台任务
        </label>
      ))}
      {tasks === undefined && !error ? (
        <p className="muted">正在读取任务状态…</p>
      ) : tasks?.length ? (
        <ul className="controlled-task-list">
          {tasks.map((t) => (
            <li key={t.description.taskId}>
              <div>
                <strong>
                  {resources.find(
                    (r) => r.id === t.description.owner.componentId,
                  )?.name ?? t.description.owner.componentId}
                </strong>
                <span>
                  {stateName[t.snapshot.status.state]} ·{" "}
                  {t.description.lifetime === "agent"
                    ? "Agent 后台"
                    : "随界面运行"}
                </span>
                <small>{resultName[t.snapshot.status.executionState]}</small>
                <label>
                  接管界面组件
                  <select
                    value={takeover[t.description.taskId] ?? ""}
                    onChange={(e) =>
                      setTakeover({
                        ...takeover,
                        [t.description.taskId]: e.target.value,
                      })
                    }
                  >
                    <option value="">选择兼容组件</option>
                    {t.takeoverCandidates.map((r) => (
                      <option key={r.componentId} value={r.componentId}>
                        {r.name}
                        {r.allowed ? "（已允许）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <button
                    className="sm"
                    disabled={busy || !takeover[t.description.taskId]}
                    onClick={() =>
                      void run("permitTaskTakeover", {
                        taskId: t.description.taskId,
                        packageId: takeover[t.description.taskId],
                        enabled: true,
                      })
                    }
                  >
                    允许接管
                  </button>
                  <button
                    className="sm"
                    disabled={busy || !takeover[t.description.taskId]}
                    onClick={() =>
                      void run("permitTaskTakeover", {
                        taskId: t.description.taskId,
                        packageId: takeover[t.description.taskId],
                        enabled: false,
                      })
                    }
                  >
                    撤销接管
                  </button>
                </div>
              </div>
              {["starting", "running", "cancelling"].includes(
                t.snapshot.status.state,
              ) && (
                <button
                  className="sm"
                  disabled={busy || t.snapshot.status.state === "cancelling"}
                  onClick={() =>
                    void run("stopCommonTask", { taskId: t.description.taskId })
                  }
                >
                  停止任务
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">当前没有受控任务。</p>
      )}
      {!!programs.length && (
        <details>
          <summary>受控命令程序与目录</summary>
          <p className="muted">
            只允许固定程序在明确选择的目录内执行。无直接网络或自行启动子程序；每次命令仍需有效策略或可信确认。
          </p>
          <label>
            命令名称
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">选择命令</option>
              {programs.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          {Object.keys(record.roots)
            .filter((r) => r !== "agent-data")
            .map((root) => (
              <fieldset key={root}>
                <legend>{root}</legend>
                {(
                  [
                    ["读取", reads, setReads],
                    ["写入", writes, setWrites],
                  ] as const
                ).map(([label, value, set]) => (
                  <label key={label}>
                    <input
                      type="checkbox"
                      checked={value.includes(root)}
                      onChange={(e) =>
                        set(
                          e.target.checked
                            ? [...value, root]
                            : value.filter((v) => v !== root),
                        )
                      }
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
            ))}
          <button
            className="sm"
            disabled={busy || !target}
            onClick={() =>
              void run("bindControlledProgram", { target, reads, writes })
            }
          >
            选择程序并保存目录
          </button>
        </details>
      )}
    </section>
  );
}
