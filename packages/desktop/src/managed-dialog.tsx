import { Icon } from "./components/Icon.js";
import { useEffect, useRef, type ReactNode } from "react";

export function ManagedDialog({
  children,
  footer,
  className = "",
  label,
  title,
  size = "md",
  testId,
  busy,
  error,
  onClose,
}: {
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  label: string;
  title?: string;
  size?: "sm" | "md" | "lg";
  testId?: string;
  busy: boolean;
  error?: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = dialog.current?.querySelector<HTMLElement>(
      ".dialog-scroll input:not(:disabled), .dialog-scroll select:not(:disabled), .dialog-footer button:not(:disabled)",
    );
    (first ?? dialog.current)?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <div className="modal-backdrop">
      <section
        ref={dialog}
        data-testid={testId}
        className={`modal modal-${size} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            close.current();
          }
          if (event.key !== "Tab") return;
          const items = Array.from(
            dialog.current!.querySelectorAll<HTMLElement>(
              'input:not(:disabled), select:not(:disabled), button:not(:disabled), summary, textarea:not(:disabled), [tabindex="0"]',
            ),
          ).filter((el) => el.getClientRects().length);
          if (!items.length) {
            event.preventDefault();
            dialog.current?.focus();
            return;
          }
          const first = items[0]!,
            last = items[items.length - 1]!;
          if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <div className="dialog-header">
          <h2>{title ?? label}</h2>
          <button
            className="ghost icon-button sm"
            type="button"
            aria-label="关闭弹窗"
            disabled={busy}
            onClick={onClose}
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="dialog-scroll">
          {error && (
            <div role="alert" className="notice error">
              {error}
            </div>
          )}
          {children}
        </div>
        {footer && <div className="dialog-footer">{footer}</div>}
      </section>
    </div>
  );
}
