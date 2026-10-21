import type { ReactNode } from "react";
import {
  ChevronRightIcon,
  FileJsonIcon,
  IdCardIcon,
  LinkIcon,
  PuzzleIcon,
  SparklesIcon,
  UploadIcon,
} from "lucide-react";
import {
  enabledExtensions,
  type Agent,
  type AgentConfig,
  type AgentProvider,
} from "../../modules/agents/contract";
import { parseRoleCard } from "../../modules/agents/store";
import type { Named } from "../../modules/sdk";
import { InfoTip } from "../components/Tooltip";
import { Dialog, DialogActions, DialogBody } from "../components/Dialog";
import { Button, buttonVariants } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Label } from "../components/ui/label";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
  FieldSet,
  FieldLegend,
} from "../components/ui/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "../components/ui/item";
import { ExtensionPipeline } from "./ExtensionPipeline";
import { ModelSelect } from "./ModelSelect";
import { useAgentDraft } from "./draft";
import { agentParts, switchPart, type Part } from "./parts";
import type { AgentModals } from "./useAgentModals";

function Choice({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Item
      asChild
      variant="outline"
      className="bg-card text-left shadow-panel hover:bg-muted/60 hover:shadow-raised"
    >
      <button onClick={onClick}>
        <ItemMedia
          variant="icon"
          className="size-9 rounded-lg bg-brand-soft text-brand-text"
        >
          {icon}
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription>{description}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </ItemActions>
      </button>
    </Item>
  );
}

