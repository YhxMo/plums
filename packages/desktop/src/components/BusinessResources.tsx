import { useEffect, useRef, useState } from "react";
import type { DesktopHost, ResourceRangeSelection } from "@plumsjs/host";
import type { ResourceOperation } from "@plumsjs/sdk";
import { useAction } from "../hooks/useAction.js";
type Plan = Awaited<ReturnType<DesktopHost["resourcePlan"]>>;
const ops: ResourceOperation[] = ["read", "write", "delete"];
const label: Record<ResourceOperation, string> = {
  read: "读取",
  write: "写入",
  delete: "删除",
};
function Operations({
  value,
  onChange,
  disabled = false,
  name,
}: {
  value: readonly ResourceOperation[];
  onChange: (ops: ResourceOperation[]) => void;
  disabled?: boolean;
  name: string;
}) {
  return (
    <fieldset className="resource-operations" disabled={disabled}>
      <legend>{name}</legend>
      {ops.map((op) => (
        <label key={op}>
          <input
            type="checkbox"
            checked={value.includes(op)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, op]
                  : value.filter((v) => v !== op),
              )
            }
          />
          {label[op]}
        </label>
      ))}
    </fieldset>
  );
}
export function BusinessResources({
  instanceId,
  revision,
}: {
  instanceId: string;
  revision: unknown;
}) {
  const [plan, setPlan] = useState<Plan>(),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [spaceId, setSpaceId] = useState(""),
    [name, setName] = useState(""),
    [mode, setMode] = useState<"task" | "full-access">("task"),
    [duration, setDuration] = useState(900_000),
    [selection, setSelection] = useState<ResourceRangeSelection[]>([]);
  const action = useAction(instanceId);
  const planGeneration = useRef(0);
  const identity = useRef({ instanceId, active: true });
  if (identity.current.instanceId !== instanceId)
    identity.current = { instanceId, active: true };
  useEffect(() => {
    let current = true;
    const owner = identity.current,
      generation = ++planGeneration.current;
    owner.active = true;
    setPlan(undefined);
    setError("");
    setSelection([]);
    window.manager
      .call("resourcePlan", { instanceId })
      .then((p) => {
        if (
          current &&
          owner === identity.current &&
          generation === planGeneration.current
        ) {
          const plan = p as Plan;
          setPlan(plan);
          setSpaceId((old) =>
            plan.spaces.some((s) => s.id === old)
              ? old
              : (plan.spaces.find((s) => s.ownerAgentId === instanceId)?.id ??
                ""),
          );
        }
      })
      .catch(() => {
        if (
          current &&
          owner === identity.current &&
          generation === planGeneration.current
        )
          setError("资源状态未能读取，请重试。");
      });
    return () => {
      current = false;
      owner.active = false;
    };
  }, [instanceId, revision, reload]);
  useEffect(() => {
    const active = plan?.active;
    if (!active) return;
    let current = true;
    // The host's monotonic lease is authoritative; wall time only schedules a refresh.
    const refresh = async () => {
      try {
        const next = (await window.manager.call("resourcePlan", {
          instanceId,
        })) as Plan;
        if (current && next.active?.id !== active.id) setReload((n) => n + 1);
      } catch {
        /* Keep the displayed expiry and retry on the next status poll. */
      }
    };
    const expires = setTimeout(
      () => void refresh(),
      Math.max(1, Date.parse(active.expiresAt) - Date.now()),
    );
    const poll = setInterval(() => void refresh(), 30_000);
    return () => {
      current = false;
      clearTimeout(expires);
      clearInterval(poll);
    };
  }, [instanceId, plan?.active?.id, plan?.active?.expiresAt]);
  const call = (method: string, args: Record<string, unknown> = {}) => {
    const owner = identity.current;
    void action.run(async () => {
      let failed = false,
        failure: unknown;
      try {
        await window.manager.call(method, {
          instanceId,
          fingerprint: plan?.fingerprint,
          ...args,
        });
      } catch (error) {
        failed = true;
        failure = error;
      }
      if (owner.active && owner === identity.current) {
        const generation = ++planGeneration.current;
        try {
          const next = (await window.manager.call("resourcePlan", {
            instanceId,
          })) as Plan;
          if (
            owner.active &&
            owner === identity.current &&
            generation === planGeneration.current
          ) {
            setPlan(next);
            setSelection([]);
            setError("");
            setSpaceId((old) =>
              next.spaces.some((s) => s.id === old)
                ? old
                : (next.spaces.find((s) => s.ownerAgentId === instanceId)?.id ??
                  ""),
            );
          }
        } catch {
          if (
            owner.active &&
            owner === identity.current &&
            generation === planGeneration.current
          ) {
            setPlan(undefined);
            setError("资源状态未能读取，请重试。");
          }
        }
      }
      if (failed) throw failure;
    }, false);
  };
  const qualify = (componentId: string, operations: ResourceOperation[]) => {
    setPlan(
      (p) =>
        p && {
          ...p,
          qualifications: [
            ...p.qualifications.filter(
              (q) => q.resourceId !== spaceId || q.componentId !== componentId,
            ),
            {
              agentId: instanceId,
              resourceId: spaceId,
              componentId,
              operations,
            },
          ],
        },
    );
    call("setResourceQualification", {
      resourceId: spaceId,
      componentId,
      operations,
    });
  };
  if (!plan && !error)
    return (
      <section className="panel" aria-label="业务资源">
        <h2>业务资源</h2>
        <p role="status">正在读取资源…</p>
      </section>
    );
  if (!plan)
    return (
      <section className="panel" aria-label="业务资源">
        <h2>业务资源</h2>
        <p role="alert">{error}</p>
        <button onClick={() => setReload((n) => n + 1)}>重新读取资源</button>
      </section>
    );
  const space = plan.spaces.find((s) => s.id === spaceId),
    components = Array.from(
      new Map(
        plan.requirements.map((r) => [r.componentId, r.componentName]),
      ).entries(),
    ),
    foreign = space?.scope === "agent" && space.ownerAgentId !== instanceId;
  return (
    <section className="panel business-resources" aria-label="业务资源">
      <h2>业务资源</h2>
      <p>
        独立资源归各 Agent 所有。共用组可供多个 Agent
        使用；先选择资格和组件绑定，再选择执行范围。内容由组件管理。
      </p>
      <div className="resource-create">
        <label className="field">
          共用组名称
          <input
            value={name}
            maxLength={128}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如：项目资料"
          />
        </label>
        <button
          disabled={action.pending || !name.trim()}
          onClick={() => call("createResourceGroup", { name })}
        >
          创建共用组
        </button>
      </div>
      <label className="field">
        管理资源
        <select
          aria-label="管理资源"
          value={spaceId}
          disabled={action.pending}
          onChange={(e) => setSpaceId(e.target.value)}
        >
          {plan.spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ·{" "}
              {s.scope === "shared"
                ? "共用"
                : s.ownerAgentId === instanceId
                  ? "本 Agent 独立"
                  : "其他 Agent 独立"}
            </option>
          ))}
        </select>
      </label>
      {space && (
        <div className="resource-qualifications">
          <p className="muted">内容契约：{space.contentContract}</p>
          {foreign ? (
            <p role="status">
              此资源属于其他
              Agent。只有在下方明确选择“完全访问”及有限期范围后才可访问，归属保持。
            </p>
          ) : (
            <>
              <Operations
                name="本 Agent 的资格"
                value={
                  plan.qualifications.find(
                    (q) => q.resourceId === spaceId && !q.componentId,
                  )?.operations ?? []
                }
                disabled={action.pending}
                onChange={(operations) => qualify("", operations)}
              />
              {components.map(([id, title]) => (
                <Operations
                  key={id}
                  name={`${title} 的资格`}
                  value={
                    plan.qualifications.find(
                      (q) => q.resourceId === spaceId && q.componentId === id,
                    )?.operations ?? []
                  }
                  disabled={action.pending}
                  onChange={(operations) => qualify(id, operations)}
                />
              ))}
            </>
          )}
          {space.scope === "shared" && (
            <button
              className="danger"
              disabled={
                action.pending ||
                plan.bindings.some((b) => b.resourceId === space.id)
              }
              onClick={() =>
                call("removeResourceGroup", { resourceId: space.id })
              }
            >
              移除未引用共用组
            </button>
          )}
        </div>
      )}
      <h3>组件资源绑定</h3>
      {!plan.requirements.length ? (
        <p>当前组件没有声明业务资源需求。导入兼容组件后可在此绑定。</p>
      ) : (
        plan.requirements.map((r) => {
          const b = plan.bindings.find(
            (b) => b.componentId === r.componentId && b.requirementId === r.id,
          );
          return (
            <label className="field" key={`${r.componentId}:${r.id}`}>
              {r.componentName} · {r.id}
              <small>
                声明需要：{r.operations.map((o) => label[o]).join("、")}；
                {!r.enabled ? "组件尚未启用" : "已启用"}
                {b && b.installation !== r.installation
                  ? "；组件已变化，请重新绑定"
                  : ""}
              </small>
              <select
                aria-label={`${r.componentName} 的资源 ${r.id}`}
                disabled={action.pending}
                value={b?.resourceId ?? ""}
                onChange={(e) =>
                  call("setResourceBinding", {
                    componentId: r.componentId,
                    requirementId: r.id,
                    resourceId: e.target.value || undefined,
                  })
                }
              >
                <option value="">暂不绑定</option>
                {plan.spaces
                  .filter(
                    (s) => r.target === "business" || r.target === s.scope,
                  )
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ·{" "}
                      {s.scope === "shared"
                        ? "共用"
                        : s.ownerAgentId === instanceId
                          ? "本 Agent 独立"
                          : "其他 Agent 独立（需完全访问）"}
                    </option>
                  ))}
              </select>
            </label>
          );
        })
      )}
      <h3>有限期执行范围</h3>
      <p>
        范围内只放行选中的操作。普通范围取
        Agent、组件、声明和调用链的交集；完全访问可替代业务资源资格，仍受声明和期限约束。密钥、设置与管理授权不在业务资源内。
      </p>
      <div className="inline-actions">
        <label>
          访问模式
          <select
            aria-label="资源访问模式"
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as typeof mode);
              setSelection([]);
            }}
          >
            <option value="task">普通范围</option>
            <option value="full-access">完全访问业务资源</option>
          </select>
        </label>
        <label>
          有效期
          <select
            aria-label="资源范围有效期"
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
          >
            <option value={900_000}>15 分钟</option>
            <option value={3_600_000}>1 小时</option>
          </select>
        </label>
      </div>
      {Array.from(
        new Map(
          plan.bindings.map((b) => [`${b.componentId}:${b.resourceId}`, b]),
        ).values(),
      ).map((b) => {
        const r = plan.requirements.filter(
          (r) =>
            r.componentId === b.componentId &&
            plan.bindings.some(
              (v) =>
                v.componentId === b.componentId &&
                v.requirementId === r.id &&
                v.resourceId === b.resourceId,
            ),
        );
        const declared = ops.filter((op) =>
          r.some((r) => r.operations.includes(op)),
        );
        const qualification = (componentId: string) =>
          plan.qualifications.find(
            (q) =>
              q.componentId === componentId && q.resourceId === b.resourceId,
          )?.operations ?? [];
        const s = plan.spaces.find((s) => s.id === b.resourceId);
        return (
          <fieldset
            className="resource-operations"
            key={`${b.componentId}:${b.resourceId}`}
            disabled={
              action.pending ||
              !r.every((v) => v.enabled && v.installation === b.installation)
            }
          >
            <legend>
              {r[0]?.componentName} → {s?.name}
            </legend>
            {ops.map((op) => {
              const available =
                declared.includes(op) &&
                (mode === "full-access" ||
                  ((s?.scope === "shared" || s?.ownerAgentId === instanceId) &&
                    qualification("").includes(op) &&
                    qualification(b.componentId).includes(op)));
              const selected = selection.find(
                (v) =>
                  v.componentId === b.componentId &&
                  v.resourceId === b.resourceId,
              );
              return (
                <label key={op}>
                  <input
                    type="checkbox"
                    disabled={!available}
                    checked={selected?.operations.includes(op) ?? false}
                    onChange={(e) =>
                      setSelection((old) => {
                        const operations = e.target.checked
                          ? [...(selected?.operations ?? []), op]
                          : selected!.operations.filter((v) => v !== op);
                        return [
                          ...old.filter(
                            (v) =>
                              v.componentId !== b.componentId ||
                              v.resourceId !== b.resourceId,
                          ),
                          ...(operations.length
                            ? [
                                {
                                  componentId: b.componentId,
                                  resourceId: b.resourceId,
                                  operations,
                                },
                              ]
                            : []),
                        ];
                      })
                    }
                  />
                  {label[op]}
                  {!available ? "（无资格或未声明）" : ""}
                </label>
              );
            })}
          </fieldset>
        );
      })}
      <div className="inline-actions">
        <button
          className="cta"
          disabled={action.pending || !selection.length}
          onClick={() =>
            call("grantResourceRange", {
              mode,
              durationMs: duration,
              selection,
            })
          }
        >
          {mode === "full-access"
            ? "授予完全访问所选业务资源"
            : "授予所选普通范围"}
        </button>
        <button
          disabled={action.pending || !plan.active}
          onClick={() => call("revokeResourceRange")}
        >
          停止并撤销资源范围
        </button>
      </div>
      {plan.active ? (
        <div role="status" className="notice">
          <strong>
            {plan.active.mode === "full-access"
              ? "完全访问业务资源"
              : "普通范围"}
            已生效
          </strong>
          <p>
            有效至 {new Date(plan.active.expiresAt).toLocaleString()}
            。重启、组件或绑定变化后需要重新选择。
          </p>
          {plan.active.selection.map((v) => (
            <p key={`${v.componentId}:${v.resourceId}`}>
              {components.find((c) => c[0] === v.componentId)?.[1]} →{" "}
              {plan.spaces.find((s) => s.id === v.resourceId)?.name}：
              {v.operations.map((o) => label[o]).join("、")}
            </p>
          ))}
        </div>
      ) : (
        <p role="status">没有有效执行范围；具备普通资格的单次访问仍需确认。</p>
      )}
      {action.error && (
        <p role="alert" className="error-text">
          {action.error}
        </p>
      )}
    </section>
  );
}
