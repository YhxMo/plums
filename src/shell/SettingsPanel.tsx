import type { ShellDialogsProps } from "./controllers";
import s from "./settings.module.css";

type Props = Pick<ShellDialogsProps["operations"], "busy" | "operate"> &
  Pick<ShellDialogsProps["workspace"], "views" | "activeView"> & {
    selectLayout(id: string): Promise<void>;
    appearance: ShellDialogsProps["appearance"];
    openManager(diagnostics?: boolean): void;
  };

/** Application settings: one labelled row per choice, actions on the right. */
export function SettingsPanel({
  busy,
  operate,
  views,
  activeView,
  selectLayout,
  appearance: { appearance, themes, themeId, selectTheme, toggleTheme },
  openManager,
}: Props) {
  return (
    <>
      <h3>界面与外观</h3>
      <div className={s.row}>
        <span>界面布局</span>
        <div role="group" aria-label="界面布局" className={s.segmented}>
          {views.map((view) => (
            <button
              key={view.id}
              aria-pressed={view.id === activeView}
              onClick={() => void operate(() => selectLayout(view.id))}
            >
              使用 {view.label}
            </button>
          ))}
        </div>
      </div>
      <div className={s.row}>
        <span>颜色模式</span>
        <button className="secondary" onClick={() => void operate(toggleTheme)}>
          {appearance === "light" ? "切换到深色模式" : "切换到浅色模式"}
        </button>
      </div>
      <div className={s.row}>
        <span>外观主题</span>
        <div role="group" aria-label="扩展主题" className={s.segmented}>
          <button
            disabled={busy}
            aria-pressed={!themeId}
            onClick={() => void operate(() => selectTheme(null))}
          >
            使用内置外观
          </button>
          {themes.map((entry) => (
            <button
              disabled={busy}
              key={entry.id}
              aria-pressed={entry.id === themeId}
              title={`${entry.id} · ${entry.owner}`}
              onClick={() => void operate(() => selectTheme(entry.id))}
            >
              使用 {entry.label}
              <small className="sr-only">
                {entry.id} · {entry.owner}
              </small>
            </button>
          ))}
        </div>
      </div>
      <p className={s.hint}>
        界面和主题来自已启用的扩展；启用状态会自动保留到下次打开。
      </p>
      <h3>扩展与连接</h3>
      <div className={s.row}>
        <span className={s.note}>
          模型连接器和其他能力都在扩展中配置与启用。
        </span>
        <button className="secondary" onClick={() => openManager()}>
          管理扩展
        </button>
      </div>
      <h3>数据与诊断</h3>
      <div className={s.row}>
        <span className={s.note}>
          数据保存在本机。诊断工具可检查任务、权限与恢复状态。
        </span>
        <button className="secondary" onClick={() => openManager(true)}>
          打开诊断工具
        </button>
      </div>
    </>
  );
}