export function AgentDialogs({
  api,
  ui,
  modals,
  onCreated,
  onRemoved,
  onExtensions,
  onModels,
  fallbackFocus,
}: {
  api: AgentProvider;
  ui?: Named;
  modals: Pick<
    AgentModals,
    | "modal"
    | "previous"
    | "name"
    | "busy"
    | "roleCard"
    | "modalTrigger"
    | "setName"
    | "setModal"
    | "setError"
    | "open"
    | "back"
    | "closeModal"
    | "act"
  >;
  onCreated(agent: Agent): void;
  onRemoved(id: string): void;
  onExtensions(): void;
  onModels?: () => void;
  fallbackFocus(): HTMLElement | null;
}) {
  const {
    modal,
    previous,
    name,
    setName,
    busy,
    modalTrigger,
    open,
    back,
    closeModal,
    setModal,
    setError,
    act,
    roleCard,
  } = modals;
  const { raw, url, setRaw, setUrl, reading, readLink, readFile } = roleCard;
  const draft = useAgentDraft();
  const choices = api.extensionChoices?.();
  const models = api.modelChoices?.();
  // Unchosen fields show what the provider would pick on its own.
  const [first] = models ?? [];
  const model =
    draft.model === undefined
      ? first
        ? { provider: first.provider, model: first.id }
        : null
      : draft.model;
  const extensions =
    draft.extensions?.filter((id) => choices?.some((c) => c.id === id)) ??
    (model ? [] : enabledExtensions({}, choices ?? []));
  const parts = agentParts({
    provider: api.info.extensions ?? [],
    ui,
    api,
    model,
    off: draft.off,
  });
  function switchDraftPart(part: Part, on: boolean) {
    try {
      const next = switchPart(part, on, api, model);
      const off = draft.off.filter((id) => id !== part.choice.id);
      draft.change({
        off: next.off ? [...off, part.choice.id] : off,
        ...(next.model && { model: next.model }),
      });
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
  }
  const replies =
    parts.some((p) => p.connector && p.on) ||
    (!api.connectors && !!model) ||
    extensions.length > 0;
  async function add(config: AgentConfig) {
    const agent = await api.create(config);
    onCreated(agent);
    setModal(null);
    draft.reset();
    setRaw("");
  }
  /** Leaves for another page; the draft waits for the next add. */
  function detour(go: () => void) {
    setModal(null);
    go();
  }
  if (!modal) return null;
  const title =
    typeof modal === "string"
      ? { add: "添加", create: "添加 Agent", import: "导入角色卡" }[modal]
      : {
          rename: "重命名 Agent",
          remove: "移除 Agent",
          deleteSession: "删除会话",
        }[modal.action];
  const cancel = (
    <Button
      type="button"
      variant="outline"
      disabled={busy}
      onClick={closeModal}
    >
      取消
    </Button>
  );
  return (
    <Dialog
      returnFocusTo={modalTrigger.current}
      fallbackFocus={fallbackFocus}
      title={title}
      onBack={previous ? back : undefined}
      onClose={() => {
        if (modal === "create" && !busy) draft.reset();
        closeModal();
      }}
      className={modal === "create" ? "max-w-[560px]" : undefined}
    >
      {modal === "add" ? (
        <DialogBody>
          <p className="text-muted-foreground">选择添加方式</p>
          <div className="grid gap-2">
            <Choice
              icon={<SparklesIcon />}
              title="添加 Agent"
              description="写下角色说明，选择模型并拼接已安装的扩展"
              onClick={() => open("create")}
            />
            <Choice
              icon={<IdCardIcon />}
              title="导入角色卡"
              description="从文件或链接读取角色说明，再按需调整"
              onClick={() => open("import")}
            />
            <Choice
              icon={<PuzzleIcon />}
              title="安装扩展"
              description="添加模型连接器、MCP 或其他能力"
              onClick={() => detour(onExtensions)}
            />
          </div>
        </DialogBody>
      ) : modal === "import" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(() => add(parseRoleCard(raw)));
          }}
        >
          <DialogBody>
            <p className="text-muted-foreground">
              角色卡向你介绍这个 Agent 是谁、能帮你做什么。读取后可以直接添加，
              也可以继续选择模型和扩展。
            </p>
            <Field>
              <span className="text-sm font-medium">角色卡文件</span>
              <label
                className={buttonVariants({
                  variant: "outline",
                  className:
                    "h-auto min-h-16 w-full flex-col gap-1 border-dashed py-3 has-[input:disabled]:opacity-50 has-[input:focus-visible]:border-ring has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
                })}
              >
                <UploadIcon className="size-5 text-muted-foreground" />
                <span>选择 JSON 文件</span>
                <input
                  className="sr-only"
                  aria-label="角色卡文件"
                  disabled={busy || reading}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file)
                      void act(async () => {
                        await readFile(file);
                      });
                  }}
                />
              </label>
            </Field>
            <Field>
              <FieldLabel htmlFor="role-card-url">角色卡链接</FieldLabel>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <LinkIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="role-card-url"
                    className="pl-8"
                    disabled={busy || reading}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="/cards/example.json"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy || reading || !url.trim()}
                  onClick={() => void readLink()}
                >
                  {reading ? "读取中…" : "读取"}
                </Button>
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="role-card-raw">
                <FileJsonIcon className="size-4 text-muted-foreground" />
                角色卡内容
              </FieldLabel>
              <Textarea
                id="role-card-raw"
                className="max-h-60 min-h-28 font-mono text-xs"
                disabled={busy || reading}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder={
                  '{"version":1,"name":"我的助手","description":"帮助整理文字","multiSession":true}'
                }
                maxLength={32000}
              />
              <FieldDescription>
                支持实验 JSON 格式：name、description、multiSession、version:
                1。
              </FieldDescription>
            </Field>
          </DialogBody>
          <DialogActions>
            {cancel}
            <Button
              type="button"
              variant="secondary"
              disabled={busy || reading || !raw.trim()}
              onClick={() => {
                try {
                  draft.reset(parseRoleCard(raw));
                  open("create");
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
            >
              选择模型和扩展
            </Button>
            <Button type="submit" disabled={busy || reading || !raw.trim()}>
              {busy ? "正在添加…" : "添加"}
            </Button>
          </DialogActions>
        </form>
      ) : modal === "create" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void act(() =>
              add({
                name: draft.name,
                description: draft.description,
                multiSession: draft.multiSession,
                ...(models && { model }),
                ...(choices && { extensions }),
                ...(api.setOff && { off: draft.off }),
              }),
            );
          }}
        >
          <DialogBody className="gap-5">
            <FieldGroup className="gap-4">
              <Field>
                <FieldLabel htmlFor="agent-name">名称</FieldLabel>
                <Input
                  id="agent-name"
                  autoFocus
                  value={draft.name}
                  onChange={(e) => draft.change({ name: e.target.value })}
                  maxLength={60}
                  placeholder="例如：写作助手"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="agent-description">角色说明</FieldLabel>
                <Textarea
                  id="agent-description"
                  value={draft.description}
                  onChange={(e) =>
                    draft.change({ description: e.target.value })
                  }
                  maxLength={4000}
                  placeholder="它帮助你做什么？有哪些边界？"
                  className="min-h-20"
                />
              </Field>
              <Field orientation="horizontal">
                <Checkbox
                  id="agent-multi"
                  checked={draft.multiSession}
                  onCheckedChange={(checked) =>
                    draft.change({ multiSession: checked === true })
                  }
                />
                <Label htmlFor="agent-multi" className="font-normal">
                  允许多个会话
                </Label>
              </Field>
            </FieldGroup>
            {models && (
              <>
                <FieldSeparator />
                <FieldSet className="gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLegend variant="label" className="mb-0">
                      模型
                    </FieldLegend>
                    {onModels && (
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        className="px-0 text-brand-text"
                        onClick={() => detour(onModels)}
                      >
                        {models.length ? "管理模型连接" : "去添加模型连接"}
                        <ChevronRightIcon data-icon="inline-end" />
                      </Button>
                    )}
                  </div>
                  <ModelSelect
                    label="新 Agent 使用的模型"
                    models={models}
                    value={model}
                    onChange={(next) =>
                      draft.change({
                        model: next,
                        // Picking a model switches its connection on.
                        off: draft.off.filter((id) => id !== next?.provider),
                      })
                    }
                  />
                </FieldSet>
              </>
            )}
            {choices && (
              <>
                <FieldSeparator />
                <FieldSet className="gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <FieldLegend
                      variant="label"
                      className="mb-0 flex items-center gap-1"
                    >
                      拼接扩展
                      <InfoTip
                        label="拼接扩展"
                        text="开启的扩展组成这个 Agent；带编号的文本扩展依次处理回复，可拖动调整先后。添加后也能在详情里增减。"
                      />
                    </FieldLegend>
                    <Button
                      type="button"
                      variant="link"
                      size="xs"
                      className="px-0 text-brand-text"
                      onClick={() => detour(onExtensions)}
                    >
                      安装或启用更多
                      <ChevronRightIcon data-icon="inline-end" />
                    </Button>
                  </div>
                  <ExtensionPipeline
                    agentName={draft.name.trim() || "新 Agent"}
                    parts={parts}
                    onPart={api.setOff && switchDraftPart}
                    choices={choices}
                    value={extensions}
                    onChange={(ids) => draft.change({ extensions: ids })}
                  />
                </FieldSet>
              </>
            )}
            {(models || choices) && !replies && (
              <p className="rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                还没有开启模型连接或文本扩展：可以先添加，开启后此 Agent
                才能回复。
              </p>
            )}
          </DialogBody>
          <DialogActions>
            {cancel}
            <Button type="submit" disabled={busy || !draft.name.trim()}>
              {busy ? "正在添加…" : "添加"}
            </Button>
          </DialogActions>
        </form>
      ) : (
        typeof modal === "object" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void act(async () => {
                if (modal.action === "rename")
                  await api.update(modal.agent.id, { name });
                else if (modal.action === "remove") {
                  await api.remove(modal.agent.id);
                  onRemoved(modal.agent.id);
                } else
                  await api.session(modal.agent.id, "delete", modal.session);
                setModal(null);
              });
            }}
          >
            <DialogBody>
              {modal.action === "rename" ? (
                <Field>
                  <FieldLabel htmlFor="agent-rename">名称</FieldLabel>
                  <Input
                    id="agent-rename"
                    autoFocus
                    value={name}
                    maxLength={60}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </Field>
              ) : (
                <p>
                  {modal.action === "remove"
                    ? `移除「${modal.agent.name}」并删除它在此应用中的本地会话？`
                    : "删除此会话及其本地消息？此操作不能撤销。"}
                </p>
              )}
            </DialogBody>
            <DialogActions>
              {cancel}
              <Button
                type="submit"
                variant={modal.action === "rename" ? "default" : "destructive"}
                disabled={busy}
              >
                {modal.action === "rename" ? "保存" : "确认删除"}
              </Button>
            </DialogActions>
          </form>
        )
      )}
    </Dialog>
  );
}
