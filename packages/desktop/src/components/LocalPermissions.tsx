import { useEffect, useState } from "react";
import type { AgentTierCeiling, EnginePermission } from "@plums/core";
import type {
  TierPlan,
  TierSelection,
  AgentRecord,
  ProjectBoundaryReport,
} from "@plums/host";
import type { Resource } from "../shared/types.js";
import { useAction } from "../hooks/useAction.js";
import { PermissionList } from "./PermissionList.js";
import { ProjectSupport, type CacheStatus } from "./ProjectSupport.js";

const tiers = { sandbox: "沙箱", project: "项目", machine: "整机" };
const levels = { sandbox: 0, project: 1, machine: 2 };
const states = {
  stopped: "已停止",
  starting: "启动中",
  running: "运行中",
  stopping: "停止中",
  crashed: "已崩溃",
};

export function LocalPermissions({
  record,
  resources,
}: {
  record: AgentRecord;
  resources: Resource[];
}) {
  const [plan, setPlan] = useState<TierPlan>(),
    [selection, setSelection] = useState<TierSelection>(),
    [review, setReview] = useState<TierPlan>(),
    [cache, setCache] = useState<CacheStatus[]>([]),
    [error, setError] = useState(""),
    [boundary, setBoundary] = useState<ProjectBoundaryReport>();
  const action = useAction(record.instanceId);
  useEffect(() => {
    let current = true;
    setBoundary(undefined);
    window.manager
      .call("tierPlan", { instanceId: record.instanceId })
      .then((p) => {
        if (!current) return;
        const next = p as TierPlan;
        if (!next?.current || !next.selection || !Array.isArray(next.entries))
          throw Error("权限回复无效");
        setPlan(next);
        setSelection((old) => old ?? next.selection);
        setReview(undefined);
        setError("");
      })
      .catch(() => {
        if (current) setError("权限状态未能读取，请重新读取。");
      });
    window.manager
      .call("cacheStatus", { instanceId: record.instanceId })
      .then((value) => {
        if (current && Array.isArray(value)) setCache(value as CacheStatus[]);
      })
      .catch(() => {
        if (current) setError("缓存状态未能读取，请重新读取。");
      });
    return () => {
      current = false;
    };
  }, [record.instanceId, resources]);
  const run = (method: string, args: Record<string, unknown> = {}) =>
    action.run(async () => {
      await window.manager.call(method, {
        instanceId: record.instanceId,
        ...args,
      });
      const next = (await window.manager.call("tierPlan", {
        instanceId: record.instanceId,
      })) as TierPlan;
      setPlan(next);
      setSelection(next.selection);
      setReview(undefined);
      setCache(
        (await window.manager.call("cacheStatus", {
          instanceId: record.instanceId,
        })) as CacheStatus[],
      );
    });
  const change = (value: Partial<TierSelection>) => {
    setSelection((old) => (old ? { ...old, ...value } : old));
    setReview(undefined);
  };
  const toggle = (values: string[], value: string, checked: boolean) =>
    checked ? [...values, value] : values.filter((v) => v !== value);
  const bound = Object.keys(record.roots ?? {}).filter(
    (root) => root !== "agent-data",
  );
  const engineDeclarations = resources.flatMap((p) =>
    p.manifest.formatVersion.startsWith("2.")
      ? p.manifest.permissions
          .filter(
            (permission): permission is EnginePermission =>
              permission.kind === "engine",
          )
          .map((permission) => ({ p, permission }))
      : [],
  );
  return (
    <section
      className="panel local-permissions"
      role="region"
      aria-label="Agent 权限"
    >
      <div className="local-permissions-heading">
        <div>
          <h2>Agent 权限</h2>
          <p>
            上限只限制能力。每个组件按自己的声明取得授权，确认只对当前组装与范围有效。
          </p>
        </div>
        <button
          disabled={action.pending || !plan?.current.grants.length}
          onClick={() => void run("revokeLocal")}
        >
          撤销全部本地执行
        </button>
      </div>
      <p role="status">
        {plan
          ? `当前上限：${tiers[plan.current.tier.ceiling]} · ${plan.current.grants.length} 个本地执行项`
          : "正在读取权限…"}
      </p>
      {plan?.current.migration && (
        <p className="notice">
          旧授权迁移：保留 {plan.current.migration.migrated} 项、忽略{" "}
          {plan.current.migration.skipped}{" "}
          项，仅对应组件自己的本地执行；未扩大资源或目录权限。
        </p>
      )}
      {plan &&
        [
          ...plan.current.tier.projects.map((d) => ({ ...d, readOnly: false })),
          ...plan.current.tier.readOnly.map((d) => ({ ...d, readOnly: true })),
        ].map((d) => (
          <div className="root-row" key={`${d.readOnly}:${d.root}`}>
            <div>
              <strong>
                {d.readOnly ? "额外只读目录" : "已确认项目"} · {d.root}
              </strong>
              <code>{d.path}</code>
            </div>
            <button
              disabled={action.pending}
              onClick={() =>
                void run("removeTierDirectory", {
                  root: d.root,
                  readOnly: d.readOnly,
                })
              }
            >
              移除目录
            </button>
          </div>
        ))}
      {(error || action.error) && (
        <p role="alert" className="notice error">
          {error || action.error}
        </p>
      )}
      {error && (
        <button onClick={() => void run("tierStatus")}>重新读取权限</button>
      )}
      {plan && selection && (
        <>
          <fieldset disabled={action.pending}>
            <legend>当前组装与范围</legend>
            <label className="field">
              档位上限
              <select
                aria-label="档位上限"
                value={selection.ceiling}
                onChange={(e) => {
                  const ceiling = e.target.value as AgentTierCeiling;
                  change({
                    ceiling,
                    ...(ceiling === "sandbox"
                      ? { projects: [], readOnly: [] }
                      : {}),
                  });
                }}
              >
                {Object.entries(tiers).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">
              提高上限需要可信窗口确认；仅提高上限不能使未确认组件执行。
            </p>
            <div className="inline-actions">
              {(["sandbox", "project"] as const)
                .filter((t) => levels[t] < levels[plan.current.tier.ceiling])
                .map((t) => (
                  <button
                    key={t}
                    onClick={() => void run("lowerTier", { ceiling: t })}
                  >
                    降低到{tiers[t]}
                  </button>
                ))}
            </div>
            {selection.ceiling !== "sandbox" && (
              <div className="local-directory-options">
                <div>
                  <h3>项目目录</h3>
                  <p>只选择已经绑定的目录。绑定或更换在下方工作目录中操作。</p>
                  {bound.map((root) => (
                    <label className="controlled-option" key={root}>
                      <input
                        type="checkbox"
                        checked={selection.projects.includes(root)}
                        onChange={(e) =>
                          change({
                            projects: toggle(
                              selection.projects,
                              root,
                              e.target.checked,
                            ),
                            readOnly: selection.readOnly.filter(
                              (r) => r !== root,
                            ),
                          })
                        }
                      />
                      <span>
                        {root}
                        <small>{record.roots?.[root]}</small>
                      </span>
                    </label>
                  ))}
                  {!bound.length && <p>尚未绑定项目目录。</p>}
                </div>
                <div>
                  <h3>额外只读目录</h3>
                  {bound.map((root) => (
                    <label className="controlled-option" key={root}>
                      <input
                        type="checkbox"
                        checked={selection.readOnly.includes(root)}
                        onChange={(e) =>
                          change({
                            readOnly: toggle(
                              selection.readOnly,
                              root,
                              e.target.checked,
                            ),
                            projects: selection.projects.filter(
                              (r) => r !== root,
                            ),
                          })
                        }
                      />
                      <span>{root}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="local-component-options">
              {plan.entries.map((entry) => (
                <details
                  className="local-permission-entry"
                  key={entry.packageId}
                >
                  <summary>
                    <label onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selection.components.includes(entry.packageId)}
                        onChange={(e) =>
                          change({
                            components: toggle(
                              selection.components,
                              entry.packageId,
                              e.target.checked,
                            ),
                          })
                        }
                      />
                      {entry.name}
                    </label>
                    <span>
                      {entry.confirmed ? "已核对声明" : "待确认"}
                      {entry.engines.some((e) => e.state !== "confirmed")
                        ? " · 本地执行待确认"
                        : ""}
                    </span>
                  </summary>
                  <PermissionList
                    permissions={entry.permissions}
                    formatVersion={entry.formatVersion}
                  />
                  {entry.engines.map((engine) => (
                    <p key={engine.engineId}>
                      {engine.engineId} · 声明档位：{tiers[engine.tier]}
                      {levels[engine.tier] > levels[selection.ceiling]
                        ? "（超过所选上限）"
                        : ""}
                    </p>
                  ))}
                </details>
              ))}
            </div>
            {engineDeclarations
              .filter(({ permission }) => permission.network?.hosts.length)
              .map(({ p, permission }) => (
                <fieldset key={p.id + permission.target}>
                  <legend>
                    {p.name} · {permission.target} 的主机候选
                  </legend>
                  {permission.network!.hosts.map((host) => (
                    <label className="controlled-option" key={host}>
                      <input
                        type="checkbox"
                        checked={
                          selection.hosts?.[p.id]?.[
                            permission.target
                          ]?.includes(host) ?? false
                        }
                        onChange={(e) =>
                          change({
                            hosts: {
                              ...selection.hosts,
                              [p.id]: {
                                ...selection.hosts?.[p.id],
                                [permission.target]: toggle(
                                  selection.hosts?.[p.id]?.[
                                    permission.target
                                  ] ?? [],
                                  host,
                                  e.target.checked,
                                ),
                              },
                            },
                          })
                        }
                      />
                      {host}
                    </label>
                  ))}
                </fieldset>
              ))}
            <button
              className="primary"
              disabled={!selection.components.length}
              onClick={() =>
                void action.run(async () => {
                  setReview(
                    (await window.manager.call("tierPlan", {
                      instanceId: record.instanceId,
                      selection,
                    })) as TierPlan,
                  );
                }, false)
              }
            >
              查看汇总
            </button>
          </fieldset>
          {review && (
            <section className="notice local-review" aria-label="待确认汇总">
              <h3>
                待确认：{tiers[review.selection.ceiling]}上限 ·{" "}
                {review.selection.components.length} 个组件
              </h3>
              <p>
                项目目录：{review.selection.projects.join("、") || "无"}
                ；额外只读目录：{review.selection.readOnly.join("、") || "无"}。
              </p>
              {review.entries
                .filter((e) =>
                  review.selection.components.includes(e.packageId),
                )
                .map((entry) => (
                  <div key={entry.packageId}>
                    <strong>{entry.name}</strong>
                    <PermissionList
                      permissions={entry.permissions}
                      formatVersion={entry.formatVersion}
                    />
                  </div>
                ))}
              {review.entries.some(
                (e) =>
                  review.selection.components.includes(e.packageId) &&
                  e.engines.some((g) => g.tier === "machine"),
              ) && (
                <p className="error-text">
                  整机扩展可读取和修改本机所有文件，包括 Plums 自身数据和其他
                  Agent 的密钥，运行任意程序并访问网络。
                </p>
              )}
              <button
                disabled={action.pending}
                onClick={() =>
                  void run("confirmTier", {
                    fingerprint: review.fingerprint,
                    selection: review.selection,
                  })
                }
              >
                在可信窗口确认
              </button>
              <ProjectSupport
                entries={review.entries.filter((e) =>
                  review.selection.components.includes(e.packageId),
                )}
                cache={cache}
              />
            </section>
          )}
        </>
      )}
      <ProjectSupport
        entries={plan?.entries ?? []}
        cache={cache}
        pending={action.pending}
        clear={(packageId) => void run("clearCache", { packageId })}
        boundary={boundary}
        check={() =>
          void action.run(async () => {
            setBoundary(
              (await window.manager.call("projectStatus", {
                instanceId: record.instanceId,
              })) as ProjectBoundaryReport,
            );
          }, false)
        }
        refreshConfiguration={() => void run("refreshProjectConfiguration")}
        credentials={(packageId, engineId, credentialId, value, username) =>
          void run(
            value === undefined ? "revokeCredential" : "provideCredential",
            {
              packageId,
              engineId,
              credentialId,
              ...(value === undefined
                ? {}
                : { value, username, fingerprint: plan?.fingerprint }),
            },
          )
        }
      />
      <section aria-label="本地进程">
        <h3>本地进程</h3>
        <p>关闭业务界面保留进程；停用、变更或撤权只停止受影响组件。</p>
        {resources.flatMap((p) =>
          (p.engines ?? []).map((engine) => {
            const declaration = engineDeclarations.find(
              (v) => v.p.id === p.id && v.permission.target === engine.engineId,
            )?.permission;
            const project = declaration?.tier === "project";
            const confirmed = !!plan?.current.grants.some(
              (g) => g.packageId === p.id && g.engineId === engine.engineId,
            );
            return (
              <LocalProcess
                key={p.id + engine.engineId}
                resource={p}
                engine={engine}
                confirmed={confirmed}
                unavailable={project && !boundary?.ready}
                run={run}
              />
            );
          }),
        )}
        {!resources.some((p) => p.engines?.length) && (
          <p>当前组装没有声明本地执行的组件。</p>
        )}
      </section>
    </section>
  );
}
function LocalProcess({
  resource,
  engine,
  confirmed,
  unavailable,
  run,
}: {
  resource: Resource;
  engine: NonNullable<Resource["engines"]>[number];
  confirmed: boolean;
  unavailable: boolean;
  run: (method: string, args: Record<string, unknown>) => Promise<boolean>;
}) {
  const action = useAction(resource.id + engine.engineId);
  const args = { packageId: resource.id, engineId: engine.engineId };
  return (
    <div
      className="local-process"
      data-testid={`local-entry-${resource.id}-${engine.engineId}`}
    >
      <strong>
        {resource.name} ·{" "}
        {resource.desktop?.engines?.find((e) => e.id === engine.engineId)
          ?.title ?? engine.engineId}
      </strong>
      <p role="status">
        {states[engine.state]} · {confirmed ? "已确认本地执行" : "待确认"}
        {unavailable ? " · 项目档位不可用" : ""}
      </p>
      <div className="inline-actions">
        <button
          disabled={
            action.pending ||
            !confirmed ||
            unavailable ||
            !resource.enabled ||
            ["running", "starting", "stopping"].includes(engine.state)
          }
          onClick={() => void action.run(() => run("startEngine", args), false)}
        >
          启动进程
        </button>
        <button
          disabled={action.pending || engine.state === "stopped"}
          onClick={() => void action.run(() => run("stopEngine", args), false)}
        >
          停止进程
        </button>
        <button
          disabled={action.pending || !confirmed}
          aria-label={`撤销 ${resource.name} 的本地执行`}
          onClick={() =>
            void action.run(
              () => run("revokeLocal", { packageId: resource.id }),
              false,
            )
          }
        >
          撤销本地执行
        </button>
      </div>
      {action.error && <p role="alert">{action.error}</p>}
    </div>
  );
}
