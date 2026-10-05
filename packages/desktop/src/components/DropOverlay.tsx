import { Icon } from "./Icon.js";
export function DropOverlay() {
  return (
    <div className="drop-overlay" data-testid="drop-overlay" role="status">
      <div>
        <Icon name="upload" size={40} />
        <h2>松开即可导入</h2>
        <p>Agent ZIP、角色卡或扩展（含服务接入）</p>
      </div>
    </div>
  );
}
