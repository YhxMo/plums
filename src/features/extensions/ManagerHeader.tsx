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
          <div>
            <span className="eyebrow">本地扩展 · {controller.count}</span>
            <h2 ref={controller.heading} tabIndex={-1}>
              扩展与状态
            </h2>
          </div>
        </div>
        <div className={styles.managerGlobalActions}>
          <button
            className="secondary"
            onClick={(event) => controller.install(event.currentTarget)}
          >
            安装扩展
          </button>
          <button
            className="secondary"
            disabled={controller.busy}
            onClick={() => void controller.save()}
          >
            保存当前组合
          </button>
        </div>
      </div>
    </div>
  );
}
