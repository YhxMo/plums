import { useRef } from "react";
import type {
  Agent,
  AgentConfig,
  AgentProvider,
} from "@modules/agents/contract";
import { parseRoleCard } from "@modules/agents/validation";
import type { Named } from "@modules/sdk";
import { Dialog, DialogActions, DialogBody } from "@/components/Dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldLabel } from "@/components/ui/field";
import { ComposeStep, DescribeStep, ImportStep } from "./AddAgent";
import { ExportBundle } from "./ExportBundle";
import { exportBundle, importBundle, type AgentFiles } from "./agentFiles";
import { AVATAR_BASE64, AVATAR_SIDE, scaledPicture } from "./imageFile";
import { useAgentDraft } from "./draft";
import type { ModelPage } from "./ModelSelect";
import type { AgentModals } from "./useAgentModals";

/** A picture card's image as an avatar, cut square and compressed. */
async function cardAvatar(picture: Blob) {
  const { mime, data } = await scaledPicture(
    new File([picture], "角色卡.png", { type: picture.type }),
    { side: AVATAR_SIDE, limit: AVATAR_BASE64, crop: true },
  );
  return `data:${mime};base64,${data}`;
}

export function AgentDialogs({
  api,
  ui,
  modals,
  onCreated,
  onRemoved,
  onSessionDeleted,
  modelPages,
  files,
  onNotice,
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
  modelPages?: readonly ModelPage[];
  files: AgentFiles;
  /** Says what was done, outside the dialog. */
  onNotice: (text: string) => void;
  /** Where focus goes when its opener is gone, or once something is added. */
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
  const draft = useAgentDraft();
  // The button that opened adding has done its part once an Agent exists.
  const created = useRef(false);
  async function add(config: AgentConfig) {
    const agent = await api.create(config);
    created.current = true;
    onCreated(agent);
    setModal(null);
    draft.reset();
    roleCard.setRaw("");
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
          bundle: "导出 Agent 和扩展",
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
      focusAfterClose={() => {
        const target = created.current ? fallbackFocus() : null;
        created.current = false;
        return target;
      }}
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
        <ImportStep
          card={roleCard}
          busy={busy}
          leave={cancel}
          onRead={(read) => void act(read)}
          onNext={() =>
            void act(async () => {
              const card = parseRoleCard(roleCard.raw);
              const avatar =
                roleCard.picture && (await cardAvatar(roleCard.picture));
              const { bundle } = roleCard;
              // A whole-Agent file: its packages are offered first, and
              // whatever stays missing is said in the next step.
              const notes = bundle ? await importBundle(bundle, files) : [];
              draft.reset({ ...card, ...(avatar && { avatar }) });
              if (bundle) draft.change({ off: bundle.off, notes });
              open("create");
            })
          }
        />
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
          modelPages={modelPages}
          onAdd={(config) => void act(() => add(config))}
          onError={setError}
        />
      ) : typeof modal === "object" && modal.action === "bundle" ? (
        <ExportBundle
          parts={modal.parts}
          busy={busy}
          leave={cancel}
          files={files}
          onExport={(extensions) =>
            void act(async () => {
              if (
                !(await exportBundle(
                  modal.agent,
                  modal.parts,
                  extensions,
                  files,
                ))
              )
                return;
              setModal(null);
              onNotice("已导出 Agent 和扩展");
            })
          }
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
