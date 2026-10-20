import { useState } from "react";
import { ChevronRightIcon, PuzzleIcon, ShieldAlertIcon } from "lucide-react";
import { cn } from "cn";
import { Dialog, DialogActions, DialogBody } from "../../components/Dialog";
import type { DialogFeedback } from "../../shell/controllers";
import { capabilityLabel } from "../../shell/messages";
import type { ExtensionDefinition } from "../../../modules/sdk";
import {
  sourceLabel,
  type ExtensionFile,
} from "../../../modules/shell/file-import";
import { serviceList } from "./services";
import { buttonVariants, Button } from "../../components/ui/button";
import { Field, FieldLabel } from "../../components/ui/field";
import { Input } from "../../components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "../../components/ui/collapsible";

export type ImportPreview = {
  file: ExtensionFile;
  definition: ExtensionDefinition;
  replacing: boolean;
};

function PreviewDetails({ file, definition, replacing }: ImportPreview) {
  const { manifest } = definition;
  const bindings = Object.values(manifest.credentialBindings ?? {});
  return (
    <>
      <dl
        className="grid grid-cols-[88px_1fr] gap-x-3 gap-y-1.5 rounded-xl bg-muted/50 p-4 [&_dd]:[overflow-wrap:anywhere] [&_dt]:text-muted-foreground"
        aria-label="导入内容"
      >
        {manifest.name && (
          <>
            <dt>名称</dt>
            <dd className="font-medium">{manifest.name}</dd>
          </>
        )}
        <dt>扩展 ID</dt>
        <dd>{manifest.id}</dd>
        {manifest.description && (
          <>
            <dt>说明</dt>
            <dd className="whitespace-pre-line">{manifest.description}</dd>
          </>
        )}
        <dt>版本</dt>
        <dd>{manifest.version}</dd>
        <dt>提供服务</dt>
        <dd>{serviceList(manifest.provides)}</dd>
        <dt>所需服务</dt>
        <dd>{serviceList(manifest.requires, manifest.optional)}</dd>
        <dt>系统权限</dt>
        <dd>
          {manifest.capabilities?.length
            ? manifest.capabilities
                .map((cap) => capabilityLabel(cap, manifest))
                .join("、")
            : "无需原生能力"}
        </dd>
        {bindings.length > 0 && (
          <>
            <dt>联网目标</dt>
            <dd>
              {bindings
                .map((binding) => `${binding.label}（${binding.target}）`)
                .join("、")}
            </dd>
          </>
        )}
        <dt>来源</dt>
        <dd>{sourceLabel(file.url)}</dd>
      </dl>
      <p className="text-muted-foreground">
        {replacing
          ? "将替换已导入的同 ID 扩展：旧版本先停用并撤销权限，扩展数据保留；替换后需重新启用并确认权限。"
          : "导入后扩展保持停用；启用时再确认它需要的权限。"}
      </p>
    </>
  );
}

export function InstallDialog({
  feedback,
  open,
  source,
  onClose,
  onInstall,
  onPreview,
  onImport,
}: {
  feedback: DialogFeedback;
  open: boolean;
  source: HTMLElement | null;
  onClose(): void;
  onInstall(id: string, url: string): Promise<void>;
  onPreview(file: Blob): Promise<ImportPreview | undefined>;
  onImport(preview: ImportPreview): Promise<void>;
}) {
  const { busy } = feedback;
  const [moduleUrl, setModuleUrl] = useState("");
  const [moduleId, setModuleId] = useState("");
  const [preview, setPreview] = useState<ImportPreview>();
  const [dragging, setDragging] = useState(false);
  if (!open) return null;
  const close = () => {
    if (busy) return;
    setPreview(undefined);
    onClose();
  };
  const choose = async (file: File | undefined) => {
    if (file) setPreview(await onPreview(file));
  };
  return (
    <Dialog
      title="安装扩展"
      returnFocusTo={source}
      onClose={close}
      onBack={preview && !busy ? () => setPreview(undefined) : undefined}
    >
      <DialogBody>
        {preview ? (
          <PreviewDetails {...preview} />
        ) : (
          <>
            <p>导入下载或自己编写的扩展文件（单个 .js 文件）。</p>
            <p
              className="flex gap-2 rounded-lg bg-brand-soft/60 p-3 text-xs leading-relaxed text-muted-foreground"
              role="note"
            >
              <ShieldAlertIcon className="size-4 shrink-0 text-brand-text" />
              <span>
                <strong className="font-semibold text-brand-text">
                  只导入你信任来源的文件。
                </strong>
                扩展与应用在同一环境中运行：选择文件后其代码就会执行，并可使用你之后授予的权限。
              </span>
            </p>
            <div
              className={cn(
                "grid justify-items-center gap-2.5 rounded-xl border-[1.5px] border-dashed border-input px-4 py-7 text-brand-text transition-colors",
                dragging && "scale-[1.01] border-brand bg-brand-soft",
              )}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                if (!busy) void choose(event.dataTransfer.files[0]);
              }}
            >
              <PuzzleIcon className="size-7" />
              <label
                className={cn(
                  buttonVariants(),
                  "cursor-pointer has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50",
                  busy && "pointer-events-none opacity-50",
                )}
              >
                选择扩展文件
                <input
                  type="file"
                  className="sr-only"
                  accept=".js,.mjs,text/javascript"
                  disabled={busy}
                  onChange={(event) => {
                    const input = event.currentTarget;
                    void choose(input.files?.[0]).finally(() => {
                      input.value = "";
                    });
                  }}
                />
              </label>
              <span className="text-xs text-muted-foreground pointer-coarse:hidden">
                也可以把文件拖到这里
              </span>
            </div>
            {/* Open by default only in development builds. */}
            <Collapsible defaultOpen={import.meta.env.DEV}>
              <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:underline">
                <ChevronRightIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-90" />
                开发者：按模块路径安装
              </CollapsibleTrigger>
              <CollapsibleContent>
                <form
                  className="grid gap-3 pt-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onInstall(moduleId, moduleUrl);
                  }}
                >
                  <p className="text-xs text-muted-foreground">
                    加载随应用提供或开发服务器上的同源 ESM
                    模块；路径保存在本地。
                  </p>
                  <Field>
                    <FieldLabel htmlFor="install-id">扩展 ID</FieldLabel>
                    <Input
                      id="install-id"
                      value={moduleId}
                      onChange={(e) => setModuleId(e.target.value)}
                      required
                      placeholder="example.extension"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="install-url">模块路径</FieldLabel>
                    <Input
                      id="install-url"
                      value={moduleUrl}
                      onChange={(e) => setModuleUrl(e.target.value)}
                      required
                      placeholder="/extensions/example.js"
                    />
                  </Field>
                  <Button
                    variant="outline"
                    className="justify-self-start"
                    disabled={busy}
                  >
                    加载模块
                  </Button>
                </form>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </DialogBody>
      <DialogActions>
        <Button variant="outline" type="button" disabled={busy} onClick={close}>
          取消
        </Button>
        {preview && (
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void onImport(preview).then(() => setPreview(undefined))
            }
          >
            {preview.replacing ? "替换" : "导入"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
