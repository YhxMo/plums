import { preservedMessage } from "./messages";
import type { ShellDialogsProps } from "./controllers";
import { ExtensionView } from "../components/ExtensionView";
import { Dialog } from "../components/Dialog";
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
  const { appearance, themes, themeId, selectTheme, toggleTheme } =
    settingsAppearance;
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
      <Dialog title={settings.label} onClose={() => setSettings(null)}>
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
            <h3>Plums M1 · 0.0.4</h3>
            <p>通过扩展组合角色、能力和界面。</p>
            <p className="muted">
              本地调试原型。当前 Agent 使用本地文本服务，模型与 MCP
              连接器尚未内置。
            </p>
          </>
        ) : (
          <>
            <h3>界面与外观</h3>
            <p className="muted">
              扩展界面优先于默认界面，可在此切换已启用的界面。
            </p>
            <div role="group" aria-label="界面布局" className="layout-options">
              {views.map((view) => (
                <button
                  className="secondary"
                  key={view.id}
                  aria-pressed={view.id === activeView}
                  onClick={() => void operate(() => selectLayout(view.id))}
                >
                  使用 {view.label}
                </button>
              ))}
            </div>
            <button
              className="secondary"
              onClick={() => void operate(toggleTheme)}
            >
              {appearance === "light" ? "切换到深色模式" : "切换到浅色模式"}
            </button>
            <div role="group" aria-label="扩展主题" className="layout-options">
              <button
                className="secondary"
                disabled={busy}
                aria-pressed={!themeId}
                onClick={() => void operate(() => selectTheme(null))}
              >
                使用内置外观
              </button>
              {themes.map((entry) => (
                <button
                  className="secondary"
                  disabled={busy}
                  key={entry.id}
                  aria-pressed={entry.id === themeId}
                  onClick={() => void operate(() => selectTheme(entry.id))}
                >
                  使用 {entry.label}
                  <small className="muted theme-identity">
                    {entry.id} · {entry.owner}
                  </small>
                </button>
              ))}
            </div>
            <p className="muted">
              主题来自已启用的扩展；停用后使用内置外观。重启启用集合需在扩展管理中保存当前组合。
            </p>
            <h3>扩展与连接</h3>
            <p className="muted">
              模型连接器、MCP 服务和其他能力统一在扩展中配置、启用或停用。
            </p>
            <button
              className="secondary"
              onClick={() => {
                setSettings(null);
                navigation.openManager();
              }}
            >
              管理扩展
            </button>
            <h3>数据与诊断</h3>
            <p className="muted">
              配置与会话保存在本地隔离数据中。实验工具可检查任务、权限与恢复状态。
            </p>
            <button
              className="secondary"
              onClick={() => {
                setSettings(null);
                navigation.openManager(true);
              }}
            >
              打开诊断工具
            </button>
          </>
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
