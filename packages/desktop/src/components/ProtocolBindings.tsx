import { useEffect, useId, useState } from "react";
import type { ProtocolRequirementState } from "@plumsjs/host";
import type { ProtocolBindingIntent } from "@plumsjs/sdk";
import { useAction } from "../hooks/useAction.js";

const statusText = {
  bound: "已连接",
  disabled: "已选择，启用后可用",
  stale: "组件已变化，请重新选择",
  missing: "没有兼容组件，请先导入并加入 Agent",
  choose: "有多个兼容组件，请选择",
  unbound: "请选择提供组件",
};
export function ProtocolChoices({
  requirements,
  choices,
  onChoose,
  busy = false,
  automatic = false,
}: {
  requirements: ProtocolRequirementState[];
  choices: ProtocolBindingIntent[];
  onChoose: (
    state: ProtocolRequirementState,
    choice?: ProtocolBindingIntent,
  ) => void;
  busy?: boolean;
  automatic?: boolean;
}) {
  const id = useId();
  return (
    <div className="protocol-choices">
      {requirements.map((state) => {
        const selected = choices.find(
          (b) =>
            b.consumerId === state.consumerId &&
            b.requirementId === state.requirement.id,
        );
        const key = (b: ProtocolBindingIntent) =>
          JSON.stringify([b.providerId, b.providerDigest, b.provideId]);
        const valid =
          selected &&
          state.state !== "stale" &&
          state.candidates.some(
            (c) =>
              c.compatibility.compatible && key(c.intent) === key(selected),
          );
        const provider = state.candidates.find((c) =>
          selected
            ? key(c.intent) === key(selected)
            : c.compatibility.compatible,
        );
        const selectId = `${id}-${state.consumerId}-${state.requirement.id}`;
        return (
          <div
            className="protocol-choice"
            key={`${state.consumerId}:${state.requirement.id}`}
            data-consumer-id={state.consumerId}
            data-requirement-id={state.requirement.id}
          >
            <label className="field">
              <strong>
                {state.consumerName} · {state.requirement.id}
                {state.requirement.optional ? "（可选）" : "（必需）"}
              </strong>
              <small>
                {state.requirement.protocol} · {state.requirement.range}
                {state.requirement.features?.length
                  ? ` · 需要 ${state.requirement.features.join("、")}`
                  : ""}
              </small>
              <select
                id={selectId}
                aria-label={`${state.consumerName} 的 ${state.requirement.id}`}
                disabled={busy}
                value={valid ? key(selected!) : ""}
                onChange={(e) =>
                  onChoose(
                    state,
                    state.candidates.find(
                      (c) => key(c.intent) === e.target.value,
                    )?.intent,
                  )
                }
              >
                <option value="">
                  {state.requirement.optional ? "暂不连接" : "请选择组件"}
                </option>
                {state.candidates.map((c) => (
                  <option
                    key={key(c.intent)}
                    value={key(c.intent)}
                    disabled={!c.compatibility.compatible}
                  >
                    {c.name} · 协议 {c.intent.protocolVersion} ·{" "}
                    {c.intent.provideId}
                    {!c.compatibility.compatible
                      ? c.compatibility.reason === "VERSION_MISMATCH"
                        ? "（版本不兼容）"
                        : c.compatibility.reason === "FEATURES_MISSING"
                          ? `（缺少 ${c.compatibility.missingFeatures.join("、")}）`
                          : "（协议不同）"
                      : !c.enabled
                        ? "（待启用）"
                        : ""}
                  </option>
                ))}
              </select>
            </label>
            <p role="status">
              {valid && state.autoBound
                ? `已自动连接 ${state.consumerName} 的 ${state.requirement.id} → ${provider!.name}`
                : automatic && state.state === "unbound" && !selected
                  ? `创建后将自动连接 ${state.consumerName} 的 ${state.requirement.id} → ${provider!.name}`
                  : state.requirement.optional && !selected
                    ? "未连接；此可选功能暂不可用"
                    : valid && !state.selected
                      ? "已选择，创建后启用"
                      : statusText[state.state]}
            </p>
            {state.selected && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`${state.consumerName} 更换 ${state.requirement.id} 的提供组件`}
                  onClick={() => document.getElementById(selectId)?.focus()}
                >
                  更换
                </button>
                <small>
                  更换组件不会自动转移记忆或历史，请先确认数据处理方式。
                </small>
              </>
            )}
            {state.candidates
              .filter((c) => !c.compatibility.compatible)
              .map((c) => (
                <small className="protocol-conflict" key={key(c.intent)}>
                  {c.name}：
                  {!c.compatibility.compatible &&
                  c.compatibility.reason === "FEATURES_MISSING"
                    ? `缺少功能 ${c.compatibility.missingFeatures.join("、")}`
                    : "协议版本不兼容"}
                </small>
              ))}
          </div>
        );
      })}
    </div>
  );
}
export function ProtocolBindings({
  instanceId,
  revision,
}: {
  instanceId: string;
  revision: unknown;
}) {
  const [plan, setPlan] = useState<{
      fingerprint: string;
      requirements: ProtocolRequirementState[];
    }>(),
    [loadError, setLoadError] = useState(""),
    [reload, setReload] = useState(0);
  const action = useAction(instanceId);
  useEffect(() => {
    let current = true;
    setPlan(undefined);
    setLoadError("");
    window.manager
      .call("protocolPlan", { instanceId })
      .then((p) => {
        if (current) setPlan(p as typeof plan);
      })
      .catch(() => {
        if (current) setLoadError("组件连接未能读取，请重试。");
      });
    return () => {
      current = false;
    };
  }, [instanceId, revision, reload]);
  if (!plan && !loadError)
    return (
      <section className="panel" aria-label="组件连接">
        <h2>组件连接</h2>
        <p role="status">正在读取组件连接…</p>
      </section>
    );
  if (plan && !plan.requirements.length) return null;
  return (
    <section className="panel" aria-label="组件连接">
      <h2>组件连接</h2>
      <p>
        唯一兼容组件会自动连接；有多个候选时请选择。更换或升级后需要重新核对，连接不代替权限同意。
      </p>
      {loadError ? (
        <p role="alert">{loadError}</p>
      ) : (
        plan && (
          <ProtocolChoices
            requirements={plan.requirements}
            choices={plan.requirements.flatMap((s) =>
              s.selected ? [s.selected] : [],
            )}
            busy={action.pending}
            onChoose={(s, choice) => {
              void action
                .run(() =>
                  window.manager.call("setProtocolBinding", {
                    instanceId,
                    fingerprint: plan.fingerprint,
                    consumerId: s.consumerId,
                    requirementId: s.requirement.id,
                    choice,
                  }),
                )
                .then((ok) => {
                  if (ok) setReload((n) => n + 1);
                });
            }}
          />
        )
      )}
      {(loadError || action.error) && (
        <>
          <p role="alert" className="error-text">
            {action.error}
          </p>
          <button type="button" onClick={() => setReload((n) => n + 1)}>
            重新读取连接
          </button>
        </>
      )}
    </section>
  );
}
