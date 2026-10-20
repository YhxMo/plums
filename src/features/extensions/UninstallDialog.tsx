import type { DialogFeedback } from "../../shell/controllers";
import { Dialog, DialogActions, DialogBody } from "../../components/Dialog";
import { Button } from "../../components/ui/button";
export function UninstallDialog({
  feedback,
  id: removal,
  source,
  onClose,
  onUninstall,
}: {
  feedback: DialogFeedback;
  id: string;
  source: HTMLElement | null;
  onClose(): void;
  onUninstall(): Promise<void>;
}) {
  const { busy } = feedback;
  return (
    <Dialog
      title="卸载扩展"
      returnFocusTo={source}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <DialogBody>
        <p>卸载 {removal}？扩展会先停用，依赖它的扩展将等待服务恢复。</p>
        <p>
          保留已保存的数据和模块文件，仅移除安装路径与授权；下次启动不会自动加载。同
          ID 重装后需重新授权。
        </p>
      </DialogBody>
      <DialogActions>
        <Button variant="outline" disabled={busy} onClick={() => onClose()}>
          取消
        </Button>
        <Button
          variant="destructive"
          disabled={busy}
          onClick={() => void onUninstall()}
        >
          保留数据并卸载
        </Button>
      </DialogActions>
    </Dialog>
  );
}
