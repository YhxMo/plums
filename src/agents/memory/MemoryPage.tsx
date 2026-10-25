import { useCallback, useState, useSyncExternalStore } from "react";
import { BrainIcon, RefreshCwIcon } from "lucide-react";
import { OWNER, type ModelChoice } from "@modules/agents/contract";
import type { MemoryPageApi } from "@modules/agents/memory/extension";
import type { MemoryScope } from "@modules/agents/memory/contract";
import { expired, sameScope } from "@modules/agents/memory/items";
import type { ConsolidationModel } from "@modules/agents/memory/persistence";
import type { MemoryAgent } from "@modules/agents/memory/store";
import { DialogBody } from "@/components/Dialog";
import { Select, type SelectOption } from "@/components/Select";
import { ActionToast } from "@/components/Toast";
import { useAsyncAction } from "@/components/useAsyncAction";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
export function MemoryPage({ api }: { api: MemoryPageApi }) {
  const subscribe = useCallback(
    (listener: () => void) => api.subscribe(listener),
    [api],
  );
  const snap = useSyncExternalStore(subscribe, api.snapshot);
  const [view, setView] = useState(() => api.takeFocus() ?? SHARED);
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
  return (
    <DialogBody className="gap-5">
      <Select
        label="查看谁的记忆"
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
      <p className="text-sm leading-relaxed text-muted-foreground">
        {agent
          ? `「${agent.name}」从你们的对话里记下的事，只有它会读到。会话停下 3 分钟、你离开或切换会话后，用下方的模型整理一次。`
          : "写给所有 Agent 的资料，例如你的称呼、所在城市和偏好；每个 Agent 回复你时都会读到。Agent 不会自动往这里写。"}
      </p>
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
          onRemove={(item) => void saved(() => api.remove(item.id), "已删除")}
        />
      ) : (
        <Empty className="gap-2 border border-dashed p-5 md:p-5">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BrainIcon />
            </EmptyMedia>
            <EmptyTitle className="text-sm">
              {agent ? "还没有记下什么" : "还没有写下关于你的资料"}
            </EmptyTitle>
            <EmptyDescription>
              {agent
                ? "和它聊过之后，这里会出现它记下的事。"
                : "在下面写一条，所有 Agent 都会知道。"}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {past.length > 0 && (
        <section className="grid gap-2" aria-label="已过期">
          <h3 className="text-xs font-medium text-muted-foreground">已过期</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            已经不再告诉
            Agent。下次整理时会删掉，或改写成长期的事；你也可以现在删除，或补充时间让它重新生效。
          </p>
          <MemoryItems
            label="已过期的记忆"
            items={past}
            now={now}
            busy={busy}
            onUpdate={update}
            onRemove={(item) => void saved(() => api.remove(item.id), "已删除")}
          />
        </section>
      )}
      <section className="grid gap-2" aria-label="添加记忆">
        <h3 className="text-xs font-medium text-muted-foreground">
          {agent ? `告诉「${agent.name}」一件事` : "写一条关于你的资料"}
        </h3>
        <ItemForm
          submit="添加"
          busy={busy}
          onSave={(fields) => saved(() => api.add(scope, fields), "已添加")}
        />
      </section>
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
      <p role="status" className="text-sm text-muted-foreground">
        正在整理…
      </p>
    );
  if (!agent.problem && !agent.pending) return null;
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-3 rounded-lg bg-subtle/60 px-3 py-2.5 text-sm"
    >
      <p
        className={agent.problem ? "text-destructive" : "text-muted-foreground"}
      >
        {agent.problem ?? "有还没整理的对话。"}
      </p>
      {agent.pending && (
        <Button variant="outline" size="xs" disabled={busy} onClick={onRetry}>
          <RefreshCwIcon data-icon="inline-start" />
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
    <section className="grid gap-2" aria-label="整理用的模型">
      <h3 className="text-xs font-medium text-muted-foreground">
        {agent ? `整理「${agent.name}」的记忆用的模型` : "整理记忆默认用的模型"}
      </h3>
      <Select
        label={agent ? "这个 Agent 整理记忆用的模型" : "默认整理用的模型"}
        value={value}
        disabled={busy}
        options={options}
        onChange={(next) => onChange(parseChoice(next))}
      />
      <p className="text-xs leading-relaxed text-muted-foreground">
        每次整理会额外调用一次模型，按所选服务计费；可以选一个便宜的模型。
      </p>
      {elsewhere && (
        <p role="note" className="text-xs leading-relaxed text-brand-text">
          整理时，「{agent.name}」的对话会发送到「{elsewhere}
          」，不是它回复用的服务。
        </p>
      )}
    </section>
  );
}
