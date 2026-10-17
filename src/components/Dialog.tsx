import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
export function Dialog({
  title,
  children,
  onClose,
  returnFocusTo,
  fallbackFocus,
  bare = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  fallbackFocus?: () => HTMLElement | null;
  bare?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const opener = useRef(returnFocusTo);
  const fallback = useRef(fallbackFocus);
  useEffect(() => {
    const active =
      opener.current ?? (document.activeElement as HTMLElement | null);
    ref.current?.showModal();
    // Opening a dialog can give its first button a keyboard focus ring.
    // Start at the title without displacing a focused form control.
    if (document.activeElement === close.current)
      heading.current?.focus({ preventScroll: true });
    return () => {
      ref.current?.close();
      if (active?.isConnected && active.getClientRects().length) active.focus();
      else fallback.current?.()?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={bare ? "app-dialog detail-dialog" : "app-dialog"}
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {!bare && (
        <header className="dialog-heading">
          <h2 ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <button
            ref={close}
            className="icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
      )}
      {children}
    </dialog>
  );
}
