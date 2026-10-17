import type { RecoveryWelcomeProps } from "./controllers";
import styles from "./layout.module.css";
import managerStyles from "../features/extensions/ExtensionManager.module.css";
export function RecoveryWelcome({
  operations,
  experiments,
  authorization,
  onExtensions,
}: RecoveryWelcomeProps) {
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
