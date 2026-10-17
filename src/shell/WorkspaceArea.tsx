import type { Runtime } from "./runtime";
import type { ShellOperations } from "./useOperations";
import type { Workspace } from "./useWorkspace";
import type { Experiments } from "./useExperiments";
import type { Authorization } from "./AuthorizationDialog";
import type { WorkspaceChrome } from "./useWorkspaceChrome";
import { ExtensionView } from "../components/ExtensionView";
import { Icon } from "../components/Icon";
import styles from "./layout.module.css";
import managerStyles from "../features/extensions/ExtensionManager.module.css";
function RecoveryWelcome({
  operations,
  experiments,
  authorization,
  onExtensions,
}: {
  operations: ShellOperations;
  experiments: Experiments;
  authorization: Authorization;
  onExtensions: () => void;
}) {
  const { busy } = operations;
  const { started, start } = experiments;
  const { requestAuthorization } = authorization;
  return (
    <main className={managerStyles.welcome}>
      <img className={styles.welcomeMark} src="/brand/plums.png" alt="" />
      <span className="eyebrow">你的本地工作空间</span>
      <h1>{started ? "扩展正在等待条件。" : "从一个可替换的界面开始。"}</h1>
      <p>
        {started
          ? "查看扩展状态以恢复依赖，或重新启用默认组合。已保存的数据会在恢复时读取。"
          : "服务处理输入，布局呈现结果。先查看扩展，再授权启动你的第一个组合。"}
      </p>
      <ol className={managerStyles.steps}>
        <li>
          <b>1</b>查看扩展
        </li>
        <li>
          <b>2</b>确认授权
        </li>
        <li>
          <b>3</b>运行与保存
        </li>
      </ol>
      <div className={managerStyles.welcomeActions}>
        <button
          disabled={busy}
          onClick={(event) =>
            requestAuthorization(["workbench"], start, event.currentTarget)
          }
        >
          {started ? "恢复权限与默认界面" : "授予实验能力并启动"}
        </button>
        <button className="secondary" onClick={onExtensions}>
          查看本地扩展
        </button>
      </div>
      <p className={managerStyles.welcomeHint}>
        默认组合：文本工作台、大写服务、工作台与画布布局。只处理本地示例文本。
      </p>
    </main>
  );
}
export function WorkspaceArea({
  runtime,
  workspace,
  chrome,
  hidden,
  operations,
  experiments,
  authorization,
  onExtensions,
}: {
  runtime: Runtime;
  workspace: Workspace;
  chrome: WorkspaceChrome;
  hidden: boolean;
  operations: ShellOperations;
  experiments: Experiments;
  authorization: Authorization;
  onExtensions: () => void;
}) {
  return (
    <>
      <div
        className={styles.stageArea}
        data-workspace
        hidden={hidden}
        inert={hidden || undefined}
      >
        {!workspace.activeView && (
          <RecoveryWelcome
            {...{ operations, experiments, authorization, onExtensions }}
          />
        )}
        <div
          ref={workspace.slot}
          hidden={!workspace.activeView}
          className={styles.viewSlot}
        />
      </div>
      {!hidden && chrome.custom && chrome.open && (
        <aside
          className={styles.extensionSidebar}
          aria-label={chrome.custom.label}
        >
          <header className={styles.extensionSidebarHeader}>
            <h2>{chrome.custom.label}</h2>
            <button
              className="topbar-ghost"
              aria-label="收起扩展侧栏"
              onClick={chrome.closeCustom}
            >
              <Icon name="close" size={16} />
            </button>
          </header>
          <div className={styles.extensionSidebarBody}>
            <ExtensionView
              host={runtime.host}
              id={chrome.custom.id}
              generation={chrome.custom.generation}
            />
          </div>
        </aside>
      )}
    </>
  );
}
