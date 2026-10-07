import { ProtocolChoices } from "../components/ProtocolBindings.js";
import type { ProtocolRequirementState } from "@plums/host";
import type { ProtocolBindingIntent } from "@plums/sdk";
import { useEffect, useRef, useState } from "react";
import type { AgentRecord } from "@plums/host";
import type { DesktopContribution } from "@plums/sdk";
import { ManagedDialog } from "../managed-dialog.js";
import type { CatalogItem, AssemblyDraft } from "../shared/types.js";
import { newerVersion } from "../shared/version.js";
import { EmptyState } from "../components/EmptyState.js";
interface Props {
  record?: AgentRecord;
  seed?: AssemblyDraft;
  library: CatalogItem[];
  busy: boolean;
  error: string;
  onClose: () => void;
  onReload?: () => void;
  onImport: (draft: AssemblyDraft) => void;
  onSave: (
    name: string,
    digests: string[],
    characterId?: string,
    startup?: string,
    protocolBindings?: ProtocolBindingIntent[],
  ) => Promise<boolean>;
  onAdd: (digest: string) => Promise<boolean>;
  onRemove: (id: string) => Promise<void>;
  onUpdate: (id: string, digest: string) => Promise<boolean>;
}
const groups = [
  {
    kind: "character",
    title: "角色卡",
    description: "决定角色的内容与设定，可以选择多张或不选。",
  },
  {
    kind: "extension",
    title: "扩展",
    description: "提供工作界面、工具、处理流程和服务接入，必需依赖会自动加入。",
  },
] as const;
export function AssemblyEditor({
  record,
  seed,
  library,
  busy,
  error,
  onClose,
  onReload,
  onImport,
  onSave,
  onAdd,
  onRemove,
  onUpdate,
}: Props) {
  const [groupTab, setGroupTab] = useState(
    library[0]?.manifest.kind ?? "character",
  );
  const [name, setName] = useState(record?.name ?? seed?.name ?? ""),
    [selected, setSelected] = useState<string[]>(seed?.digests ?? []),
    [characterId, setCharacterId] = useState<string | undefined>(
      record
        ? (record.characterId ?? "")
        : seed
          ? (seed.characterId ?? "")
          : undefined,
    ),
    [startup, setStartup] = useState<string | undefined>(
      record
        ? (record.agent.startup ?? "")
        : seed
          ? (seed.startup ?? "")
          : undefined,
    ),
    [search, setSearch] = useState(""),
    [plan, setPlan] = useState<{
      digests: string[];
      additions: { digest: string; name: string; version: string }[];
      protocols?: ProtocolRequirementState[];
    }>({ digests: selected, additions: [] }),
    [planning, setPlanning] = useState(!record),
    [planError, setPlanError] = useState("");
  const [choices, setChoices] = useState<ProtocolBindingIntent[]>(
    seed?.protocolBindings ?? [],
  );
  const [saved, setSaved] = useState(false);
  const [nameError, setNameError] = useState("");
  const saving = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    if (record) {
      setCharacterId(record.characterId ?? "");
      setStartup(record.agent.startup ?? "");
    }
  }, [record]);
  useEffect(() => {
    if (record) return;
    let current = true;
    setPlanning(true);
    setPlanError("");
    window.manager
      .call("planAssembly", { digests: selected })
      .then((value) => {
        if (current) {
          const next = value as typeof plan;
          setPlan(next);
          setChoices((old) =>
            old.filter((b) =>
              (next.protocols ?? []).some(
                (s) =>
                  s.consumerId === b.consumerId &&
                  s.requirement.id === b.requirementId &&
                  s.candidates.some(
                    (c) =>
                      c.compatibility.compatible &&
                      JSON.stringify(c.intent) === JSON.stringify(b),
                  ),
              ),
            ),
          );
        }
      })
      .catch((e: { message?: string }) => {
        if (current) {
          setPlan({ digests: selected, additions: [] });
          setPlanError(e.message ?? "无法补齐组件，请检查所选版本。");
        }
      })
      .finally(() => {
        if (current) setPlanning(false);
      });
    return () => {
      current = false;
    };
  }, [selected, library, record]);
  const digests = record
    ? (record.components?.map((p) => p.digest) ?? [])
    : plan.digests;
  const chosen = library.filter((p) => digests.includes(p.digest));
  const cards = chosen.filter((p) => p.manifest.kind === "character");
  const fronts = chosen.filter(
    (p) =>
      p.manifest.kind === "extension" &&
      (p.manifest.payload as { plumsDesktop?: DesktopContribution })
        ?.plumsDesktop?.frontend,
  );
  const defaultCard = characterId ?? cards[0]?.manifest.id ?? "";
  const defaultFront = startup ?? fronts[0]?.manifest.id ?? "";
  const validCard = cards.some((p) => p.manifest.id === defaultCard)
    ? defaultCard
    : "";
  const validFront = fronts.some((p) => p.manifest.id === defaultFront)
    ? defaultFront
    : "";
  async function savePreferences(
    nextName = name,
    card = validCard,
    front = validFront,
  ) {
    if (saving.current) return saving.current;
    if (!nextName.trim()) {
      setNameError("请填写 Agent 名称。");
      return false;
    }
    setNameError("");
    setSaved(false);
    const task = onSave(
      nextName.trim(),
      digests,
      card || undefined,
      front || undefined,
      choices,
    );
    saving.current = task;
    try {
      const ok = await task;
      if (ok) {
        setName(nextName.trim());
        setSaved(true);
      } else if (record) {
        setCharacterId(record.characterId ?? "");
        setStartup(record.agent.startup ?? "");
      }
      return ok;
    } finally {
      saving.current = null;
    }
  }
  async function saveName() {
    if (!record || name === record.name) return true;
    return savePreferences();
  }
  async function close() {
    if (error || nameError) {
      onClose();
      return;
    }
    if (saving.current) {
      if (await saving.current) onClose();
    } else if (await saveName()) onClose();
  }
  return (
    <ManagedDialog
      testId="assembly-dialog"
      size="lg"
      className="assembly-modal"
      title={record ? `编辑 ${record.name}` : "创建自己的 Agent"}
      label={record ? "编辑组合" : "创建 Agent"}
      busy={busy}
      onClose={() => void close()}
      footer={
        <div>
          {" "}
          <section className="assembly-preferences">
            <h3>打开时使用</h3>
            <div className="assembly-selectors">
              <label>
                默认角色卡
                <select
                  aria-label="默认角色卡"
                  value={validCard}
                  disabled={busy}
                  onChange={(e) => {
                    setCharacterId(e.target.value);
                    if (record)
                      void savePreferences(
                        record.name,
                        e.target.value,
                        validFront,
                      );
                  }}
                >
                  <option value="">无默认角色卡</option>
                  {cards.map((p) => (
                    <option key={p.digest} value={p.manifest.id}>
                      {p.manifest.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                工作界面
                <select
                  aria-label="工作界面"
                  value={validFront}
                  disabled={busy}
                  onChange={(e) => {
                    setStartup(e.target.value);
                    if (record)
                      void savePreferences(
                        record.name,
                        validCard,
                        e.target.value,
                      );
                  }}
                >
                  <option value="">通用资源与状态页</option>
                  {fronts.map((p) => (
                    <option key={p.digest} value={p.manifest.id}>
                      {p.manifest.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>
          <div className="modal-actions">
            <button disabled={busy} onClick={() => void close()}>
              关闭
            </button>
            {!record && (
              <button
                className="primary"
                disabled={
                  busy ||
                  planning ||
                  !!planError ||
                  !name.trim() ||
                  (plan.protocols ?? []).some(
                    (s) =>
                      !s.requirement.optional &&
                      !choices.some(
                        (b) =>
                          b.consumerId === s.consumerId &&
                          b.requirementId === s.requirement.id &&
                          s.candidates.some(
                            (c) =>
                              c.compatibility.compatible &&
                              JSON.stringify(c.intent) === JSON.stringify(b),
                          ),
                      ),
                  )
                }
                onClick={() => void savePreferences()}
              >
                创建 Agent
              </button>
            )}
            {record && saved && (
              <span role="status" className="saved-feedback">
                已保存
              </span>
            )}
          </div>
        </div>
      }
    >
      <p>选择想要的角色与功能，再选择打开时使用的工作界面。</p>
      {error && (
        <div role="alert" className="notice error">
          {error}
        </div>
      )}
      {onReload && (
        <button disabled={busy} onClick={onReload}>
          重新加载
        </button>
      )}
      <label className="field">
        Agent 名称
        <input
          aria-label="Agent 名称"
          value={name}
          disabled={busy}
          aria-invalid={!!nameError}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
            setNameError("");
          }}
          onBlur={() => void saveName()}
          onKeyDown={(e) => {
            if (record && e.key === "Enter") {
              e.preventDefault();
              void saveName();
            }
          }}
          maxLength={256}
          placeholder="给它起个名字"
        />
      </label>
      {nameError && (
        <p className="error-text" role="alert">
          {nameError}
        </p>
      )}
      <div className="assembly-toolbar">
        <input
          aria-label="搜索组件"
          placeholder="搜索组件名称或功能"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          disabled={busy}
          onClick={async () => {
            if (!(await saveName())) return;
            onImport({
              name,
              digests: record ? digests : selected,
              characterId: validCard || undefined,
              startup: validFront || undefined,
              protocolBindings: choices,
            });
          }}
        >
          导入更多组件
        </button>
      </div>
      {!library.length && (
        <EmptyState
          illustration="components"
          description="公共库还没有组件。先导入角色卡或扩展，也可以直接创建空 Agent。"
        />
      )}
      <div className="assembly-layout">
        <nav className="assembly-kind-nav" aria-label="组件种类">
          {groups.map((group) => (
            <button
              key={group.kind}
              type="button"
              className={groupTab === group.kind ? "active" : ""}
              aria-pressed={groupTab === group.kind}
              onClick={() => setGroupTab(group.kind)}
            >
              {group.title}
              <span>
                {
                  chosen.filter(
                    (p) =>
                      p.manifest.kind === group.kind ||
                      (group.kind === "extension" &&
                        p.manifest.kind === "connector"),
                  ).length
                }
              </span>
            </button>
          ))}
        </nav>
        <div className="assembly-groups">
          {groups.map((group) => {
            const items = library.filter(
              (p) =>
                (p.manifest.kind === group.kind ||
                  (group.kind === "extension" &&
                    p.manifest.kind === "connector")) &&
                `${p.manifest.name} ${p.manifest.description}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            );
            return (
              <section
                hidden={groupTab !== group.kind}
                className="assembly-group"
                data-kind={group.kind}
                key={group.kind}
              >
                <div className="group-heading">
                  <h3>{group.title}</h3>
                  <span className="badge">
                    已选{" "}
                    {
                      chosen.filter(
                        (p) =>
                          p.manifest.kind === group.kind ||
                          (group.kind === "extension" &&
                            p.manifest.kind === "connector"),
                      ).length
                    }
                  </span>
                </div>
                <p>{group.description}</p>
                {!items.length && (
                  <small>
                    {search ? "没有匹配的组件" : "尚未导入此类组件"}
                  </small>
                )}
                {items.map((p) => {
                  const installed = record?.components?.find(
                      (c) => c.packageId === p.manifest.id,
                    ),
                    checked = record
                      ? digests.includes(p.digest)
                      : selected.includes(p.digest) ||
                        plan.additions.some((a) => a.digest === p.digest),
                    automatic =
                      !record &&
                      plan.additions.some((a) => a.digest === p.digest);
                  return (
                    <div
                      className={`assembly-item ${checked ? "chosen" : ""}`}
                      key={p.digest}
                    >
                      <div>
                        <strong>{p.manifest.name}</strong>
                        <small>
                          v{p.manifest.version}
                          {p.manifest.kind === "connector" ? " · 服务接入" : ""}
                          {checked
                            ? automatic
                              ? " · 随所选功能自动加入"
                              : " · 已选择"
                            : ""}
                        </small>
                        {p.manifest.description && (
                          <p>{p.manifest.description}</p>
                        )}
                        {!!p.manifest.dependencies.filter((d) => !d.optional)
                          .length && (
                          <small>
                            配合{" "}
                            {p.manifest.dependencies
                              .filter((d) => !d.optional)
                              .map(
                                (d) =>
                                  library.find((p) => p.manifest.id === d.id)
                                    ?.manifest.name ?? d.id,
                              )
                              .join("、")}{" "}
                            使用
                          </small>
                        )}
                      </div>
                      {record ? (
                        checked ? (
                          <button
                            disabled={busy}
                            onClick={() => void onRemove(p.manifest.id)}
                          >
                            移出
                          </button>
                        ) : installed &&
                          newerVersion(
                            p.manifest.version,
                            installed.version,
                          ) ? (
                          <button
                            disabled={busy}
                            onClick={() =>
                              void onUpdate(p.manifest.id, p.digest)
                            }
                          >
                            有新版本 · 更新到 v{p.manifest.version}
                            {p.manifest.kind === "connector"
                              ? " · 服务接入"
                              : ""}
                          </button>
                        ) : installed ? (
                          <span>其他版本</span>
                        ) : (
                          <button
                            disabled={busy}
                            onClick={() => void onAdd(p.digest)}
                          >
                            加入 Agent
                          </button>
                        )
                      ) : (
                        <input
                          type="checkbox"
                          aria-label={`选择 ${p.manifest.name} ${p.manifest.version}`}
                          checked={checked}
                          disabled={busy || automatic}
                          onChange={(e) =>
                            setSelected((s) =>
                              e.target.checked
                                ? [
                                    ...s.filter(
                                      (h) =>
                                        library.find((p) => p.digest === h)
                                          ?.manifest.id !== p.manifest.id,
                                    ),
                                    p.digest,
                                  ]
                                : s.filter((h) => h !== p.digest),
                            )
                          }
                        />
                      )}
                    </div>
                  );
                })}
              </section>
            );
          })}
        </div>
      </div>
      {!record && !!plan.protocols?.length && (
        <section className="panel">
          <h3>组件连接</h3>
          <ProtocolChoices
            requirements={plan.protocols}
            choices={choices}
            busy={busy || planning}
            onChoose={(state, choice) =>
              setChoices((old) => [
                ...old.filter(
                  (b) =>
                    b.consumerId !== state.consumerId ||
                    b.requirementId !== state.requirement.id,
                ),
                ...(choice ? [choice] : []),
              ])
            }
          />
        </section>
      )}
      {planning && <p role="status">正在检查所需组件…</p>}
      {planError && (
        <div className="notice error" role="alert">
          {planError}
        </div>
      )}
      {!record && (
        <p className="assembly-note">
          创建后会引导你填写必要配置、查看权限并开始使用。
        </p>
      )}
    </ManagedDialog>
  );
}
