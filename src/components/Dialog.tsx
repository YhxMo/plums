import { useEffect, useRef, type ReactNode } from "react";
import { Icon } from "./Icon";
export function Dialog({
  title,
  children,
  onClose,
  returnFocusTo,
  bare = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  bare?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef(returnFocusTo);
  useEffect(() => {
    const active =
      opener.current ?? (document.activeElement as HTMLElement | null);
    ref.current?.showModal();
    return () => {
      ref.current?.close();
      active?.focus();
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
          <h2>{title}</h2>
          <button className="icon-button" aria-label="关闭" onClick={onClose}>
            <Icon name="close" />
          </button>
        </header>
      )}
      {children}
    </dialog>
  );
}
