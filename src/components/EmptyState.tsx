import { Icon } from "./Icon";
import s from "./Workspace.module.css";
export function EmptyState({
  onImport,
  onExtensions,
  onAdd,
}: {
  onImport: () => void;
  onExtensions: () => void;
  onAdd: () => void;
}) {
  return (
    <main className={s.empty}>
      <div className={s.welcome}>
        <img src="/brand/plums.png" alt="" />
        <span className="eyebrow">从这里开始</span>
        <h1>欢迎使用 Plums</h1>
        <p>
          添加你的第一个 Agent，
          <br className={s.mobileOnly} />
          把角色与能力放到一起。
        </p>
      </div>
      <div className={s.onboarding}>
        <button className={s.onboardCard} onClick={onImport}>
          <span className={s.outlineIcon}>
            <Icon name="card" size={28} />
          </span>
          <strong>导入角色卡</strong>
          <span>从文件或链接，了解并添加 Agent</span>
          <span className={s.cardLink}>
            选择角色卡 <Icon name="arrow" size={16} />
          </span>
        </button>
        <button className={s.onboardCard} onClick={onExtensions}>
          <span className={s.outlineIcon}>
            <Icon name="puzzle" size={28} />
          </span>
          <strong>安装扩展</strong>
          <span>导入本地扩展，添加新的能力</span>
          <span className={s.cardLink}>
            查看扩展 <Icon name="arrow" size={16} />
          </span>
        </button>
      </div>
      <p className={s.emptyFoot}>
        也可以{" "}
        <button className="text-button" onClick={onAdd}>
          从头添加 Agent
        </button>
      </p>
    </main>
  );
}
