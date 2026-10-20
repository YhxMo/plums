import { preservedMessage } from "./messages";
import type { ShellDialogsProps } from "./controllers";
import { ExtensionView } from "./ExtensionView";
import { Dialog, DialogBody } from "../components/Dialog";
import { Button } from "../components/ui/button";
import { SettingsPanel } from "./SettingsPanel";
export function ShellDialogs({
  host,
  operations,
  workspace,
  appearance: settingsAppearance,
  navigation,
}: ShellDialogsProps) {
  const { busy, operate } = operations;
  const { views, activeView } = workspace;
  const settings = navigation.dialog;
  const setSettings = navigation.setDialog;
  async function selectLayout(id: string) {
    await workspace.selectLayout(id);
    setSettings(null);
  }
  if (!settings) return null;
  if (typeof settings === "object") {
    const view = workspace.allViews.find(
      (view) => view.presentation === "dialog" && view.id === settings.id,
    );
    return (
      <Dialog
        key={settings.id}
        title={view?.label ?? settings.label}
        onBack={navigation.back}
        onClose={() => setSettings(null)}
      >
        {view ? (
          <ExtensionView
            host={host}
            id={view.id}
            generation={view.generation}
          />
        ) : (
          <DialogBody>
            <p>{preservedMessage("界面提供者暂不可用")}</p>
            <Button
              variant="outline"
              className="justify-self-start"
              onClick={() => navigation.openManager()}
            >
              查看扩展
            </Button>
          </DialogBody>
        )}
      </Dialog>
    );
  }
  return (
    <Dialog
      key={settings}
      title={settings === "about" ? "关于 Plums" : "应用设置"}
      onBack={navigation.back}
      onClose={() => setSettings(null)}
    >
      {settings === "about" ? (
        <DialogBody className="justify-items-center py-8 text-center">
          <img
            className="size-16 rounded-2xl object-contain shadow-raised"
            src="/brand/plums.png"
            width="64"
            height="64"
            alt=""
          />
          <div className="grid gap-1">
            <h3 className="text-lg font-semibold tracking-tight">
              Plums · 0.2.0
            </h3>
            <p>通过扩展组合角色、能力和界面。</p>
          </div>
          <p className="max-w-sm text-xs text-muted-foreground">
            本地调试原型。能力与数据格式由已启用的扩展提供；请在扩展详情核对来源、版本与权限。
          </p>
        </DialogBody>
      ) : (
        <DialogBody className="gap-5">
          <SettingsPanel
            busy={busy}
            operate={operate}
            views={views}
            activeView={activeView}
            selectLayout={selectLayout}
            appearance={settingsAppearance}
            openManager={(diagnostics) => navigation.openManager(diagnostics)}
          />
        </DialogBody>
      )}
    </Dialog>
  );
}
