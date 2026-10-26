import { useCallback, useState, useSyncExternalStore } from "react";
import { ChevronRightIcon } from "lucide-react";
import { OWNER, type ModelChoice } from "@modules/agents/contract";
import type { MemoryPageApi } from "@modules/agents/memory/extension";
import type { MemoryItem, MemoryScope } from "@modules/agents/memory/contract";
import { expired, sameScope } from "@modules/agents/memory/items";
import type { ConsolidationModel } from "@modules/agents/memory/persistence";
import type { MemoryAgent } from "@modules/agents/memory/store";
import { DialogActions, DialogBody } from "@/components/Dialog";
import { Select, type SelectOption } from "@/components/Select";
import { ActionToast } from "@/components/Toast";
import { useAsyncAction } from "@/components/useAsyncAction";
import { Button } from "@/components/ui/button";
import { ItemForm, MemoryItems, type ItemFields } from "./MemoryItems";

const SHARED = "";
const OWN = "agent";
const DEFAULT = "default";
const modelKey = (provider: string, model: string) => `${provider}\n${model}`;
const choiceValue = (
  choice: ConsolidationModel | undefined,
  fallback: string,
) =>
  choice === undefined
    ? fallback
    : choice === "agent"
      ? OWN
      : modelKey(choice.provider, choice.model);

/** The model choices, with the one kept even when it is no longer offered. */
function modelOptions(
  models: readonly ModelChoice[],
  first: SelectOption[],
  kept: string,
): SelectOption[] {
  const listed = models.map((m) => ({
    value: modelKey(m.provider, m.id),
    label: m.label,
    description: m.description,
    group: m.group,
  }));
  const missing =
    kept !== OWN && kept !== DEFAULT && !listed.some((o) => o.value === kept);
  return [
    ...first,
    ...(missing ? [{ value: kept, label: "已不可用的模型" }] : []),
    ...listed,
  ];
}
const parseChoice = (value: string): ConsolidationModel | null => {
  if (value === DEFAULT) return null;
  if (value === OWN) return "agent";
  const [provider, model] = value.split("\n");
  return { provider, model };
};

/**
 * What Agents remember: the shared page everyone reads (opened from the
 * avatar) and each Agent's own (opened from its details), with the model
 * that consolidates and whether that sends the conversation elsewhere.
 */
export function MemoryPage({
  api,
  focus,
  onDone,
}: {
  api: MemoryPageApi;
  /** The Agent to show first; null for the shared memory. */
  focus: string | null;
  /** Closes the dialog; the page ends in a button for it. */
  onDone?: () => void;
}) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const snap = useSyncExternalStore(subscribe, api.snapshot);
  const [view, setView] = useState(focus ?? SHARED);
  const { busy, error, notice, setError, setNotice, run } = useAsyncAction();
  const now = Date.now();
  const agent = snap.agents.find((a) => a.id === view);
  const scope: MemoryScope = agent
    ? { kind: "agent", agent: agent.id, person: OWNER }
    : { kind: "person", person: OWNER };
  const items = snap.items
    .filter((item) => sameScope(item.scope, scope))
    .sort((a, b) => a.createdAt - b.createdAt);
  const current = items.filter((item) => !expired(item, now));
  const past = items.filter((item) => expired(item, now));
  const models = api.models();
  const saved = (action: () => Promise<void>, message: string) => {
    let ok = false;
    return run(async () => {
      await action();
      ok = true;
      setNotice(message);
    }).then(() => ok);
  };
  const update = (id: string, fields: ItemFields) =>
    saved(() => api.update(id, fields), "已保存");
  const remove = (item: { id: string }) =>
    void saved(() => api.remove(item.id), "已删除");
  return (
    <>
      <DialogBody className="gap-[18px]">
        <div className="flex items-center gap-3">
          <Select
            label="查看谁的记忆"
            className="w-auto min-w-44"
            value={agent ? agent.id : SHARED}
            onChange={setView}
            options={[
              {
                value: SHARED,
                label: "关于我",
                description: "写给所有 Agent 的资料",
              },
              ...snap.agents.map((a) => ({
                value: a.id,
                label: a.name,
                description: "它从对话里记下的事",
                group: "Agent 记得的事",
              })),
            ]}
          />
          <span className="text-xs text-muted-foreground">
            {agent ? "只有它会读到" : "所有 Agent 都会读到"}
          </span>
        </div>
        {agent && (
          <Status
            agent={agent}
            busy={busy}
            onRetry={() => void run(() => api.consolidate(agent.id))}
          />
        )}
        {current.length ? (
          <MemoryItems
            label={agent ? `${agent.name} 记得的事` : "关于我"}
            items={current}
            now={now}
            busy={busy}
            onUpdate={update}
            onRemove={remove}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {agent ? "还没有记下什么" : "还没有写下关于你的资料"}
          </p>
        )}
        {past.length > 0 && (
          <Expired
            items={past}
            now={now}
            busy={busy}
            onUpdate={update}
            onRemove={remove}
            onClear={() =>
              void saved(() => api.clearExpired(scope), "已清除过期的记忆")
            }
          />
        )}
        <ItemForm
          submit="添加"
          busy={busy}
          onSave={(fields) => saved(() => api.add(scope, fields), "已添加")}
        />
        <ModelSetting
          agent={agent}
          model={snap.model}
          models={models}
          busy={busy}
          onChange={(choice) =>
            void run(async () => {
              await api.setModel(agent?.id ?? null, choice);
              setNotice("已更新整理用的模型");
            })
          }
        />
        <ActionToast
          error={error}
          notice={notice}
          onDone={() => {
            setError("");
            setNotice("");
          }}
        />
      </DialogBody>
      {onDone && (
        <DialogActions>
          <Button onClick={onDone}>完成</Button>
        </DialogActions>
      )}
    </>
  );
}

