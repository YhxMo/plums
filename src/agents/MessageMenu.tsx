import { useEffect, useLayoutEffect, useRef } from "react";
import type { Message } from "../../modules/agents/contract";
import { Icon } from "../components/Icon";
import type { MessageAction } from "./MessageRow";
import s from "./ChatView.module.css";

/** Right-click menu at the pointer, kept inside the window. */
export function MessageMenu({
  message,
  x,
  y,
  busy,
  canDelete,
  onAction,
  onClose,
}: {
  message: Message;
  x: number;
  y: number;
  busy: boolean;
  canDelete: boolean;
  onAction: (action: MessageAction, message: Message) => void;
  /** `restore` returns focus to the message's own action buttons. */
  onClose: (restore: boolean) => void;
}) {
  const menu = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    element.style.left = `${Math.max(8, Math.min(x, innerWidth - element.offsetWidth - 8))}px`;
    element.style.top = `${Math.max(8, Math.min(y, innerHeight - element.offsetHeight - 8))}px`;
    element.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [x, y]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) onClose(false);
    };
    const away = () => onClose(false);
    document.addEventListener("pointerdown", outside);
    addEventListener("resize", away);
    document.addEventListener("scroll", away, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      removeEventListener("resize", away);
      document.removeEventListener("scroll", away, true);
    };
  }, [onClose]);
  const item = (action: MessageAction, icon: string, label: string) => (
    <button
      role="menuitem"
      className={action === "delete" ? s.dangerItem : undefined}
      disabled={action !== "copy" && busy}
      onClick={() => {
        onClose(false);
        onAction(action, message);
      }}
    >
      <Icon name={icon} size={16} />
      {label}
    </button>
  );
  return (
    <div
      ref={menu}
      className={s.messageMenu}
      role="menu"
      aria-label="消息操作"
      style={{ left: x, top: y }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose(true);
        }
        if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
        e.preventDefault();
        const items = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>(
            "[role=menuitem]:not(:disabled)",
          ),
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        items[
          (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
            items.length
        ]?.focus();
      }}
    >
      {item("copy", "copy", "复制")}
      {message.role === "user" && item("resend", "retry", "重新发送")}
      {canDelete && (
        <>
          <hr />
          {item("delete", "trash", "删除")}
        </>
      )}
    </div>
  );
}
