import type { Host } from "../../../modules/extension-host/host";
import type { DialogFeedback } from "../../shell/controllers";
import { Dialog } from "../../components/Dialog";

/** Confirms stopping an extension that something still uses, naming who. */
export function StopDialog({
  host,
  name,
  feedback,
  id,
  source,
  onClose,
  onStop,
}: {
  host: Pick<Host, "users">;
  name(id: string): string;
  feedback: DialogFeedback;
  id: string;
  source: HTMLElement | null;
  onClose(): void;
  onStop(): Promise<void>;
}) {
  const { busy } = feedback;
  return (
    <Dialog
      title={`停用 ${name(id)}`}
      returnFocusTo={source}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="dialog-content">
        {host
          .users(id)
          .filter((group) => group.users.length)
          .map((group) => (
            <p key={group.owner}>
              {`${group.kind}「${group.users.map((user) => user.label).join("、")}」正在使用此扩展。停用后暂时不再使用它，重新启用后自动恢复。`}
            </p>
          ))}
      </div>
      <footer className="dialog-actions">
        <button className="secondary" disabled={busy} onClick={() => onClose()}>
          取消
        </button>
        <button disabled={busy} onClick={() => void onStop()}>
          停用
        </button>
      </footer>
    </Dialog>
  );
}