/**
 * Items past their time: no longer told, folded into one row that clears
 * them all; open, each can be edited back into effect or deleted.
 */
function Expired({
  items,
  now,
  busy,
  onUpdate,
  onRemove,
  onClear,
}: {
  items: readonly MemoryItem[];
  now: number;
  busy: boolean;
  onUpdate: (id: string, fields: ItemFields) => Promise<boolean>;
  onRemove: (item: MemoryItem) => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="grid gap-2">
      <div className="flex h-10 items-center gap-1.5 rounded-lg border pr-2 pl-3">
        <button
          type="button"
          data-slot="expired-toggle"
          aria-expanded={open}
          className="flex h-8 flex-1 items-center gap-1.5 rounded-sm text-left text-sm text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRightIcon
            aria-hidden="true"
            className={open ? "size-4 rotate-90" : "size-4"}
          />
          已过期 {items.length} 条
        </button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          disabled={busy}
          onClick={onClear}
        >
          全部清除
        </Button>
      </div>
      {open && (
        <MemoryItems
          label="已过期的记忆"
          items={items}
          now={now}
          busy={busy}
          onUpdate={onUpdate}
          onRemove={onRemove}
        />
      )}
    </section>
  );
}

function Status({
  agent,
  busy,
  onRetry,
}: {
  agent: MemoryAgent;
  busy: boolean;
  onRetry: () => void;
}) {
  if (agent.running)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        正在整理…
      </p>
    );
  if (!agent.problem && !agent.pending) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 text-xs text-muted-foreground"
    >
      <p className={agent.problem ? "text-destructive" : undefined}>
        {agent.problem ?? "有还没整理的对话"}
      </p>
      {agent.pending && (
        <Button variant="outline" size="xs" disabled={busy} onClick={onRetry}>
          {agent.problem ? "重试" : "现在整理"}
        </Button>
      )}
    </div>
  );
}

/** The default consolidation model, or one Agent's own, and where it sends the conversation. */
function ModelSetting({
  agent,
  model,
  models,
  busy,
  onChange,
}: {
  agent?: MemoryAgent;
  model: ConsolidationModel;
  models: readonly ModelChoice[];
  busy: boolean;
  onChange: (choice: ConsolidationModel | null) => void;
}) {
  const value = agent
    ? choiceValue(agent.choice, DEFAULT)
    : choiceValue(model, OWN);
  const options = modelOptions(
    models,
    agent
      ? [
          {
            value: DEFAULT,
            label: "用默认设置",
            description: "在“关于我”页设置",
          },
          {
            value: OWN,
            label: "用它自己的模型",
            description: "和回复用同一个模型",
          },
        ]
      : [
          {
            value: OWN,
            label: "跟随各 Agent 自己的模型",
            description: "和回复用同一个模型",
          },
        ],
    value,
  );
  // Which model this Agent's consolidation ends up with.
  const resolved = agent && (agent.choice ?? model);
  const target = resolved === "agent" ? agent?.model : resolved;
  const elsewhere =
    agent &&
    target &&
    target.provider !== agent.model?.provider &&
    models.find((m) => m.provider === target.provider)?.providerLabel;
  return (
    <section className="grid gap-2 border-t pt-3.5" aria-label="整理用的模型">
      <div className="flex items-center justify-between gap-3 max-form:flex-col max-form:items-stretch">
        <h3 className="text-sm">整理用的模型</h3>
        <Select
          label={agent ? "这个 Agent 整理记忆用的模型" : "默认整理用的模型"}
          className="w-auto min-w-52"
          value={value}
          disabled={busy}
          options={options}
          onChange={(next) => onChange(parseChoice(next))}
        />
      </div>
      {elsewhere && (
        <p role="note" className="text-xs leading-relaxed text-brand-text">
          整理时，「{agent.name}」的对话会发送到「{elsewhere}
          」，不是它回复用的服务。
        </p>
      )}
    </section>
  );
}
