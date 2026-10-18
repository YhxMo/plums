import type { ManagerHeaderController } from "./controllers";
import { Icon } from "../../components/Icon";
import styles from "./ExtensionManager.module.css";
import layoutStyles from "../../shell/layout.module.css";

export function ManagerHeader({
  controller,
}: {
  controller: ManagerHeaderController;
}) {
  return (
    <div className={`${styles.managerHeader} ${layoutStyles.managerHeader}`}>
      <div className={styles.inspectorHeading}>
        <div className={styles.inspectorHeadingLeft}>
          <button
            className={`topbar-ghost ${styles.backArrow} ${layoutStyles.backArrow}`}
            aria-label="返回工作区"
            title="返回工作区"
            onClick={controller.close}
          >
            <Icon name="arrowLeft" size={18} />
          </button>
          <h2 ref={controller.heading} tabIndex={-1}>
            扩展与状态
          </h2>
          <span className={styles.count}>{controller.count}</span>
        </div>
        <div className={styles.managerGlobalActions}>
          <button onClick={(event) => controller.install(event.currentTarget)}>
            安装扩展
          </button>
          <button
            className="secondary"
            disabled={controller.busy}
            title="记录现在启用的扩展、版本与外观，下次打开应用时恢复"
            onClick={() => void controller.save()}
          >
            保存当前组合
          </button>
        </div>
      </div>
    </div>
  );
}
