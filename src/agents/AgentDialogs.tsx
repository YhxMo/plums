import { FileJsonIcon, LinkIcon, UploadIcon } from "lucide-react";
import type {
  Agent,
  AgentConfig,
  AgentProvider,
} from "@modules/agents/contract";
import { parseRoleCard } from "@modules/agents/validation";
import type { Named } from "@modules/sdk";
import { Dialog, DialogActions, DialogBody } from "@/components/Dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { ComposeStep, DescribeStep } from "./AddAgent";
import { useAgentDraft } from "./draft";
import type { AgentModals } from "./useAgentModals";

export function AgentDialogs({
  api,
  ui,
  modals,
  onCreated,
  onRemoved,
  onSessionDeleted,
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
  /** After a session of `agentId` is deleted. */
  onSessionDeleted(agentId: string): void;
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
      ? {
          create: "添加 Agent",
          compose: `${draft.name.trim()}的扩展`,
          import: "导入角色卡",
        }[modal]
      : {
          rename: "重命名 Agent",
          remove: "移除 Agent",
          deleteSession: "删除会话",
          renameSession: "重命名会话",
          truncate: "删除后续消息",
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
      // The add steps go back from their footer.
      onBack={
        previous && modal !== "create" && modal !== "compose" ? back : undefined
      }
      onClose={() => {
        if ((modal === "create" || modal === "compose") && !busy) draft.reset();
        closeModal();
      }}
    >
      {modal === "import" ? (
        <form
          key="import"
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
                  '{"version":1,"name":"我的助手","description":"帮助整理文字","instructions":"你是一名耐心的编辑。"}'
                }
                maxLength={32000}
              />
              <FieldDescription>
                支持实验 JSON
                格式：name、description（介绍）、instructions（设定）、avatar、version:
                1。没有 instructions 时，介绍会作为设定。
              </FieldDescription>
            </Field>
          </DialogBody>
          <DialogActions>
            {cancel}
            <Button
              type="button"
              variant="secondary"
              disabled={busy || reading || !raw.trim()}
              onClick={(event) => {
                event.preventDefault();
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
        <DescribeStep
          leave={
            previous ? (
              <Button
                type="button"
                variant="outline"
                data-dialog-back
                onClick={back}
              >
                上一步
              </Button>
            ) : (
              cancel
            )
          }
          onNext={() => open("compose")}
        />
      ) : modal === "compose" ? (
        <ComposeStep
          api={api}
          ui={ui}
          busy={busy}
          onBack={back}
          onModels={onModels && (() => detour(onModels))}
          onAdd={(config) => void act(() => add(config))}
          onError={setError}
        />
      ) : (
        typeof modal === "object" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              // The reply can take minutes; the dialog does not wait for it.
              if (modal.action === "truncate") {
                setModal(null);
                modal.run();
                return;
              }
              void act(async () => {
                if (modal.action === "rename")
                  await api.update(modal.agent.id, { name });
                else if (modal.action === "renameSession")
                  await api.renameSession!(
                    modal.agent.id,
                    modal.session!,
                    name,
                  );
                else if (modal.action === "remove") {
                  await api.remove(modal.agent.id);
                  onRemoved(modal.agent.id);
                } else {
                  await api.session(modal.agent.id, "delete", modal.session);
                  onSessionDeleted(modal.agent.id);
                }
                setModal(null);
              });
            }}
          >
            <DialogBody>
              {modal.action === "rename" || modal.action === "renameSession" ? (
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
                    ? `移除「${modal.agent.name}」并删除它在此应用中的本地会话${api.memories?.().some((m) => !modal.agent.off?.includes(m.id)) ? "和记忆" : ""}？`
                    : modal.action === "truncate"
                      ? `这会删除此后的 ${modal.count} 条消息，再等待新的回复。删除后可以在提示中撤销。`
                      : api.undo
                        ? "删除此会话及其本地消息？删除后可以在提示中撤销。"
                        : "删除此会话及其本地消息？此操作不能撤销。"}
                </p>
              )}
            </DialogBody>
            <DialogActions>
              {cancel}
              <Button
                type="submit"
                variant={
                  modal.action.startsWith("rename") ? "default" : "destructive"
                }
                disabled={busy}
              >
                {modal.action.startsWith("rename")
                  ? "保存"
                  : modal.action === "truncate"
                    ? "继续"
                    : "确认删除"}
              </Button>
            </DialogActions>
          </form>
        )
      )}
    </Dialog>
  );
}
