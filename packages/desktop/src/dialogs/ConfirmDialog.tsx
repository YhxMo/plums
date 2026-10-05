import { ManagedDialog } from "../managed-dialog.js";
import { Icon } from "../components/Icon.js";
export function ConfirmDialog({
  title,
  actionLabel,
  description,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  actionLabel: string;
  description: string;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ManagedDialog
      size="sm"
      testId="delete-dialog"
      label={title}
      title={title}
      busy={busy}
      error={error}
      onClose={onCancel}
      footer={
        <div className="modal-actions">
          <button disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            className="danger primary"
            disabled={busy}
            onClick={onConfirm}
          >
            {actionLabel}
          </button>
        </div>
      }
    >
      <span className="danger-illustration">
        <Icon name="trash" size={24} />
      </span>
      <p>{description}</p>
    </ManagedDialog>
  );
}
