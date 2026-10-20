import { preservedMessage } from "./messages";
import type { ShellDialogsProps } from "./controllers";
import { ExtensionView } from "./ExtensionView";
import { Dialog } from "../components/Dialog";
import { SettingsPanel } from "./SettingsPanel";
import styles from "../features/extensions/ExtensionManager.module.css";
export function ShellDialogs({
  host,
  operations,
  workspace,
  appearance: settingsAppearance,
  navigation,
}: ShellDialogsProps) {
  const { busy, error, operate } = operations;
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
        title={view?.label ?? settings.label}
        onClose={() => setSettings(null)}
      >
        {view ? (
          <ExtensionView
            host={host}
            id={view.id}
            generation={view.generation}
          />
        ) : (
          <div className="dialog-content">
            <p>{preservedMessage("界面提供者暂不可用")}</p>
            <button onClick={() => navigation.openManager()}>查看扩展</button>
          </div>
        )}
      </Dialog>
    );
  }
  return (
    <Dialog
      title={settings === "about" ? "关于 Plums" : "应用设置"}
      onClose={() => setSettings(null)}
    >
      <div className="dialog-content">
        {settings === "about" ? (
          <>
            <img
              className={styles.aboutLogo}
              src="/brand/plums.png"
              width="56"
              height="56"
              alt=""
            />
            <h3>Plums · 0.2.0</h3>
            <p>通过扩展组合角色、能力和界面。</p>
            <p className="muted">
              本地调试原型。能力与数据格式由已启用的扩展提供；请在扩展详情核对来源、版本与权限。
            </p>
          </>
        ) : (
          <SettingsPanel
            busy={busy}
            operate={operate}
            views={views}
            activeView={activeView}
            selectLayout={selectLayout}
            appearance={settingsAppearance}
            openManager={(diagnostics) => {
              setSettings(null);
              navigation.openManager(diagnostics);
            }}
          />
        )}
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
